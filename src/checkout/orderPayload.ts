// src/checkout/orderPayload.ts
// V1 accepts Cash on Delivery only. 'cash' is the value existing order rows
// already use, so it is kept as the stored representation of COD.
//
// This is a client-side guard for the app's own checkout. It does NOT stop a
// modified client from writing other values directly through the Supabase API;
// that requires server-side enforcement (constraint/RLS/RPC), which is pending
// backend verification.

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

export interface OrderInsertInput {
  userId: string;
  orderNumber: string;
  subtotal: number;
  deliveryFee: number;
  deliveryAddress: string;
  paymentMethod?: unknown;
}

// Builds the `orders` insert for checkout. The fields mirror what checkout
// already wrote; only the payment method is now restricted to COD. Nothing
// here records the order as paid: COD is settled when cash is collected.
export function buildOrderInsert(input: OrderInsertInput) {
  const paymentMethod = input.paymentMethod === undefined ? COD_PAYMENT_METHOD : input.paymentMethod;
  assertSupportedPaymentMethod(paymentMethod);

  return {
    user_id: input.userId,
    order_number: input.orderNumber,
    status: 'confirmed',
    subtotal: input.subtotal,
    delivery_fee: input.deliveryFee,
    total: input.subtotal + input.deliveryFee,
    payment_method: paymentMethod,
    delivery_address: input.deliveryAddress,
    created_at: new Date().toISOString(),
  };
}
