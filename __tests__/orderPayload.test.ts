import {
  assertSupportedPaymentMethod,
  buildOrderInsert,
  COD_PAYMENT_METHOD,
  UnsupportedPaymentMethodError,
} from '../src/checkout/orderPayload';

const input = {
  userId: 'user-1',
  orderNumber: 'ORD-1',
  subtotal: 120,
  deliveryFee: 15,
  deliveryAddress: 'Casablanca',
};

describe('COD-only order payload', () => {
  it('defaults to Cash on Delivery, stored as the existing "cash" value', () => {
    expect(COD_PAYMENT_METHOD).toBe('cash');
    expect(buildOrderInsert(input).payment_method).toBe('cash');
    expect(buildOrderInsert({ ...input, paymentMethod: 'cash' }).payment_method).toBe('cash');
  });

  it.each(['card', 'CARD', 'Cash', 'online', 'wallet', '', null, 42, { method: 'cash' }])(
    'rejects unsupported payment method %p',
    (paymentMethod) => {
      expect(() => buildOrderInsert({ ...input, paymentMethod })).toThrow(UnsupportedPaymentMethodError);
      expect(() => assertSupportedPaymentMethod(paymentMethod)).toThrow(/Only Cash on Delivery/);
    }
  );

  it('never records the order as paid', () => {
    const payload = buildOrderInsert(input);
    for (const key of Object.keys(payload)) {
      expect(key).not.toMatch(/paid|payment_status|transaction/i);
    }
    expect(payload.status).not.toMatch(/paid/i);
  });

  it('keeps the fields checkout already wrote', () => {
    expect(buildOrderInsert(input)).toEqual({
      user_id: 'user-1',
      order_number: 'ORD-1',
      status: 'confirmed',
      subtotal: 120,
      delivery_fee: 15,
      total: 135,
      payment_method: 'cash',
      delivery_address: 'Casablanca',
      created_at: expect.any(String),
    });
  });
});
