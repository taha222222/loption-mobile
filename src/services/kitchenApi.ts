// src/services/kitchenApi.ts
// Reads for the kitchen board. Row access is decided by the database:
// orders_kitchen_staff_read (kitchen staff of the order's kitchen, workflow
// orders only); order_items follow the order. The kitchen asks only for what
// it prepares: order number, status, times, lines with choices and notes.
// No customer phone, address, amounts or account (see DECISIONS #31/#62:
// the server still allows the full row; the app does not request it).
// Changes go through orderWorkflowApi.kitchenUpdate only.
import { supabase } from '../lib/supabase';
import { classifyWorkflowError, type WorkflowError } from './orderWorkflowApi';
import { KITCHEN_STATUSES } from '../kitchen/kitchenOrders';

export const KITCHEN_ORDER_COLUMNS =
  'id, order_number, status, workflow_version, created_at, confirmed_at, preparing_at, ready_at, status_changed_at, driver_id';
export const KITCHEN_ITEM_COLUMNS = 'id, order_id, meal_name, quantity, options, notes';
export const KITCHEN_BOARD_LIMIT = 100;

export interface KitchenItem {
  id: string;
  order_id: string;
  meal_name: string;
  quantity: number;
  options: unknown;
  notes: string | null;
}

export interface KitchenOrder {
  id: string;
  order_number: string;
  status: string;
  workflow_version: number | null;
  created_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  status_changed_at: string | null;
  driver_id: string | null;
  items: KitchenItem[];
}

export type KitchenBoardResult = { ok: true; data: KitchenOrder[] } | { ok: false; error: WorkflowError };

// Confirmed, preparing and ready workflow orders visible to this account,
// each with its lines (one query for the orders, one for their lines).
export async function fetchKitchenBoard(): Promise<KitchenBoardResult> {
  try {
    const orders = await supabase
      .from('orders')
      .select(KITCHEN_ORDER_COLUMNS)
      .not('workflow_version', 'is', null)
      .in('status', [...KITCHEN_STATUSES])
      .order('created_at', { ascending: true })
      .limit(KITCHEN_BOARD_LIMIT);
    if (orders.error) return { ok: false, error: classifyWorkflowError(orders.error) };
    const rows = (orders.data ?? []) as unknown as Omit<KitchenOrder, 'items'>[];
    if (rows.length === 0) return { ok: true, data: [] };
    const items = await supabase
      .from('order_items')
      .select(KITCHEN_ITEM_COLUMNS)
      .in('order_id', rows.map((o) => o.id))
      .order('created_at', { ascending: true });
    if (items.error) return { ok: false, error: classifyWorkflowError(items.error) };
    const byOrder = new Map<string, KitchenItem[]>();
    for (const item of (items.data ?? []) as unknown as KitchenItem[]) {
      const list = byOrder.get(item.order_id) ?? [];
      list.push(item);
      byOrder.set(item.order_id, list);
    }
    return { ok: true, data: rows.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] })) };
  } catch (e) {
    return { ok: false, error: { kind: 'network', message: e instanceof Error ? e.message : String(e) } };
  }
}
