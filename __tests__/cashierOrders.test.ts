// Cashier rules as the screens apply them: which actions are offered (from the
// shared transition table), the cancellation reason, how server answers are
// worded, and that confirmation never reads as payment.
import {
  CASHIER_TAB_STATUSES,
  cashierActions,
  describeActionResult,
  formatLineOptions,
  formatStaffTime,
  paymentLabel,
  phoneHref,
  validateCancelReason,
  waitingLabel,
} from '../src/cashier/cashierOrders';
import { ORDER_STATUSES, ORDER_TRANSITIONS } from '../src/orders/orderWorkflow';

describe('actions offered to a cashier or admin', () => {
  it.each([
    ['pending', true, true],
    ['confirmed', false, true],
    ['preparing', false, true],
    ['ready', false, true],
    ['picked_up', false, false],
    ['on_the_way', false, false],
    ['delivered', false, false],
    ['cancelled', false, false],
  ] as const)('%s: confirm %s, cancel %s', (status, confirm, cancel) => {
    expect(cashierActions({ status, workflow_version: 1 })).toEqual({ confirm, cancel });
  });

  it('agrees with the shared transition table for every status', () => {
    for (const status of ORDER_STATUSES) {
      const rows = ORDER_TRANSITIONS.filter((t) => t.from === status && t.actor === 'cashier');
      expect(cashierActions({ status, workflow_version: 1 })).toEqual({
        confirm: rows.some((t) => t.to === 'confirmed'),
        cancel: rows.some((t) => t.to === 'cancelled'),
      });
    }
  });

  it('offers nothing on a historical (pre-workflow) order', () => {
    expect(cashierActions({ status: 'pending', workflow_version: null })).toEqual({ confirm: false, cancel: false });
  });

  it('lists every lifecycle status in exactly one queue tab', () => {
    const all = [...CASHIER_TAB_STATUSES.pending, ...CASHIER_TAB_STATUSES.active, ...CASHIER_TAB_STATUSES.done];
    expect([...all].sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe('cancellation reason', () => {
  it('is required (3 characters after trimming) and limited to 300', () => {
    expect(validateCancelReason('')).toMatchObject({ ok: false });
    expect(validateCancelReason('  ab  ')).toMatchObject({ ok: false });
    expect(validateCancelReason('  Client injoignable ')).toEqual({ ok: true, reason: 'Client injoignable' });
    expect(validateCancelReason('x'.repeat(301))).toMatchObject({ ok: false });
    expect(validateCancelReason('x'.repeat(300))).toMatchObject({ ok: true });
  });
});

describe('server answers in words', () => {
  it('confirmation done / already done; never says paid', () => {
    const done = describeActionResult('confirm', { ok: true, changed: true });
    expect(done).toMatchObject({ tone: 'success', refresh: true });
    expect(done.message).toMatch(/à la livraison/);
    expect(done.message).not.toMatch(/payée|encaissé\b/);
    expect(describeActionResult('confirm', { ok: true, changed: false })).toMatchObject({ tone: 'info', refresh: true });
  });

  it('a refused action is never reported as done', () => {
    for (const kind of ['invalid', 'not_allowed', 'not_available', 'network', 'other'] as const) {
      const f = describeActionResult('confirm', { ok: false, error: { kind, message: 'x' } });
      expect(f.tone).toBe('error');
      expect(f.message).not.toMatch(/^Commande confirmée/);
    }
  });

  it('state changed meanwhile → reload; network → nothing changed, no reload', () => {
    expect(describeActionResult('confirm', { ok: false, error: { kind: 'invalid', message: 'invalid order transition cancelled -> confirmed' } }))
      .toMatchObject({ refresh: true });
    expect(describeActionResult('cancel', { ok: false, error: { kind: 'network', message: 'offline' } }))
      .toMatchObject({ refresh: false, message: expect.stringMatching(/rien n’a été modifié/) });
  });

  it('missing reason from the server is explained as such', () => {
    expect(describeActionResult('cancel', { ok: false, error: { kind: 'invalid', message: 'a cancellation reason is required' } }).message)
      .toMatch(/motif/);
  });
});

describe('display helpers', () => {
  it('payment: cash on delivery, the server state as is', () => {
    expect(paymentLabel('cash', 'pending')).toBe('Paiement à la livraison (espèces) · à encaisser à la livraison');
    expect(paymentLabel('cash', 'paid')).toMatch(/encaissé$/);
    expect(paymentLabel('cash', 'failed')).toMatch(/non encaissé$/);
    expect(paymentLabel('cash', 'pending', 'cancelled')).toBe('Paiement à la livraison (espèces) · commande annulée, rien à encaisser');
    expect(paymentLabel('cash', 'pending', 'confirmed')).toMatch(/à encaisser à la livraison$/);
  });

  it('line options from the order snapshot', () => {
    expect(formatLineOptions([{ group: 'Sauce', name: 'Harissa', price: 0 }, { group: 'Suppléments', name: 'Fromage', price: 5 }]))
      .toBe('Sauce : Harissa · Suppléments : Fromage');
    expect(formatLineOptions([])).toBeNull();
    expect(formatLineOptions(null)).toBeNull();
    expect(formatLineOptions([{ name: '' }, 'x'])).toBeNull();
  });

  it('phone link only for a usable number', () => {
    expect(phoneHref('+212 6 12 34 56 78')).toBe('tel:+212612345678');
    expect(phoneHref(null)).toBeNull();
    expect(phoneHref('12')).toBeNull();
  });

  it('waiting time and staff time', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(waitingLabel('2026-11-08T11:59:40Z', now)).toBe('à l’instant');
    expect(waitingLabel('2026-11-08T11:48:00Z', now)).toBe('il y a 12 min');
    expect(waitingLabel('2026-11-08T10:55:00Z', now)).toBe('il y a 1 h 05');
    expect(formatStaffTime(null)).toBe('—');
    expect(formatStaffTime('nope')).toBe('—');
    expect(formatStaffTime('2026-11-08T12:05:00')).toBe('08/11 12:05');
  });
});
