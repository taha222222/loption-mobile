// src/orders/orderAmounts.ts
// The amounts of a created order as the server stored them (create_order()):
// products subtotal, service fee, delivery fee (after the first-order offer)
// and the total, which is the cash the driver collects. Nothing is
// recomputed or defaulted here: a missing amount stays unknown (null).
import { formatMad } from '../menu/customization';

export interface OrderAmountsRow {
  subtotal?: number | string | null;
  delivery_fee?: number | string | null;
  platform_service_fee?: number | string | null;
  total?: number | string | null;
}

export interface OrderAmounts {
  subtotal: number | null;
  deliveryFee: number | null;
  serviceFee: number | null;
  cashToCollect: number | null;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function orderAmounts(row: OrderAmountsRow): OrderAmounts {
  return {
    subtotal: num(row.subtotal),
    deliveryFee: num(row.delivery_fee),
    serviceFee: num(row.platform_service_fee),
    cashToCollect: num(row.total),
  };
}

export const madOrDash = (v: number | null) => (v === null ? '—' : formatMad(v));
