// src/services/cashierApi.ts
// Reads for the cashier screens. Row access is decided by the database:
// orders_cashier_read (cashier of the order's kitchen, workflow orders only),
// staff_admin_all_orders (admin); order_items and order_status_updates follow
// the order. The columns are listed explicitly: the cashier gets what is needed
// to check and confirm an order, not the account (no user id, no profile, no
// request id, no tax breakdown). Changes go through orderWorkflowApi only.
import { supabase } from '../lib/supabase';
import { classifyWorkflowError, type WorkflowError } from './orderWorkflowApi';
import { CASHIER_TAB_ASCENDING, CASHIER_TAB_STATUSES, type CashierTab } from '../cashier/cashierOrders';

export const CASHIER_QUEUE_COLUMNS =
  'id, order_number, status, workflow_version, payment_method, payment_status, total, delivery_address, created_at, status_changed_at';

export const CASHIER_ORDER_COLUMNS =
  'id, order_number, status, workflow_version, kitchen_id, payment_method, payment_status, subtotal, promo_discount, ' +
  'platform_service_fee, delivery_fee, total, delivery_address, delivery_phone, created_at, status_changed_at, confirmed_at, ' +
  'cancelled_at, cancel_reason';

export const CASHIER_ITEM_COLUMNS = 'id, meal_name, quantity, options, notes, line_total_ttc';
export const CASHIER_TIMELINE_COLUMNS = 'id, status, message, created_at';

export const CASHIER_QUEUE_LIMIT = 50;

export interface CashierQueueOrder {
  id: string;
  order_number: string;
  status: string;
  workflow_version: number | null;
  payment_method: string | null;
  payment_status: string | null;
  total: number;
  delivery_address: string | null;
  created_at: string;
  status_changed_at: string | null;
}

export interface CashierOrderItem {
  id: string;
  meal_name: string;
  quantity: number;
  options: unknown;
  notes: string | null;
  line_total_ttc: number | null;
}

export interface CashierTimelineRow {
  id: string;
  status: string;
  message: string | null;
  created_at: string;
}

export interface CashierOrderDetail extends CashierQueueOrder {
  kitchen_id: string | null;
  subtotal: number | null;
  promo_discount: number | null;
  platform_service_fee: number | null;
  delivery_fee: number | null;
  delivery_phone: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items: CashierOrderItem[];
  timeline: CashierTimelineRow[];
}

export type ReadResult<T> = { ok: true; data: T } | { ok: false; error: WorkflowError };

const failure = (e: unknown): { ok: false; error: WorkflowError } => ({
  ok: false,
  error: { kind: 'network', message: e instanceof Error ? e.message : String(e) },
});

// Workflow orders of one tab. Historical counter/kiosk orders never appear.
export async function fetchCashierQueue(tab: CashierTab): Promise<ReadResult<CashierQueueOrder[]>> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(CASHIER_QUEUE_COLUMNS)
      .not('workflow_version', 'is', null)
      .in('status', [...CASHIER_TAB_STATUSES[tab]])
      .order('created_at', { ascending: CASHIER_TAB_ASCENDING[tab] })
      .limit(CASHIER_QUEUE_LIMIT);
    if (error) return { ok: false, error: classifyWorkflowError(error) };
    return { ok: true, data: (data ?? []) as unknown as CashierQueueOrder[] };
  } catch (e) {
    return failure(e);
  }
}

// One order with its lines and status history. null = not visible to this
// account (another kitchen, or not an order it may manage).
export async function fetchCashierOrder(orderId: string): Promise<ReadResult<CashierOrderDetail | null>> {
  try {
    const [order, items, timeline] = await Promise.all([
      supabase.from('orders').select(CASHIER_ORDER_COLUMNS).eq('id', orderId).not('workflow_version', 'is', null).maybeSingle(),
      supabase.from('order_items').select(CASHIER_ITEM_COLUMNS).eq('order_id', orderId).order('created_at', { ascending: true }),
      supabase.from('order_status_updates').select(CASHIER_TIMELINE_COLUMNS).eq('order_id', orderId).order('created_at', { ascending: true }),
    ]);
    const error = order.error ?? items.error ?? timeline.error;
    if (error) return { ok: false, error: classifyWorkflowError(error) };
    if (!order.data) return { ok: true, data: null };
    return {
      ok: true,
      data: {
        ...(order.data as unknown as Omit<CashierOrderDetail, 'items' | 'timeline'>),
        items: (items.data ?? []) as unknown as CashierOrderItem[],
        timeline: (timeline.data ?? []) as unknown as CashierTimelineRow[],
      },
    };
  } catch (e) {
    return failure(e);
  }
}

// Realtime (best effort): any visible change of orders or of the timeline
// triggers a refetch. Rows are filtered by the same RLS policies. Screens also
// refetch after every action and on pull-to-refresh, so a missing Realtime
// service only delays updates.
export function subscribeCashierOrders(channelName: string, onChange: () => void): () => void {
  try {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => onChange())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_status_updates' }, () => onChange())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
