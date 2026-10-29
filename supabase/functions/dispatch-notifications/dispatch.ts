// supabase/functions/dispatch-notifications/dispatch.ts
// Runtime-independent core of the notification dispatcher (Deno Edge
// Function in production, Node/Jest in tests). It never decides WHO gets a
// notification — the database planner does (public.nutrition_plan_notifications)
// — it only delivers queued rows through the Expo Push API and records the
// provider's answers.
//
// Uses only standard fetch and plain types so it runs unchanged in Deno and
// Node (type stripping); no imports.

export interface ClaimedDelivery {
  delivery_id: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  tokens: string[];
}

export interface Ticket {
  token: string;
  status: 'ok' | 'error';
  id?: string;
  error?: string;
}

export interface DispatchDeps {
  // Calls a Postgres function through PostgREST with the service role.
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch: typeof fetch;
  expoPushUrl?: string;
  expoReceiptsUrl?: string;
  // Optional Expo access token (enhanced push security), server-side only.
  expoAccessToken?: string;
  now?: () => Date;
}

export interface DispatchSummary {
  planned: number;
  claimed: number;
  sent: number;
  failed: number;
  noDevice: number;
  receiptsChecked: number;
}

interface ExpoTicket {
  status?: string;
  id?: string;
  details?: { error?: string };
  message?: string;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const CHUNK = 100; // Expo accepts at most 100 messages per request
const MAX_ROUNDS = 10;

function headers(deps: DispatchDeps): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (deps.expoAccessToken) h.Authorization = `Bearer ${deps.expoAccessToken}`;
  return h;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Sends one batch of claimed deliveries and returns per-delivery tickets,
// or an error message per delivery when the request itself failed.
async function sendBatch(
  deps: DispatchDeps,
  rows: ClaimedDelivery[]
): Promise<Map<number, { tickets: Ticket[]; error: string | null }>> {
  const result = new Map<number, { tickets: Ticket[]; error: string | null }>();
  const messages: { deliveryId: number; token: string; message: Record<string, unknown> }[] = [];
  for (const row of rows) {
    result.set(row.delivery_id, { tickets: [], error: null });
    for (const token of row.tokens) {
      messages.push({
        deliveryId: row.delivery_id,
        token,
        message: { to: token, title: row.title, body: row.body, data: row.data, sound: 'default', channelId: 'default' },
      });
    }
  }
  for (const part of chunks(messages, CHUNK)) {
    let tickets: ExpoTicket[] | null = null;
    let error: string | null = null;
    try {
      const response = await deps.fetch(deps.expoPushUrl ?? EXPO_PUSH_URL, {
        method: 'POST',
        headers: headers(deps),
        body: JSON.stringify(part.map((p) => p.message)),
      });
      if (!response.ok) {
        error = `push service HTTP ${response.status}`;
      } else {
        const body = (await response.json()) as { data?: ExpoTicket[] };
        tickets = Array.isArray(body?.data) && body.data.length === part.length ? body.data : null;
        if (!tickets) error = 'push service returned an unexpected response';
      }
    } catch (e) {
      error = `push service unreachable: ${e instanceof Error ? e.message : String(e)}`;
    }
    part.forEach((p, i) => {
      const entry = result.get(p.deliveryId)!;
      if (error || !tickets) {
        entry.error = error;
        return;
      }
      const t = tickets[i];
      entry.tickets.push(
        t?.status === 'ok'
          ? { token: p.token, status: 'ok', id: t.id }
          : { token: p.token, status: 'error', error: t?.details?.error ?? t?.message ?? 'unknown error' }
      );
    });
  }
  return result;
}

async function checkReceipts(deps: DispatchDeps): Promise<number> {
  const pending = ((await deps.rpc('nutrition_pending_receipts', { p_limit: 300 })) ?? []) as {
    ticket_id: string;
  }[];
  if (pending.length === 0) return 0;
  let checked = 0;
  for (const part of chunks(pending, 300)) {
    try {
      const response = await deps.fetch(deps.expoReceiptsUrl ?? EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: headers(deps),
        body: JSON.stringify({ ids: part.map((p) => p.ticket_id) }),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        data?: Record<string, { status: string; details?: { error?: string }; message?: string }>;
      };
      const receipts = Object.entries(body?.data ?? {}).map(([ticketId, r]) => ({
        ticket_id: ticketId,
        status: r.status === 'ok' ? 'ok' : 'error',
        error: r.status === 'ok' ? null : (r.details?.error ?? r.message ?? 'unknown error'),
      }));
      if (receipts.length > 0) {
        await deps.rpc('nutrition_record_receipts', { p_receipts: receipts });
        checked += receipts.length;
      }
    } catch {
      // Receipts are retried on the next run.
    }
  }
  return checked;
}

export async function runDispatch(deps: DispatchDeps, options: { limit?: number } = {}): Promise<DispatchSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const planned = ((await deps.rpc('nutrition_plan_notifications', { p_now: now.toISOString() })) ?? []) as unknown[];
  const summary: DispatchSummary = {
    planned: planned.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    noDevice: 0,
    receiptsChecked: 0,
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rows = ((await deps.rpc('nutrition_claim_deliveries', { p_limit: options.limit ?? 100 })) ??
      []) as ClaimedDelivery[];
    if (rows.length === 0) break;
    summary.claimed += rows.length;
    const outcomes = await sendBatch(deps, rows);
    for (const row of rows) {
      const outcome = outcomes.get(row.delivery_id)!;
      await deps.rpc('nutrition_record_delivery', {
        p_delivery_id: row.delivery_id,
        p_tickets: outcome.tickets,
        p_error: outcome.error,
      });
      if (row.tokens.length === 0) summary.noDevice += 1;
      else if (outcome.tickets.some((t) => t.status === 'ok')) summary.sent += 1;
      else summary.failed += 1;
    }
  }

  summary.receiptsChecked = await checkReceipts(deps);
  return summary;
}

// PostgREST RPC caller with the service-role key (server-side only).
export function postgrestRpc(baseUrl: string, serviceRoleKey: string, fetchImpl: typeof fetch) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(`rpc ${name} failed: HTTP ${response.status} ${await response.text()}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

// Constant-time comparison for the scheduler secret.
export function secretsMatch(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
