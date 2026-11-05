// Order workflow on the client: the screens' copy of the state machine must
// equal the database's (20261105120000_v1_order_workflow.sql), the service
// must report what the server said (a refusal is never a success), and the
// admin screen must offer only the actions the rules allow. The server-side
// enforcement itself is tested in supabase/tests/run_v1_order_workflow.sh.
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  canTransition,
  nextPayments,
  nextStatuses,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  isWorkflowOrder,
} from '../src/orders/orderWorkflow';
import {
  cancelOrder,
  classifyWorkflowError,
  confirmOrder,
  driverUpdate,
  reportDriverLocation,
  setDriverAvailability,
} from '../src/services/orderWorkflowApi';
import AdminOrders from '../app/(admin)/orders';

const mockRpc = jest.fn();
const mockRows: { orders: Record<string, unknown>[]; drivers: Record<string, unknown>[] } = { orders: [], drivers: [] };
// A thenable query builder: every filter returns the builder, awaiting it
// returns the table's rows.
function mockQuery(table: 'orders' | 'drivers') {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'eq', 'in', 'is', 'limit']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: mockRows[table], error: null });
  return q;
}
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (t: 'orders' | 'drivers') => mockQuery(t),
  },
}));

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261105120000_v1_order_workflow.sql'), 'utf8');
const valuesOf = (fn: string) => {
  const start = sql.indexOf(`create function public.${fn}()`);
  const body = sql.slice(sql.indexOf('as $$', start) + 5, sql.indexOf('$$;', sql.indexOf('as $$', start) + 5));
  return [...body.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)'\)/g)].map((m) => [m[1], m[2], m[3]].join('>'));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.orders = [];
  mockRows.drivers = [];
});

describe('state machine mirror', () => {
  it('equals public.order_transitions() row for row', () => {
    expect(ORDER_TRANSITIONS.map((t) => [t.from, t.to, t.actor].join('>')).sort()).toEqual(valuesOf('order_transitions').sort());
    expect(ORDER_TRANSITIONS).toHaveLength(11);
  });

  it('equals public.order_payment_transitions() row for row', () => {
    expect(PAYMENT_TRANSITIONS.map((t) => [t.from, t.to, t.orderStatus].join('>')).sort()).toEqual(valuesOf('order_payment_transitions').sort());
  });

  it('rejects the invalid transitions named in the rules, for every actor', () => {
    const actors = ['cashier', 'kitchen_staff', 'driver', 'customer'] as const;
    for (const [from, to] of [['pending', 'delivered'], ['pending', 'ready'], ['confirmed', 'picked_up'], ['delivered', 'confirmed'], ['picked_up', 'cancelled']]) {
      for (const a of actors) expect(canTransition(from, to, a)).toBe(false);
    }
  });

  it('gives each role only its own steps', () => {
    expect(nextStatuses('pending', 'cashier')).toEqual(['confirmed', 'cancelled']);
    expect(nextStatuses('pending', 'customer')).toEqual(['cancelled']);
    expect(nextStatuses('confirmed', 'customer')).toEqual([]);
    expect(nextStatuses('confirmed', 'kitchen_staff')).toEqual(['preparing']);
    expect(nextStatuses('ready', 'kitchen_staff')).toEqual([]);
    expect(nextStatuses('ready', 'driver')).toEqual(['picked_up']);
    expect(nextStatuses('on_the_way', 'cashier')).toEqual([]); // no cancellation after pickup
    expect(nextPayments('pending', 'preparing')).toEqual([]); // cash on delivery: after delivery only
    expect(nextPayments('pending', 'delivered')).toEqual(['paid', 'failed']);
    expect(nextPayments('paid', 'delivered')).toEqual(['refunded']);
    expect(isWorkflowOrder({ workflow_version: null })).toBe(false);
  });
});

