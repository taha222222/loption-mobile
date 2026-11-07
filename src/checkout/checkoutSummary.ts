// src/checkout/checkoutSummary.ts
// What the checkout shows before ordering, from server values only: menu
// prices (TTC, TVA included), the approved service fee and the server's
// delivery quote. Display only: create_order() recomputes everything and its
// order is what the customer pays (cash on delivery). TVA is never added.
// Amounts are summed in centimes so that 0.1 + 0.2 never shows 0.30000001.
export interface CheckoutSummary {
  productsSubtotal: number;
  serviceFee: number | null;
  deliveryFee: number | null;
  distanceKm: number | null;
  total: number | null; // null until the delivery fee is known
}

const cents = (mad: number) => Math.round(mad * 100);

export function checkoutSummary(
  lines: readonly { price: number; quantity: number }[],
  serviceFee: number | null,
  quote: { deliveryFee: number; distanceKm: number } | null,
): CheckoutSummary {
  const sub = lines.reduce((sum, l) => sum + cents(l.price) * l.quantity, 0);
  const total = serviceFee != null && quote ? sub + cents(serviceFee) + cents(quote.deliveryFee) : null;
  return {
    productsSubtotal: sub / 100,
    serviceFee,
    deliveryFee: quote ? quote.deliveryFee : null,
    distanceKm: quote ? quote.distanceKm : null,
    total: total == null ? null : total / 100,
  };
}

// "120 MAD", "12.50 MAD".
export const mad = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(2)} MAD`;

export const TVA_INCLUDED_NOTE = 'TVA incluse dans les prix affichés.';
