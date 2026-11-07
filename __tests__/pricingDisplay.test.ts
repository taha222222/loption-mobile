// Display helpers of the pricing engine: the checkout summary (server
// values only, summed in centimes, TVA never added) and the driver's
// amounts (stored values only, never defaulted).
import { checkoutSummary, mad, TVA_INCLUDED_NOTE } from '../src/checkout/checkoutSummary';
import { madOrDash, orderAmounts } from '../src/orders/orderAmounts';

describe('checkout summary', () => {
  it('total = products subtotal TTC + service fee + delivery fee, each once', () => {
    const s = checkoutSummary([{ price: 50, quantity: 2 }, { price: 35, quantity: 1 }, { price: 12, quantity: 1 }], 3, { deliveryFee: 16, distanceKm: 5 });
    expect(s).toEqual({ productsSubtotal: 147, serviceFee: 3, deliveryFee: 16, distanceKm: 5, total: 166 });
  });

  it('sums in centimes (no floating-point drift)', () => {
    const s = checkoutSummary([{ price: 0.1, quantity: 1 }, { price: 0.2, quantity: 1 }, { price: 19.99, quantity: 3 }], 3, { deliveryFee: 10, distanceKm: 1 });
    expect(s.productsSubtotal).toBe(60.27);
    expect(s.total).toBe(73.27);
    expect(mad(60.27)).toBe('60.27 MAD');
    expect(mad(120)).toBe('120 MAD');
  });

  it('no total until the server quote is known (no default fee)', () => {
    expect(checkoutSummary([{ price: 60, quantity: 2 }], 3, null)).toEqual({
      productsSubtotal: 120, serviceFee: 3, deliveryFee: null, distanceKm: null, total: null,
    });
    expect(checkoutSummary([{ price: 60, quantity: 2 }], null, null).total).toBeNull();
  });

  it('TVA is included, never a separate charge', () => {
    expect(TVA_INCLUDED_NOTE).toBe('TVA incluse dans les prix affichés.');
    const s = checkoutSummary([{ price: 100, quantity: 1 }], 3, { deliveryFee: 10, distanceKm: 1 });
    expect(s.total).toBe(113); // not 100 * 1.10 + ...
  });
});

describe('driver order amounts', () => {
  it('reads the stored amounts; the cash to collect is the order total', () => {
    const a = orderAmounts({ subtotal: '147.00', delivery_fee: '0.00', platform_service_fee: '3.00', total: '150.00' });
    expect(a).toEqual({ subtotal: 147, deliveryFee: 0, serviceFee: 3, cashToCollect: 150 });
  });

  it('never invents a default fee (the old 15 / 19 MAD)', () => {
    const a = orderAmounts({ subtotal: 50, total: 50, delivery_fee: null, platform_service_fee: undefined });
    expect(a.deliveryFee).toBeNull();
    expect(a.serviceFee).toBeNull();
    expect(madOrDash(a.deliveryFee)).toBe('—');
    expect(madOrDash(12.5)).toBe('12.50 MAD');
  });
});
