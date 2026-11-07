// src/services/checkoutApi.ts
// Trusted order creation (create_order() v2, 20261109120000_v1_checkout_experience.sql).
// The app sends only what the customer orders (meal ids, choice ids,
// quantities, notes), the kitchen of the delivery quote, an optional promo
// code, a request id and the total the customer saw. The server prices
// everything (menu, choices, first-order rule, service fee, road-distance
// delivery fee, promo, TVA), refuses if its total differs from the one shown,
// and creates a pending cash-on-delivery workflow order. The same request id
// always returns the same order (safe to retry). checkout_preview() is the
// same server computation, shown before ordering.
import { supabase } from '../lib/supabase';
import { isMissingServerFeature } from '../lib/serverFeatures';

export interface OrderLineRequest {
  mealId: string;
  quantity: number;
  notes?: string | null;
  optionIds?: string[];
}

export type CreateOrderFailure =
  | 'closed'
  | 'quote_required'
  | 'phone_required'
  | 'total_changed'
  | 'promo_rejected'
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
  phone_required: 'Vérifiez votre numéro de téléphone avant de commander.',
  total_changed: 'Le total de votre commande a changé. Vérifiez le nouveau récapitulatif avant de confirmer.',
  promo_rejected: 'Ce code promo ne peut pas être utilisé pour cette commande.',
  out_of_zone: 'La livraison n’est pas encore disponible dans votre ville. L’OPTION livre d’abord à Casablanca et arrivera bientôt dans d’autres villes.',
  no_city: 'Indiquez la ville de votre adresse de livraison dans votre profil.',
  invalid: 'Votre panier ne peut pas être commandé tel quel (plat ou option indisponible, quantité). Vérifiez-le.',
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
  if (code === '40001') return 'total_changed';
  if (code === '22023' && /verified phone number/.test(String(error.message ?? ''))) return 'phone_required';
  if (code === '22023' && /promo code/.test(String(error.message ?? ''))) return 'promo_rejected';
  if (code === '22023' && /delivery is not available in your city|this kitchen does not deliver to your city/.test(String(error.message ?? ''))) return 'out_of_zone';
  if (code === '22023' && /choose your delivery city/.test(String(error.message ?? ''))) return 'no_city';
  if (code === '22023') return 'invalid';
  if (code === '42501') return 'not_allowed';
  if (!/^[0-9A-Z]{5}$/.test(code) && !code.startsWith('PGRST')) return 'network';
  return 'other';
}

// A server refusal of a cart line, in the customer's words (no technical text).
export function describeInvalidCart(message: string | undefined): string {
  const m = String(message ?? '');
  let r = /choose the required options for (.+)$/.exec(m);
  if (r) return `Choisissez les options obligatoires de « ${r[1]} ».`;
  r = /a choice for (.+) is not available$/.exec(m);
  if (r) return `Une option de « ${r[1]} » n’est plus disponible. Modifiez ce plat.`;
  if (/meal .* is not available/.test(m)) return 'Un plat de votre panier n’est plus disponible. Retirez-le pour continuer.';
  if (/same meal with the same choices/.test(m)) return 'Le même plat avec les mêmes options apparaît deux fois : regroupez-les.';
  if (/quantity/.test(m)) return 'Une quantité n’est pas valide (1 à 20 par plat).';
  return MESSAGES.invalid;
}

// Only meal ids, choice ids, quantities and notes are sent: never a price or a total.
export function toOrderLines(items: OrderLineRequest[]): { meal_id: string; quantity: number; notes: string | null; option_ids: string[] }[] {
  return items.map((i) => ({
    meal_id: i.mealId,
    quantity: i.quantity,
    notes: i.notes?.trim() ? i.notes.trim() : null,
    option_ids: [...(i.optionIds ?? [])],
  }));
}

