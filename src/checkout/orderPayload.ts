// src/checkout/orderPayload.ts
// V1 accepts Cash on Delivery only. 'cash' is the value existing order rows
// already use, so it is kept as the stored representation of COD.
//
// Client-side guard only: the database refuses client-written orders, and the
// trusted order creation enforces cash on delivery itself.

export const COD_PAYMENT_METHOD = 'cash' as const;
export type SupportedPaymentMethod = typeof COD_PAYMENT_METHOD;
export const SUPPORTED_PAYMENT_METHODS: readonly SupportedPaymentMethod[] = [COD_PAYMENT_METHOD];

export class UnsupportedPaymentMethodError extends Error {
  constructor(method: unknown) {
    super(`Unsupported payment method: ${String(method)}. Only Cash on Delivery is available.`);
    this.name = 'UnsupportedPaymentMethodError';
  }
}

export function assertSupportedPaymentMethod(method: unknown): asserts method is SupportedPaymentMethod {
  if (!SUPPORTED_PAYMENT_METHODS.includes(method as SupportedPaymentMethod)) {
    throw new UnsupportedPaymentMethodError(method);
  }
}

// The app no longer builds an orders insert: orders are created by the
// server (public.create_order, checklist H4). The payment-method guard stays
// for the request the app will send to that function; the server enforces
// cash on delivery on its own.