describe('workflow service', () => {
  it('reports the server result: changed, unchanged, refused', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'changed', error: null });
    expect(await confirmOrder('o1')).toEqual({ ok: true, changed: true });
    expect(mockRpc).toHaveBeenCalledWith('order_confirm', { p_order: 'o1' });
    mockRpc.mockResolvedValueOnce({ data: 'unchanged', error: null });
    expect(await driverUpdate('o1', 'picked_up')).toEqual({ ok: true, changed: false });
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid order transition ready -> delivered' } });
    expect(await driverUpdate('o1', 'delivered')).toEqual({ ok: false, error: { kind: 'invalid', message: 'invalid order transition ready -> delivered' } });
  });

  it('classifies refusals, missing server functions and network failures', () => {
    expect(classifyWorkflowError({ code: '42501', message: 'order not found or not allowed' }).kind).toBe('not_allowed');
    expect(classifyWorkflowError({ code: 'PGRST202', message: 'Could not find the function' }).kind).toBe('not_available');
    expect(classifyWorkflowError({ message: 'Network request failed' }).kind).toBe('network');
    expect(classifyWorkflowError({ code: 'P0001', message: 'x' }).kind).toBe('other');
  });

  it('a thrown network error is a refusal, not a success', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));
    expect(await cancelOrder('o1', null)).toEqual({ ok: false, error: { kind: 'network', message: 'Network request failed' } });
  });

  it('sends the position with its own time and accuracy, and availability through the server', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    const r = await reportDriverLocation('o1', { latitude: 33.5, longitude: -7.6, accuracy: 6, timestamp: Date.UTC(2026, 10, 5, 10) });
    expect(r).toEqual({ ok: true, stored: true });
    expect(mockRpc).toHaveBeenCalledWith('driver_report_location', {
      p_order: 'o1', p_latitude: 33.5, p_longitude: -7.6, p_accuracy: 6, p_recorded_at: '2026-11-05T10:00:00.000Z',
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'not approved' } });
    expect(await setDriverAvailability(true)).toEqual({ ok: false, error: { kind: 'not_allowed', message: 'not approved' } });
  });
});

describe('admin orders screen', () => {
  const order = (o: Record<string, unknown>) => ({
    id: 'o1', order_number: 'W-1', total: 60, delivery_address: 'Rue 1', created_at: '2026-11-05T10:00:00Z',
    driver_id: null, drivers: null, workflow_version: 1, payment_status: 'pending', ...o,
  });

  it('offers only confirm and cancel on a pending order, and reports what the server did', async () => {
    mockRows.orders = [order({ status: 'pending' })];
    await render(<AdminOrders />);
    await fireEvent.press(await screen.findByText('W-1'));
    expect(screen.getByText('CONFIRM ORDER')).toBeTruthy();
    expect(screen.getByText('CANCEL ORDER')).toBeTruthy();
    expect(screen.queryByText('RECORD CASH PAID')).toBeNull();
    expect(screen.queryByText(/Assign a driver/)).toBeNull(); // not before confirmation
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid order transition confirmed -> confirmed' } });
    await fireEvent.press(screen.getByText('CONFIRM ORDER'));
    await waitFor(() => expect(screen.getByText(/Confirm: not possible in the current state/)).toBeTruthy());
    expect(mockRpc).toHaveBeenCalledWith('order_confirm', { p_order: 'o1' });
  });

  it('offers driver assignment before pickup and the cash payment after delivery', async () => {
    mockRows.orders = [order({ status: 'ready' })];
    mockRows.drivers = [{ id: 'd1', first_name: 'Sami', last_name: 'B', status: 'online' }];
    const { unmount } = await render(<AdminOrders />);
    await fireEvent.press(await screen.findByText('W-1'));
    await fireEvent.press(await screen.findByText('Sami B (online)'));
    expect(mockRpc).toHaveBeenCalledWith('order_assign_driver', { p_order: 'o1', p_driver: 'd1' });
    await unmount();

    mockRows.orders = [order({ status: 'delivered', payment_status: 'pending' })];
    await render(<AdminOrders />);
    await fireEvent.press(await screen.findByText('W-1'));
    expect(screen.getByText('RECORD CASH PAID')).toBeTruthy();
    expect(screen.getByText('RECORD NOT PAID')).toBeTruthy();
    expect(screen.queryByText('CANCEL ORDER')).toBeNull(); // nobody cancels after pickup
    expect(screen.queryByText('CONFIRM ORDER')).toBeNull();
  });

  it('shows a historical order read-only', async () => {
    mockRows.orders = [order({ status: 'paid', workflow_version: null, payment_status: null })];
    await render(<AdminOrders />);
    await fireEvent.press(await screen.findByText('W-1'));
    expect(screen.getByText('Historical order (before the delivery workflow): read-only.')).toBeTruthy();
    expect(screen.queryByText('CONFIRM ORDER')).toBeNull();
    expect(screen.queryByText('CANCEL ORDER')).toBeNull();
  });
});

describe('no direct order writes in the app', () => {
  // Workflow orders change only through the server functions; the database
  // refuses direct writes anyway, this keeps the app code honest.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(__dirname, '../app'));
  walk(path.join(__dirname, '../src'));

  it('no screen or service updates, upserts or deletes public.orders', () => {
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return /from\(['"]orders['"]\)(\s*\.\w+\([^)]*\))*?\s*\.(update|upsert|delete)\(/.test(text);
    });
    expect(offenders.map((f) => path.relative(path.join(__dirname, '..'), f))).toEqual([]);
  });
});

