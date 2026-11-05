// src/services/checkoutApi.ts
// Trusted order creation (20261106120000_v1_create_order.sql). The app sends
// only what the customer orders (meal ids, quantities, notes), the kitchen and
// a request id; the server reads prices from the menu, fees from the
// owner-approved pricing, the address from the profile, applies the
// first-order offer and creates a pending cash-on-delivery workflow order.
// The same request id always returns the same order (safe to retry).
import { supabase } from '../lib/supabase';
import { isMissingServerFeature } from '../lib/serverFeatures';

export interface OrderLineRequest {
  mealId: string;
  quantity: number;
  notes?: string | null;
}

export type CreateOrderFailure = 'closed' | 'out_of_zone' | 'no_city' | 'invalid' | 'not_allowed' | 'not_available' | 'network' | 'other';
export type CreateOrderResult = { ok: true; orderId: string } | { ok: false; reason: CreateOrderFailure; message: string };

export interface ActivePricing {
  kitchenId: string;
  deliveryFee: number;
  serviceFee: number;
  minimumSubtotal: number;
}

// Customer-facing messages (French).
const MESSAGES: Record<CreateOrderFailure, string> = {
  closed: 'La commande en ligne n’est pas encore ouverte.',
  out_of_zone: 'La livraison n’est pas encore disponible dans votre ville. L’OPTION livre d’abord à Casablanca et arrivera bientôt dans d’autres villes.',
  no_city: 'Indiquez la ville de votre adresse de livraison dans votre profil.',
  invalid: 'Votre panier ne peut pas être commandé tel quel (plat indisponible, quantité ou minimum de commande). Vérifiez-le.',
  not_allowed: 'Ce compte ne peut pas passer de commande client.',
  not_available: 'La commande en ligne n’est pas encore activée sur le serveur.',
  network: 'Pas de connexion : la commande n’a pas été envoyée. Réessayez, elle ne sera pas doublée.',
  other: 'La commande n’a pas pu être créée.',
};

export function classifyCreateOrderError(error: { code?: string; message?: string }): CreateOrderFailure {
  const code = String(error.code ?? '');
  if (isMissingServerFeature(error)) return 'not_available';
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
  const { data, error } = await supabase.from('pricing_policies').select('kitchen_id, delivery_fee, service_fee, minimum_subtotal');
  if (error || !data || data.length !== 1) return null; // none, or several kitchens (routing not decided yet)
  const row = data[0] as { kitchen_id: string; delivery_fee: number | string; service_fee: number | string; minimum_subtotal: number | string };
  return {
    kitchenId: row.kitchen_id,
    deliveryFee: Number(row.delivery_fee),
    serviceFee: Number(row.service_fee),
    minimumSubtotal: Number(row.minimum_subtotal),
  };
}
