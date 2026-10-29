// Notification dispatcher core with a fake database (rpc) and a fake Expo
// Push API. Proves the delivery logic; real Expo/APNs/FCM delivery is NOT
// verified by these tests.
import { ClaimedDelivery, postgrestRpc, runDispatch, secretsMatch } from '../supabase/functions/dispatch-notifications/dispatch';

type Call = { name: string; args: any };

function fakeDb(batches: ClaimedDelivery[][], pendingReceipts: { ticket_id: string }[] = []) {
  const calls: Call[] = [];
  const queue = [...batches];
  const rpc = jest.fn(async (name: string, args: any) => {
    calls.push({ name, args });
    if (name === 'nutrition_plan_notifications') return [{ id: 1 }];
    if (name === 'nutrition_claim_deliveries') return queue.shift() ?? [];
    if (name === 'nutrition_pending_receipts') return pendingReceipts;
    return null;
  });
  return { rpc, calls, recorded: () => calls.filter((c) => c.name === 'nutrition_record_delivery').map((c) => c.args) };
}

const delivery = (id: number, tokens: string[]): ClaimedDelivery => ({
  delivery_id: id,
  title: 'Votre objectif du jour est prêt 🎯',
  body: 'Ouvrez L’OPTION…',
  data: { url: 'loption://nutrition', screen: 'nutrition', kind: 'daily_target' },
  tokens,
});

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;

describe('runDispatch', () => {
  it('plans first, then sends one message per active token with the deep link, and records tickets', async () => {
    const db = fakeDb([[delivery(10, ['ExponentPushToken[a]', 'ExponentPushToken[b]'])]]);
    const fetch = jest.fn(async (_url: string, init: any) => {
      const messages = JSON.parse(init.body);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ to: 'ExponentPushToken[a]', data: { url: 'loption://nutrition' }, sound: 'default' });
      return json(200, { data: [{ status: 'ok', id: 't-a' }, { status: 'ok', id: 't-b' }] });
    });
    const summary = await runDispatch({ rpc: db.rpc, fetch: fetch as any, now: () => new Date('2026-10-29T11:30:00Z') });
    expect(db.calls[0]).toEqual({ name: 'nutrition_plan_notifications', args: { p_now: '2026-10-29T11:30:00.000Z' } });
    expect(db.recorded()).toEqual([
      {
        p_delivery_id: 10,
        p_tickets: [
          { token: 'ExponentPushToken[a]', status: 'ok', id: 't-a' },
          { token: 'ExponentPushToken[b]', status: 'ok', id: 't-b' },
        ],
        p_error: null,
      },
    ]);
    expect(summary).toMatchObject({ planned: 1, claimed: 1, sent: 1, failed: 0 });
  });

  it('reports DeviceNotRegistered per token so the database can deactivate it', async () => {
    const db = fakeDb([[delivery(11, ['ExponentPushToken[gone]'])]]);
    const fetch = jest.fn(async () =>
      json(200, { data: [{ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }] })
    );
    const summary = await runDispatch({ rpc: db.rpc, fetch: fetch as any });
    expect(db.recorded()[0].p_tickets).toEqual([{ token: 'ExponentPushToken[gone]', status: 'error', error: 'DeviceNotRegistered' }]);
    expect(summary.failed).toBe(1);
  });

  it('records an error (retried by the database, max 3 attempts) when the push service fails', async () => {
    const db = fakeDb([[delivery(12, ['ExponentPushToken[a]'])]]);
    const fetch = jest.fn(async () => json(503, {}));
    await runDispatch({ rpc: db.rpc, fetch: fetch as any });
    expect(db.recorded()[0]).toEqual({ p_delivery_id: 12, p_tickets: [], p_error: 'push service HTTP 503' });
  });

  it('does not call the push service for a user without an active device', async () => {
    const db = fakeDb([[delivery(13, [])]]);
    const fetch = jest.fn();
    const summary = await runDispatch({ rpc: db.rpc, fetch: fetch as any });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/push/send'), expect.anything());
    expect(db.recorded()[0]).toEqual({ p_delivery_id: 13, p_tickets: [], p_error: null });
    expect(summary.noDevice).toBe(1);
  });

  it('splits more than 100 messages into several requests', async () => {
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`);
    const db = fakeDb([[delivery(14, tokens)]]);
    const sizes: number[] = [];
    const fetch = jest.fn(async (_url: string, init: any) => {
      const messages = JSON.parse(init.body);
      sizes.push(messages.length);
      return json(200, { data: messages.map((_: unknown, i: number) => ({ status: 'ok', id: `id-${i}` })) });
    });
    await runDispatch({ rpc: db.rpc, fetch: fetch as any });
    expect(sizes).toEqual([100, 50]);
    expect(db.recorded()[0].p_tickets).toHaveLength(150);
  });

  it('checks receipts and passes their outcomes (incl. DeviceNotRegistered) to the database', async () => {
    const db = fakeDb([], [{ ticket_id: 'r-1' }, { ticket_id: 'r-2' }]);
    const fetch = jest.fn(async () =>
      json(200, { data: { 'r-1': { status: 'ok' }, 'r-2': { status: 'error', details: { error: 'DeviceNotRegistered' } } } })
    );
    const summary = await runDispatch({ rpc: db.rpc, fetch: fetch as any });
    const receipts = db.calls.find((c) => c.name === 'nutrition_record_receipts')!.args.p_receipts;
    expect(receipts).toEqual([
      { ticket_id: 'r-1', status: 'ok', error: null },
      { ticket_id: 'r-2', status: 'error', error: 'DeviceNotRegistered' },
    ]);
    expect(summary.receiptsChecked).toBe(2);
  });

  it('sends the Expo access token only when configured', async () => {
    const db = fakeDb([[delivery(15, ['ExponentPushToken[a]'])]]);
    const fetch = jest.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer server-side-token');
      return json(200, { data: [{ status: 'ok', id: 'x' }] });
    });
    await runDispatch({ rpc: db.rpc, fetch: fetch as any, expoAccessToken: 'server-side-token' });
    expect(fetch).toHaveBeenCalled();
  });
});

describe('scheduler protection and RPC transport', () => {
  it('accepts only the exact scheduler secret', () => {
    expect(secretsMatch('s3cret', 's3cret')).toBe(true);
    expect(secretsMatch('s3cres', 's3cret')).toBe(false);
    expect(secretsMatch(null, 's3cret')).toBe(false);
    expect(secretsMatch('s3cret', undefined)).toBe(false);
    expect(secretsMatch('', '')).toBe(false);
  });

  it('calls PostgREST RPC endpoints with the service key and surfaces errors', async () => {
    const fetch = jest.fn(async () => json(200, [{ a: 1 }]));
    const rpc = postgrestRpc('https://p.supabase.co/', 'service-key', fetch as any);
    await expect(rpc('nutrition_claim_deliveries', { p_limit: 5 })).resolves.toEqual([{ a: 1 }]);
    expect(fetch).toHaveBeenCalledWith('https://p.supabase.co/rest/v1/rpc/nutrition_claim_deliveries', expect.objectContaining({ method: 'POST' }));
    const failing = postgrestRpc('https://p.supabase.co', 'k', (async () => json(403, { message: 'denied' })) as any);
    await expect(failing('x', {})).rejects.toThrow('HTTP 403');
  });
});