export async function createOrder(input: {
  kitchenId: string;
  items: OrderLineRequest[];
  requestId: string;
  expectedTotal: number;
  promoCode?: string | null;
  note?: string | null;
}): Promise<CreateOrderResult> {
  try {
    const { data, error } = await supabase.rpc('create_order', {
      p_kitchen: input.kitchenId,
      p_items: toOrderLines(input.items),
      p_client_request_id: input.requestId,
      p_note: input.note ?? null,
      p_promo_code: input.promoCode?.trim() ? input.promoCode.trim() : null,
      // Not a price: the server refuses the order if its own total differs.
      p_expected_total: input.expectedTotal,
    });
    if (error) {
      const reason = classifyCreateOrderError(error);
      return { ok: false, reason, message: reason === 'invalid' ? describeInvalidCart(error.message) : MESSAGES[reason] };
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
// Price preview (public.checkout_preview): the server's computation of the
// order before it is placed. Shown as is; never recomputed on the phone.
// ---------------------------------------------------------------------
export type PromoStatus =
  | 'none'
  | 'valid'
  | 'invalid'
  | 'expired'
  | 'not_started'
  | 'already_used'
  | 'exhausted'
  | 'not_combinable'
  | 'minimum_not_reached'
  | 'not_applicable'
  | 'rate_limited';

export const PROMO_MESSAGES: Record<Exclude<PromoStatus, 'none'>, string> = {
  valid: 'Code promo appliqué.',
  invalid: 'Ce code promo n’existe pas ou n’est plus actif.',
  expired: 'Ce code promo a expiré.',
  not_started: 'Ce code promo n’est pas encore valable.',
  already_used: 'Vous avez déjà utilisé ce code promo.',
  exhausted: 'Ce code promo a atteint sa limite d’utilisation.',
  not_combinable: 'Ce code ne se cumule pas avec l’offre de première commande.',
  minimum_not_reached: 'Le montant minimum de commande pour ce code n’est pas atteint.',
  not_applicable: 'Ce code ne s’applique à aucun plat de votre panier.',
  rate_limited: 'Trop de codes essayés. Réessayez dans 15 minutes.',
};

export interface PreviewLine {
  mealId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  options: { name: string; group: string; price: number }[];
  lineTotal: number;
  lineDiscount: number;
}

export interface CheckoutPreview {
  kitchenId: string;
  lines: PreviewLine[];
  productsSubtotal: number;
  promo: { code: string | null; status: PromoStatus; discount: number };
  firstOrder: boolean;
  serviceFee: number;
  serviceFeeBeforeDiscount: number;
  deliveryFee: number;
  deliveryFeeBeforeDiscount: number;
  distanceKm: number;
  total: number;
  address: string;
  phone: { e164: string | null; verified: boolean };
}

export type PreviewResult = { ok: true; preview: CheckoutPreview } | { ok: false; reason: CreateOrderFailure; message: string };

const num = (v: unknown) => Number(v ?? 0);

export function toPreview(d: Record<string, any>): CheckoutPreview {
  return {
    kitchenId: String(d.kitchen_id),
    lines: (Array.isArray(d.lines) ? d.lines : []).map((l: Record<string, any>) => ({
      mealId: String(l.meal_id),
      name: String(l.name),
      quantity: num(l.quantity),
      unitPrice: num(l.unit_price),
      options: (Array.isArray(l.options) ? l.options : []).map((o: Record<string, any>) => ({ name: String(o.name), group: String(o.group), price: num(o.price) })),
      lineTotal: num(l.line_total_ttc),
      lineDiscount: num(l.line_discount),
    })),
    productsSubtotal: num(d.products_subtotal),
    promo: { code: d.promo?.code ?? null, status: (d.promo?.status ?? 'none') as PromoStatus, discount: num(d.promo?.discount) },
    firstOrder: d.first_order === true,
    serviceFee: num(d.service_fee),
    serviceFeeBeforeDiscount: num(d.service_fee_before_discount),
    deliveryFee: num(d.delivery_fee),
    deliveryFeeBeforeDiscount: num(d.delivery_fee_before_discount),
    distanceKm: num(d.distance_km),
    total: num(d.total),
    address: String(d.address ?? ''),
    phone: { e164: d.phone?.e164 ?? null, verified: d.phone?.verified === true },
  };
}

export async function previewCheckout(input: { kitchenId: string; items: OrderLineRequest[]; promoCode?: string | null }): Promise<PreviewResult> {
  try {
    const { data, error } = await supabase.rpc('checkout_preview', {
      p_kitchen: input.kitchenId,
      p_items: toOrderLines(input.items),
      p_promo_code: input.promoCode?.trim() ? input.promoCode.trim() : null,
    });
    if (error) {
      const reason = classifyCreateOrderError(error);
      return { ok: false, reason, message: reason === 'invalid' ? describeInvalidCart(error.message) : MESSAGES[reason] };
    }
    if (!data || typeof data !== 'object') return { ok: false, reason: 'other', message: MESSAGES.other };
    return { ok: true, preview: toPreview(data as Record<string, any>) };
  } catch {
    return { ok: false, reason: 'network', message: MESSAGES.network };
  }
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
