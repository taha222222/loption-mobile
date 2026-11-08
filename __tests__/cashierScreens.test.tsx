// Cashier queue and order screens against a mocked Supabase client: what is
// read (explicit columns, workflow orders only), what is offered per status,
// and that every change goes through order_confirm / order_cancel (never a
// direct write), with double taps, refusals and retries handled.
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CashierQueueScreen from '../app/cashier/index';
import CashierOrderScreen from '../app/cashier/[id]';
import { useAuthStore } from '../src/stores/authStore';
import { CASHIER_ORDER_COLUMNS, CASHIER_QUEUE_COLUMNS } from '../src/services/cashierApi';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: 'o1' }),
  useFocusEffect: () => undefined,
}));

type Result = { data: unknown; error: unknown };
const mockDb: {
  tables: Record<string, () => Result>;
  calls: { table: string; ops: [string, ...unknown[]][] }[];
  writes: string[];
} = { tables: {}, calls: [], writes: [] };
const mockRpc = jest.fn();
interface MockChannel { on: jest.Mock; subscribe: jest.Mock }
const mockChannel: MockChannel = { on: jest.fn((): MockChannel => mockChannel), subscribe: jest.fn((): MockChannel => mockChannel) };

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    channel: jest.fn(() => mockChannel),
    removeChannel: jest.fn(async () => 'ok'),
    from: (table: string) => {
      const entry = { table, ops: [] as [string, ...unknown[]][] };
      mockDb.calls.push(entry);
      const result = () => Promise.resolve((mockDb.tables[table] ?? (() => ({ data: [], error: null })))());
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'not', 'in', 'order', 'limit', 'eq']) {
        builder[op] = (...args: unknown[]) => {
          entry.ops.push([op, ...args]);
          return builder;
        };
      }
      for (const op of ['insert', 'update', 'upsert', 'delete']) {
        builder[op] = () => {
          mockDb.writes.push(`${op} ${table}`);
          return builder;
        };
      }
      builder.maybeSingle = () => result();
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject);
      return builder;
    },
  },
}));

const queueRow = (o: Record<string, unknown> = {}) => ({
  id: 'o1', order_number: 'LO-261108-00001', status: 'pending', workflow_version: 1, payment_method: 'cash',
  payment_status: 'pending', total: 74, delivery_address: '12 Rue Test, Casablanca', created_at: new Date().toISOString(),
  status_changed_at: null, ...o,
});
const detailRow = (o: Record<string, unknown> = {}) => ({
  ...queueRow(), kitchen_id: 'kA', subtotal: 65, promo_discount: 0, platform_service_fee: 3, delivery_fee: 6,
  delivery_phone: '+212612345678', confirmed_at: null, cancelled_at: null, cancel_reason: null, ...o,
});
const items = [
  { id: 'i1', meal_name: 'Bol poulet', quantity: 2, options: [{ group: 'Sauce', name: 'Harissa', price: 0 }], notes: 'sans oignon', line_total_ttc: 65 },
];

