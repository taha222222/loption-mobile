import { assertSupportedPaymentMethod, COD_PAYMENT_METHOD, UnsupportedPaymentMethodError } from '../src/checkout/orderPayload';
import * as payload from '../src/checkout/orderPayload';

describe('COD-only payment method', () => {
  it('Cash on Delivery is stored as the existing "cash" value', () => {
    expect(COD_PAYMENT_METHOD).toBe('cash');
    expect(() => assertSupportedPaymentMethod('cash')).not.toThrow();
  });

  it.each(['card', 'CARD', 'Cash', 'online', 'wallet', '', null, 42, { method: 'cash' }])(
    'rejects unsupported payment method %p',
    (paymentMethod) => {
      expect(() => assertSupportedPaymentMethod(paymentMethod)).toThrow(UnsupportedPaymentMethodError);
      expect(() => assertSupportedPaymentMethod(paymentMethod)).toThrow(/Only Cash on Delivery/);
    }
  );

  it('the app has no orders-insert builder any more (orders are created by the server)', () => {
    expect(Object.keys(payload)).not.toContain('buildOrderInsert');
  });
});
