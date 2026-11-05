// src/services/orderWorkflowApi.ts
// Calls to the order workflow functions (20261105120000_v1_order_workflow.sql).
// The server checks role, kitchen, assignment, ownership and state; screens
// never write orders.status, driver_id or payment_status themselves. Results
// are what the server said: a refused call is never reported as a success.
import { supabase } from '../lib/supabase';
import { isMissingServerFeature } from '../lib/serverFeatures';
import type { OrderStatus, PaymentStatus } from '../orders/orderWorkflow';

export type WorkflowErrorKind = 'not_allowed' | 'invalid' | 'not_available' | 'network' | 'other';
export interface WorkflowError {
  kind: WorkflowErrorKind;
  message: string; // the server's message (English), for staff screens and logs
}
export type WorkflowResult = { ok: true; changed: boolean } | { ok: false; error: WorkflowError };

interface RpcError {
  code?: string;
  message?: string;
}

export function classifyWorkflowError(error: RpcError): WorkflowError {
  const code = String(error.code ?? '');
  const message = String(error.message ?? 'unknown error');
  if (isMissingServerFeature(error)) return { kind: 'not_available', message };
  if (code === '42501') return { kind: 'not_allowed', message };
  if (code === '22023') return { kind: 'invalid', message };
  if (!/^[0-9A-Z]{5}$/.test(code) && !code.startsWith('PGRST')) return { kind: 'network', message };
  return { kind: 'other', message };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: WorkflowError | null }> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { data: null, error: classifyWorkflowError(error) };
    return { data: data as T, error: null };
  } catch (e: unknown) {
    return { data: null, error: { kind: 'network', message: e instanceof Error ? e.message : String(e) } };
  }
}

async function transition(fn: string, args: Record<string, unknown>): Promise<WorkflowResult> {
  const { data, error } = await rpc<string>(fn, args);
  if (error) return { ok: false, error };
  return { ok: true, changed: data === 'changed' };
}

// Cashier or admin: pending -> confirmed (cash on delivery: payment stays pending).
export const confirmOrder = (orderId: string) => transition('order_confirm', { p_order: orderId });

// Kitchen staff of the order's kitchen.
export const kitchenUpdate = (orderId: string, status: Extract<OrderStatus, 'preparing' | 'ready'>) =>
  transition('order_kitchen_update', { p_order: orderId, p_status: status });

// Cashier or admin, before pickup.
export const assignDriver = (orderId: string, driverId: string) =>
  transition('order_assign_driver', { p_order: orderId, p_driver: driverId });

// The assigned driver.
export const driverUpdate = (orderId: string, status: Extract<OrderStatus, 'picked_up' | 'on_the_way' | 'delivered'>) =>
  transition('order_driver_update', { p_order: orderId, p_status: status });

// Customer (own order, pending) or cashier/admin (until ready, reason required).
export const cancelOrder = (orderId: string, reason: string | null) =>
  transition('order_cancel', { p_order: orderId, p_reason: reason });

// Cashier or admin, once the order is delivered.
export const setPayment = (orderId: string, status: Exclude<PaymentStatus, 'pending'>) =>
  transition('order_set_payment', { p_order: orderId, p_status: status });

export type LocationResult = { ok: true; stored: boolean } | { ok: false; error: WorkflowError };

// The assigned driver, between pickup and delivery.
export async function reportDriverLocation(
  orderId: string,
  position: { latitude: number; longitude: number; accuracy: number | null; timestamp: number }
): Promise<LocationResult> {
  const { data, error } = await rpc<boolean>('driver_report_location', {
    p_order: orderId,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy: position.accuracy,
    p_recorded_at: new Date(position.timestamp).toISOString(),
  });
  if (error) return { ok: false, error };
  return { ok: true, stored: data === true };
}

// Driver availability (Phase 1C): only through the server function.
export async function setDriverAvailability(online: boolean): Promise<{ ok: true } | { ok: false; error: WorkflowError }> {
  const { error } = await rpc<unknown>('set_driver_availability', { p_online: online });
  return error ? { ok: false, error } : { ok: true };
}
