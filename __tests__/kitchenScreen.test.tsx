// Kitchen board against a mocked Supabase client: what is read (no phone,
// address or amounts), the one button per status, and that every change goes
// through order_kitchen_update (never a direct write), with double taps,
// refusals, cancellations by the cashier and retries handled.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import KitchenBoardScreen from '../app/kitchen/index';
import { KITCHEN_ITEM_COLUMNS, KITCHEN_ORDER_COLUMNS } from '../src/services/kitchenApi';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useFocusEffect: () => undefined }));

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
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject);
      return builder;
    },
  },
}));

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();
const order = (id: string, number: string, status: string, o: Record<string, unknown> = {}) => ({
  id, order_number: number, status, workflow_version: 1, created_at: iso(30), confirmed_at: iso(20),
  preparing_at: status === 'preparing' || status === 'ready' ? iso(10) : null, ready_at: status === 'ready' ? iso(2) : null,
  status_changed_at: iso(2), driver_id: null, ...o,
});
const lines = [
  { id: 'i1', order_id: 'o1', meal_name: 'Bol poulet', quantity: 2, options: [{ group: 'Sauce', name: 'Harissa', price: 0 }], notes: 'sans oignon' },
  { id: 'i2', order_id: 'o1', meal_name: 'Salade', quantity: 1, options: [], notes: null },
  { id: 'i3', order_id: 'o2', meal_name: 'Tajine', quantity: 1, options: [], notes: null },
];

function serve(orders: unknown[]) {
  mockDb.tables = { orders: () => ({ data: orders, error: null }), order_items: () => ({ data: lines, error: null }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.tables = {};
  mockDb.calls = [];
  mockDb.writes = [];
});
afterEach(() => expect(mockDb.writes).toEqual([]));

it('reads only what the kitchen prepares: no phone, address, amounts or account', async () => {
  serve([order('o1', 'LO-1', 'confirmed')]);
  await render(<KitchenBoardScreen />);
  await screen.findByText('LO-1');
  const o = mockDb.calls.find((c) => c.table === 'orders')!;
  expect(o.ops).toEqual([
    ['select', KITCHEN_ORDER_COLUMNS],
    ['not', 'workflow_version', 'is', null],
    ['in', 'status', ['confirmed', 'preparing', 'ready']],
    ['order', 'created_at', { ascending: true }],
    ['limit', 100],
  ]);
  const i = mockDb.calls.find((c) => c.table === 'order_items')!;
  expect(i.ops).toContainEqual(['in', 'order_id', ['o1']]);
  for (const cols of [KITCHEN_ORDER_COLUMNS, KITCHEN_ITEM_COLUMNS]) {
    expect(cols).not.toMatch(/phone|address|total|subtotal|fee|user_id|price|payment/);
  }
});

it('columns with counts; lines with choices and notes; one button per status', async () => {
  serve([order('o1', 'LO-1', 'confirmed'), order('o2', 'LO-2', 'preparing'), order('o3', 'LO-3', 'ready')]);
  await render(<KitchenBoardScreen />);
  await screen.findByText('LO-1');
  expect(screen.getByText('À préparer (1)')).toBeTruthy();
  expect(screen.getByText('En préparation (1)')).toBeTruthy();
  expect(screen.getByText('Prêtes (1)')).toBeTruthy();
  expect(screen.getByText('2 × Bol poulet')).toBeTruthy();
  expect(screen.getByText('Sauce : Harissa')).toBeTruthy();
  expect(screen.getByText('Note : sans oignon')).toBeTruthy();
  expect(screen.getByText(/^3 portions · depuis 20 min$/)).toBeTruthy();
  expect(screen.getByText('Commencer la préparation')).toBeTruthy();
  expect(screen.queryByText('LO-2')).toBeNull();
  expect(screen.queryByText(/MAD|Confirmer|Annuler|Paiement/)).toBeNull();

  await fireEvent.press(screen.getByText('En préparation (1)'));
  expect(screen.getByText('LO-2')).toBeTruthy();
  expect(screen.getByText('Commande prête')).toBeTruthy();
  expect(screen.queryByText('Commencer la préparation')).toBeNull();

  await fireEvent.press(screen.getByText('Prêtes (1)'));
  expect(screen.getByText('LO-3')).toBeTruthy();
  expect(screen.getByText('En attente du livreur (pas encore assigné par la caisse)')).toBeTruthy();
  expect(screen.queryByText('Commande prête')).toBeNull();
  expect(screen.queryByText('Commencer la préparation')).toBeNull();
});

it('start preparing: order_kitchen_update once (double tap), then the board reloads', async () => {
  serve([order('o1', 'LO-1', 'confirmed')]);
  let release: (v: unknown) => void = () => {};
  mockRpc.mockImplementation(() => new Promise((r) => (release = r)));
  await render(<KitchenBoardScreen />);
  const button = await screen.findByText('Commencer la préparation');
  await fireEvent.press(button);
  await fireEvent.press(button);
  serve([order('o1', 'LO-1', 'preparing')]);
  await act(async () => release({ data: 'changed', error: null }));
  await screen.findByText('LO-1 : préparation commencée.');
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('order_kitchen_update', { p_order: 'o1', p_status: 'preparing' });
  expect(screen.getByText('À préparer (0)')).toBeTruthy();
  expect(screen.getByText('En préparation (1)')).toBeTruthy();
});

it('ready: order_kitchen_update(ready)', async () => {
  serve([order('o2', 'LO-2', 'preparing')]);
  mockRpc.mockResolvedValue({ data: 'changed', error: null });
  await render(<KitchenBoardScreen />);
  await fireEvent.press(await screen.findByText('En préparation (1)'));
  await fireEvent.press(screen.getByText('Commande prête'));
  await screen.findByText('LO-2 est prête pour le livreur.');
  expect(mockRpc).toHaveBeenCalledWith('order_kitchen_update', { p_order: 'o2', p_status: 'ready' });
});

it('cancelled by the cashier meanwhile → explained and the order leaves the board', async () => {
  serve([order('o1', 'LO-1', 'confirmed')]);
  mockRpc.mockImplementation(async () => {
    serve([]);
    return { data: null, error: { code: '22023', message: 'invalid order transition cancelled -> preparing' } };
  });
  await render(<KitchenBoardScreen />);
  await fireEvent.press(await screen.findByText('Commencer la préparation'));
  await screen.findByText(/LO-1 a changé entre-temps \(annulée par la caisse/);
  expect(screen.queryByText('Commencer la préparation')).toBeNull();
  expect(screen.getByText('Aucune commande à préparer')).toBeTruthy();
});

it('another kitchen / revoked role → refused, said so', async () => {
  serve([order('o1', 'LO-1', 'confirmed')]);
  mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'order not found or not allowed' } });
  await render(<KitchenBoardScreen />);
  await fireEvent.press(await screen.findByText('Commencer la préparation'));
  await screen.findByText(/ce compte ne prépare pas les commandes de cette cuisine/);
});

