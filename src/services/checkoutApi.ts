// src/services/checkoutApi.ts
// Trusted order creation (create_order(), priced by
// 20261108120000_v1_pricing_engine.sql). The app sends only what the customer
// orders (meal ids, quantities, notes), the kitchen of the delivery quote and
// a request id; the server reads prices from the menu, the service fee from
// the owner-approved pricing, the delivery fee from the server's road-distance
// quote, the address from the profile, splits the TVA, applies the first-order
// offer and creates a pending cash-on-delivery workflow order.
// The same request id always returns the same order (safe to retry).
import { supabase } from '../lib/supabase';
import { isMissingServerFeature } from '../lib/serverFeatures';

export interface OrderLineRequest {
  mealId: string;
  quantity: number;
  notes?: string | null;
}

export type CreateOrderFailure =
  | 'closed'
  | 'quote_required'
  | 'out_of_zone'
  | 'no_city'
  | 'invalid'
  | 'not_allowed'
  | 'not_available'
  | 'network'
  | 'other';
export type CreateOrderResult = { ok: true; orderId: string } | { ok: false; reason: CreateOrderFailure; message: string };

// The approved pricing customers may read: the fixed service fee and the
// delivery fee range (the fee itself depends on the road distance).
export interface ActivePricing {
  kitchenId: string;
  serviceFee: number;
  deliveryMinFee: number;
  deliveryMaxFee: number;
  configVersion: string;
}

// Customer-facing messages (French).
const MESSAGES: Record<CreateOrderFailure, string> = {
  closed: 'La commande en ligne n’est pas encore ouverte.',
  quote_required: 'Les frais de livraison doivent être recalculés pour votre adresse. Réessayez.',
  out_of_zone: 'La livraison n’est pas encore disponible dans votre ville. L’OPTION livre d’abord à Casablanca et arrivera bientôt dans d’autres villes.',
  no_city: 'Indiquez la ville de votre adresse de livraison dans votre profil.',
  invalid: 'Votre panier ne peut pas être commandé tel quel (plat indisponible ou quantité). Vérifiez-le.',
  not_allowed: 'Ce compte ne peut pas passer de commande client.',
  not_available: 'La commande en ligne n’est pas encore activée sur le serveur.',
  network: 'Pas de connexion : la commande n’a pas été envoyée. Réessayez, elle ne sera pas doublée.',
  other: 'La commande n’a pas pu être créée.',
};

export function classifyCreateOrderError(error: { code?: string; message?: string }): CreateOrderFailure {
  const code = String(error.code ?? '');
  if (isMissingServerFeature(error)) return 'not_available';
  if (code === '55000' && /delivery quote required/.test(String(error.message ?? ''))) return 'quote_required';
  if (code === '55000') return 'closed';
  if (code === '22023' && /delivery is not available in your city|this kitchen does not deliver to your city/.test(String(error.message ?? ''))) return 'out_of_zone';
  if (code === '22023' && /choose your delivery city/.test(String(error.message ?? ''))) return 'no_city';
  if (code === '22023') return 'invalid';
  if (code === '42501') return 'not_allowed';
  if (!/^[0-9A-Z]{5}$/.test(code) && !code.startsWith('PGRST')) return 'network';
  return 'other';
}

// Only meal ids, quantities and notes are sent: never a price or a total.
export function toOrderLines(items: OrderLineRequest[]): { meal_id: string; quantity: number; notes: string | null }[] {
  return items.map((i) => ({ meal_id: i.mealId, quantity: i.quantity, notes: i.notes?.trim() ? i.notes.trim() : null }));
}

export async function createOrder(input: { kitchenId: string; items: OrderLineRequest[]; requestId: string; note?: string | null }): Promise<CreateOrderResult> {
  try {
    const { data, error } = await supabase.rpc('create_order', {
      p_kitchen: input.kitchenId,
      p_items: toOrderLines(input.items),
      p_client_request_id: input.requestId,
      p_note: input.note ?? null,
    });
    if (error) {
      const reason = classifyCreateOrderError(error);
      return { ok: false, reason, message: reason === 'invalid' && error.message ? `${MESSAGES.invalid} (${error.message})` : MESSAGES[reason] };
    }
    if (typeof data !== 'string') return { ok: false, reason: 'other', message: MESSAGES.other };
    return { ok: true, orderId: data };
  } catch {
    return { ok: false, reason: 'network', message: MESSAGES.network };
  }
}

