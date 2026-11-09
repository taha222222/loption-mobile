// Kitchen rules as the board applies them: the one step offered per status
// (from the shared transition table), column order, and how server answers
// are worded. The kitchen never confirms, cancels or touches payment.
import {
  KITCHEN_STATUSES,
  boardTime,
  describeKitchenResult,
  groupByTab,
  kitchenNextStep,
  portions,
  sinceLabel,
} from '../src/kitchen/kitchenOrders';
import { ORDER_STATUSES, ORDER_TRANSITIONS } from '../src/orders/orderWorkflow';

describe('step offered to kitchen staff', () => {
  it.each([
    ['pending', null],
    ['confirmed', 'preparing'],
    ['preparing', 'ready'],
    ['ready', null],
    ['picked_up', null],
    ['on_the_way', null],
    ['delivered', null],
    ['cancelled', null],
  ] as const)('%s → %s', (status, step) => {
    expect(kitchenNextStep({ status, workflow_version: 1 })).toBe(step);
  });

  it('agrees with the shared transition table for every status', () => {
    for (const status of ORDER_STATUSES) {
      const rows = ORDER_TRANSITIONS.filter((t) => t.from === status && t.actor === 'kitchen_staff').map((t) => t.to);
      const step = kitchenNextStep({ status, workflow_version: 1 });
      expect(step === null ? [] : [step]).toEqual(rows);
    }
  });

  it('never offers a step on a historical order', () => {
    expect(kitchenNextStep({ status: 'confirmed', workflow_version: null })).toBeNull();
  });

  it('the board covers exactly the kitchen statuses', () => {
    expect(KITCHEN_STATUSES).toEqual(['confirmed', 'preparing', 'ready']);
  });
});

describe('board order', () => {
  const o = (id: string, status: string, t: Partial<Record<'created_at' | 'confirmed_at' | 'preparing_at' | 'ready_at', string>>) => ({
    id, status, created_at: '2026-11-09T09:00:00Z', ...t,
  });

  it('groups by column and puts the order waiting longest in its column first', () => {
    const g = groupByTab([
      o('c2', 'confirmed', { confirmed_at: '2026-11-09T10:05:00Z' }),
      o('c1', 'confirmed', { confirmed_at: '2026-11-09T10:01:00Z' }),
      o('p1', 'preparing', { confirmed_at: '2026-11-09T09:30:00Z', preparing_at: '2026-11-09T10:10:00Z' }),
      o('r1', 'ready', { ready_at: '2026-11-09T10:20:00Z' }),
      o('x', 'pending', {}),
      o('y', 'cancelled', {}),
    ]);
    expect(g.todo.map((x) => x.id)).toEqual(['c1', 'c2']);
    expect(g.preparing.map((x) => x.id)).toEqual(['p1']);
    expect(g.ready.map((x) => x.id)).toEqual(['r1']);
  });

  it('time in the column: confirmation, start of preparation, ready', () => {
    expect(boardTime({ status: 'preparing', created_at: 'a', confirmed_at: 'b', preparing_at: 'c' })).toBe('c');
    expect(boardTime({ status: 'confirmed', created_at: 'a', confirmed_at: null })).toBe('a');
  });

  it('portions and waiting time', () => {
    expect(portions([{ quantity: 2 }, { quantity: 1 }])).toBe(3);
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(sinceLabel('2026-11-09T11:48:00Z', now)).toBe('depuis 12 min');
    expect(sinceLabel('2026-11-09T10:50:00Z', now)).toBe('depuis 1 h 10');
    expect(sinceLabel('2026-11-09T11:59:59Z', now)).toBe('à l’instant');
  });
});

describe('server answers in words', () => {
  it('done / already done', () => {
    expect(describeKitchenResult('LO-1', 'preparing', { ok: true, changed: true })).toMatchObject({ tone: 'success', message: 'LO-1 : préparation commencée.' });
    expect(describeKitchenResult('LO-1', 'ready', { ok: true, changed: true }).message).toBe('LO-1 est prête pour le livreur.');
    expect(describeKitchenResult('LO-1', 'ready', { ok: true, changed: false })).toMatchObject({ tone: 'info', refresh: true });
  });

  it('a refused step is never reported as done', () => {
    for (const kind of ['invalid', 'not_allowed', 'not_available', 'network', 'other'] as const) {
      const f = describeKitchenResult('LO-1', 'preparing', { ok: false, error: { kind, message: 'x' } });
      expect(f.tone).toBe('error');
      expect(f.message).not.toMatch(/commencée|prête pour/);
    }
  });

  it('cancelled or moved meanwhile → said so and reloaded; offline → not reloaded', () => {
    expect(describeKitchenResult('LO-1', 'preparing', { ok: false, error: { kind: 'invalid', message: 'invalid order transition cancelled -> preparing' } }))
      .toMatchObject({ refresh: true, message: expect.stringMatching(/annulée par la caisse/) });
    expect(describeKitchenResult('LO-1', 'ready', { ok: false, error: { kind: 'network', message: 'offline' } })).toMatchObject({ refresh: false });
  });
});