function serve(order: Record<string, unknown> | null, timeline: unknown[] = []) {
  mockDb.tables = {
    orders: () => ({ data: order, error: null }),
    order_items: () => ({ data: items, error: null }),
    order_status_updates: () => ({ data: timeline, error: null }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.tables = {};
  mockDb.calls = [];
  mockDb.writes = [];
  useAuthStore.setState({ role: 'cashier', user: { id: 'c1' } as never });
});
afterEach(() => expect(mockDb.writes).toEqual([]));

describe('queue', () => {
  it('reads workflow orders of the tab with explicit columns, oldest pending first', async () => {
    mockDb.tables.orders = () => ({ data: [queueRow()], error: null });
    await render(<CashierQueueScreen />);
    await screen.findByText('LO-261108-00001');
    const call = mockDb.calls.find((c) => c.table === 'orders')!;
    expect(call.ops).toEqual([
      ['select', CASHIER_QUEUE_COLUMNS],
      ['not', 'workflow_version', 'is', null],
      ['in', 'status', ['pending']],
      ['order', 'created_at', { ascending: true }],
      ['limit', 50],
    ]);
    expect(CASHIER_QUEUE_COLUMNS).not.toMatch(/user_id|client_request_id|delivery_phone/);
    expect(screen.getByText('74 MAD')).toBeTruthy();
    expect(screen.getByText(/Paiement à la livraison .*à encaisser/)).toBeTruthy();
  });

  it('empty, then other tabs', async () => {
    mockDb.tables.orders = () => ({ data: [], error: null });
    await render(<CashierQueueScreen />);
    await screen.findByText('Aucune commande à confirmer');
    await fireEvent.press(screen.getByText('En cours'));
    await screen.findByText('Aucune commande en cours');
    const last = mockDb.calls.filter((c) => c.table === 'orders').at(-1)!;
    expect(last.ops).toContainEqual(['in', 'status', ['confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way']]);
  });

  it('error with retry', async () => {
    mockDb.tables.orders = () => ({ data: null, error: { message: 'Failed to fetch' } });
    await render(<CashierQueueScreen />);
    await screen.findByText('Commandes indisponibles');
    mockDb.tables.orders = () => ({ data: [queueRow()], error: null });
    await fireEvent.press(screen.getByText('Réessayer'));
    await screen.findByText('LO-261108-00001');
  });

  it('opens an order; subscribes to order changes (best effort)', async () => {
    mockDb.tables.orders = () => ({ data: [queueRow()], error: null });
    await render(<CashierQueueScreen />);
    await fireEvent.press(await screen.findByLabelText(/^Commande LO-261108-00001/));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/cashier/[id]', params: { id: 'o1' } });
    expect(mockChannel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'orders' }), expect.any(Function));
  });

  it('a cashier can sign out; an admin goes back to the administration', async () => {
    mockDb.tables.orders = () => ({ data: [], error: null });
    await render(<CashierQueueScreen />);
    expect(await screen.findByLabelText('Se déconnecter')).toBeTruthy();
    useAuthStore.setState({ role: 'admin' });
    await render(<CashierQueueScreen />);
    await fireEvent.press(await screen.findByLabelText('Retour à l’administration'));
    expect(mockReplace).toHaveBeenCalledWith('/(admin)/orders');
  });
});