// The approved pricing customers may read (one active row per kitchen). With
// no approved pricing there is nothing to order from: null.
export async function fetchActivePricing(): Promise<ActivePricing | null> {
  const { data, error } = await supabase
    .from('pricing_policies')
    .select('kitchen_id, service_fee, delivery_min_fee, delivery_max_fee, config_version');
  if (error || !data || data.length !== 1) return null; // none, or several kitchens (routing not decided yet)
  const row = data[0] as {
    kitchen_id: string;
    service_fee: number | string;
    delivery_min_fee: number | string;
    delivery_max_fee: number | string;
    config_version: string;
  };
  return {
    kitchenId: row.kitchen_id,
    serviceFee: Number(row.service_fee),
    deliveryMinFee: Number(row.delivery_min_fee),
    deliveryMaxFee: Number(row.delivery_max_fee),
    configVersion: row.config_version,
  };
}

// ---------------------------------------------------------------------
// Delivery quote (quote-delivery Edge Function). The request carries only
// the user's session: the server reads the saved address, measures the road
// distance from the kitchen serving the city and prices it. Nothing the app
// could send is used.
// ---------------------------------------------------------------------
export interface DeliveryQuote {
  quoteId: string;
  kitchenId: string;
  distanceKm: number;
  deliveryFee: number;
  serviceFee: number;
  expiresAt: string;
}
export type QuoteFailure =
  | 'closed'
  | 'no_address'
  | 'no_city'
  | 'out_of_zone'
  | 'invalid_address'
  | 'routing_unavailable'
  | 'retry'
  | 'network'
  | 'other';
export type QuoteResult = { ok: true; quote: DeliveryQuote } | { ok: false; reason: QuoteFailure; message: string };

const QUOTE_MESSAGES: Record<QuoteFailure, string> = {
  closed: MESSAGES.closed,
  no_address: 'Confirmez votre adresse de livraison dans votre profil.',
  no_city: MESSAGES.no_city,
  out_of_zone: MESSAGES.out_of_zone,
  invalid_address: 'Nous ne trouvons pas précisément votre adresse. Complétez-la (rue, numéro, quartier) dans votre profil.',
  routing_unavailable: 'Le calcul de la distance de livraison est indisponible pour le moment. Réessayez dans quelques instants.',
  retry: 'Les tarifs viennent d’être mis à jour. Réessayez.',
  network: 'Pas de connexion : les frais de livraison n’ont pas pu être calculés.',
  other: 'Les frais de livraison n’ont pas pu être calculés.',
};
const QUOTE_REASONS = new Set<string>(Object.keys(QUOTE_MESSAGES));

const quoteFailure = (reason: QuoteFailure): QuoteResult => ({ ok: false, reason, message: QUOTE_MESSAGES[reason] });

export async function requestDeliveryQuote(): Promise<QuoteResult> {
  try {
    const { data, error } = await supabase.functions.invoke('quote-delivery', { method: 'POST' });
    if (error) {
      // An HTTP refusal carries {ok: false, reason} in its body.
      let reason: QuoteFailure = 'other';
      try {
        const body = (await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.()) as { reason?: string } | undefined;
        if (body?.reason && QUOTE_REASONS.has(body.reason)) reason = body.reason as QuoteFailure;
        else if (!body) reason = 'network';
      } catch {
        reason = 'network';
      }
      return quoteFailure(reason);
    }
    const q = (data as { ok?: boolean; quote?: Record<string, unknown> } | null)?.quote;
    if (!q || typeof q.quote_id !== 'string' || typeof q.kitchen_id !== 'string') return quoteFailure('other');
    return {
      ok: true,
      quote: {
        quoteId: q.quote_id,
        kitchenId: q.kitchen_id,
        distanceKm: Number(q.distance_km),
        deliveryFee: Number(q.delivery_fee),
        serviceFee: Number(q.service_fee),
        expiresAt: String(q.expires_at),
      },
    };
  } catch {
    return quoteFailure('network');
  }
}