it('already started by another cook → "déjà", no false success', async () => {
  serve([order('o1', 'LO-1', 'confirmed')]);
  mockRpc.mockResolvedValue({ data: 'unchanged', error: null });
  await render(<KitchenBoardScreen />);
  await fireEvent.press(await screen.findByText('Commencer la préparation'));
  await screen.findByText('LO-1 était déjà en préparation. Rien n’a été modifié.');
});

it('network failure → nothing changed; retry works', async () => {
  serve([order('o1', 'LO-1', 'confirmed')]);
  mockRpc.mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce({ data: 'changed', error: null });
  await render(<KitchenBoardScreen />);
  await fireEvent.press(await screen.findByText('Commencer la préparation'));
  await screen.findByText(/Pas de connexion : rien n’a été modifié/);
  await fireEvent.press(screen.getByText('Commencer la préparation'));
  await screen.findByText('LO-1 : préparation commencée.');
  expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('empty board, load error with retry, realtime subscription', async () => {
  mockDb.tables = { orders: () => ({ data: null, error: { message: 'Failed to fetch' } }) };
  await render(<KitchenBoardScreen />);
  await screen.findByText('Commandes indisponibles');
  serve([]);
  await fireEvent.press(screen.getByText('Réessayer'));
  await screen.findByText('Aucune commande à préparer');
  expect(mockDb.calls.filter((c) => c.table === 'order_items')).toHaveLength(0);
  expect(mockChannel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'orders' }), expect.any(Function));
});

it('assigned driver shown on a ready order', async () => {
  serve([order('o3', 'LO-3', 'ready', { driver_id: 'd1' })]);
  await render(<KitchenBoardScreen />);
  await fireEvent.press(await screen.findByText('Prêtes (1)'));
  expect(screen.getByText('En attente du livreur (livreur assigné)')).toBeTruthy();
});
