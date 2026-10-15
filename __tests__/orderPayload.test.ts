import {
  assertSupportedPaymentMethod,
  buildOrderInsert,
  COD_PAYMENT_METHOD,
  UnsupportedPaymentMethodError,
} from '../src/checkout/orderPayload';

// Every key checkout is allowed to write to `orders`.
const ORDER_INSERT_KEYS = [
  'user_id',
  'order_number',
  'status',
  'subtotal',
  'delivery_fee',
  'total',
  'payment_method',
  'delivery_address',
  'created_at',
] as const;

// Names a payment-state field could plausibly take; none may be written.
const PAYMENT_STATE_FIELDS = [
  'paid',
  'is_paid',
  'isPaid',
  'paid_at',
  'paidAt',
  'payment_status',
  'paymentStatus',
  'payment_state',
  'paymentState',
  'transaction_id',
  'transactionId',
  'settled',
  'settled_at',
];
const PAYMENT_STATE_KEY_PATTERN = /paid|pay(ment)?[_-]?(status|state)|transaction|settle/i;

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

    // Exact allowlist: any new key (paid flag, payment status, transaction id…) fails here.
    expect(Object.keys(payload).sort()).toEqual([...ORDER_INSERT_KEYS].sort());

    for (const field of PAYMENT_STATE_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
    for (const key of Object.keys(payload)) {
      expect(key).not.toMatch(PAYMENT_STATE_KEY_PATTERN);
    }
    expect(payload.payment_method).toBe('cash');
    expect(payload.status).toBe('confirmed');
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