describe('order detail', () => {
  it('shows lines, choices, notes, verified phone, address, server amounts and COD; no payment action', async () => {
    serve(detailRow());
    await render(<CashierOrderScreen />);
    await screen.findByText('2 × Bol poulet');
    expect(screen.getByText('Sauce : Harissa')).toBeTruthy();
    expect(screen.getByText('Note du client : sans oignon')).toBeTruthy();
    expect(screen.getByText('+212612345678')).toBeTruthy();
    expect(screen.getByText('12 Rue Test, Casablanca')).toBeTruthy();
    expect(screen.getByText('Total à encaisser')).toBeTruthy();
    expect(screen.getByText('74 MAD')).toBeTruthy();
    expect(screen.getByText(/à encaisser à la livraison/)).toBeTruthy();
    expect(screen.queryByText(/RECORD|encaissé$|Rembourser|livreur/i)).toBeNull();
    const call = mockDb.calls.find((c) => c.table === 'orders')!;
    expect(call.ops[0]).toEqual(['select', CASHIER_ORDER_COLUMNS]);
    expect(CASHIER_ORDER_COLUMNS).not.toMatch(/user_id|client_request_id/);
  });

  it('confirm calls order_confirm once (double tap), payment stays as the server says', async () => {
    serve(detailRow());
    let release: (v: unknown) => void = () => {};
    mockRpc.mockImplementation(() => new Promise((r) => (release = r)));
    await render(<CashierOrderScreen />);
    const button = await screen.findByText('Confirmer la commande');
    await fireEvent.press(button);
    await fireEvent.press(button);
    serve(detailRow({ status: 'confirmed', payment_status: 'pending' }), [{ id: 't1', status: 'confirmed', message: null, created_at: new Date().toISOString() }]);
    await act(async () => release({ data: 'changed', error: null }));
    await screen.findByText(/Commande confirmée\. Le paiement reste à encaisser/);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('order_confirm', { p_order: 'o1' });
    expect(screen.queryByText('Confirmer la commande')).toBeNull();
    expect(screen.getAllByText('Confirmée').length).toBeGreaterThan(0);
    expect(screen.getByText('Paiement à la livraison (espèces) · à encaisser à la livraison')).toBeTruthy();
  });

  it('already confirmed by a colleague → "already", no false success', async () => {
    serve(detailRow());
    mockRpc.mockResolvedValue({ data: 'unchanged', error: null });
    await render(<CashierOrderScreen />);
    await fireEvent.press(await screen.findByText('Confirmer la commande'));
    await screen.findByText(/déjà confirmée\. Rien n’a été modifié/);
  });

  it('cancelled meanwhile → explained, order reloaded', async () => {
    serve(detailRow());
    mockRpc.mockImplementation(async () => {
      serve(detailRow({ status: 'cancelled', cancel_reason: 'Client' }), [{ id: 't1', status: 'cancelled', message: 'Client', created_at: new Date().toISOString() }]);
      return { data: null, error: { code: '22023', message: 'invalid order transition cancelled -> confirmed' } };
    });
    await render(<CashierOrderScreen />);
    await fireEvent.press(await screen.findByText('Confirmer la commande'));
    await screen.findByText(/la commande a changé entre-temps/);
    await screen.findByText('Motif : Client');
    expect(screen.queryByText('Confirmer la commande')).toBeNull();
  });

  it('refused for this account (other kitchen) → said so', async () => {
    serve(detailRow());
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'order not found or not allowed' } });
    await render(<CashierOrderScreen />);
    await fireEvent.press(await screen.findByText('Confirmer la commande'));
    await screen.findByText(/ce compte ne gère pas les commandes de cette cuisine/);
  });

  it('network failure → nothing changed, can retry', async () => {
    serve(detailRow());
    mockRpc.mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce({ data: 'changed', error: null });
    await render(<CashierOrderScreen />);
    await fireEvent.press(await screen.findByText('Confirmer la commande'));
    await screen.findByText(/Pas de connexion : rien n’a été modifié/);
    await fireEvent.press(screen.getByText('Confirmer la commande'));
    await screen.findByText(/Commande confirmée/);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('cancel requires a reason; with one it asks, then calls order_cancel with the trimmed reason', async () => {
    serve(detailRow({ status: 'confirmed' }));
    mockRpc.mockResolvedValue({ data: 'changed', error: null });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    await render(<CashierOrderScreen />);
    await screen.findAllByText('Annuler la commande');
    expect(screen.queryByText('Confirmer la commande')).toBeNull();
    await fireEvent.press(screen.getAllByText('Annuler la commande').at(-1)!);
    expect(mockRpc).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Motif de l’annulation'), '  ab ');
    await fireEvent.press(screen.getAllByText('Annuler la commande').at(-1)!);
    expect(mockRpc).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Motif de l’annulation'), '  Rupture de stock  ');
    await fireEvent.press(screen.getAllByText('Annuler la commande').at(-1)!);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('order_cancel', { p_order: 'o1', p_reason: 'Rupture de stock' }));
    expect(alert).toHaveBeenCalledTimes(1);
    await screen.findByText(/Commande annulée/);
    alert.mockRestore();
  });

  it('a cancelled order: reason in the history, nothing to collect, no action', async () => {
    serve(detailRow({ status: 'cancelled', cancel_reason: 'Rupture de stock' }),
      [{ id: 't1', status: 'cancelled', message: 'Rupture de stock', created_at: new Date().toISOString() }]);
    await render(<CashierOrderScreen />);
    await screen.findByText('Motif : Rupture de stock');
    expect(screen.getByText('Total de la commande')).toBeTruthy();
    expect(screen.getByText(/commande annulée, rien à encaisser/)).toBeTruthy();
    expect(screen.queryByText('Confirmer la commande')).toBeNull();
    expect(screen.queryByLabelText('Motif de l’annulation')).toBeNull();
  });

  it('after pickup: no confirm, no cancel (read only)', async () => {
    serve(detailRow({ status: 'picked_up' }));
    await render(<CashierOrderScreen />);
    await screen.findByText('2 × Bol poulet');
    expect(screen.queryByText('Confirmer la commande')).toBeNull();
    expect(screen.queryByLabelText('Motif de l’annulation')).toBeNull();
  });

  it('an order this account may not read → "introuvable", nothing offered', async () => {
    serve(null);
    await render(<CashierOrderScreen />);
    await screen.findByText('Commande introuvable');
    expect(screen.queryByText('Confirmer la commande')).toBeNull();
  });

  it('load error with retry', async () => {
    mockDb.tables = { orders: () => ({ data: null, error: { message: 'Failed to fetch' } }) };
    await render(<CashierOrderScreen />);
    await screen.findByText('Commande indisponible');
    serve(detailRow());
    await fireEvent.press(screen.getByText('Réessayer'));
    await screen.findByText('2 × Bol poulet');
  });
});
