// src/activity/sync.ts
// Reads the last days from the connected health platform and sends them to
// the server. Network failures are retried with backoff; a refusal by the
// server (validation, permission) is not. Running it again is safe: each
// day and source is one row, each imported workout is unique by its
// provider id.
import { recentDayWindows } from './dayBounds';
import type { ActivityProvider, ImportedWorkout } from './types';
import { ApiError, DayRow, Result, toDayRows } from '../services/activityApi';

export const SYNC_DAYS = 7;

export type SyncOutcome =
  | { status: 'ok'; at: string; days: number; workouts: number; withData: number }
  | { status: 'provider_error' | 'network_error' | 'rejected'; at: string; message: string };

export interface SyncDeps {
  provider: ActivityProvider;
  timeZone: string;
  today: string;
  upsertDays: (rows: DayRow[]) => Promise<Result<true>>;
  upsertWorkouts?: (workouts: ImportedWorkout[]) => Promise<Result<true>>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  days?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// PostgreSQL SQLSTATEs (5 characters) and PostgREST codes are answers from
// the server: retrying cannot change them. Anything else is transport.
export function isTransient(error: ApiError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST')) return false;
  return true;
}

export async function withRetry<T>(
  call: () => Promise<Result<T>>,
  { maxAttempts = 3, sleep = defaultSleep }: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<Result<T>> {
  let last: Result<T> = { data: null, error: { message: 'not attempted' } };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await call();
    } catch (e: any) {
      last = { data: null, error: { message: String(e?.message ?? e) } };
    }
    if (!last.error || !isTransient(last.error) || attempt === maxAttempts) return last;
    await sleep(1000 * 2 ** (attempt - 1));
  }
  return last;
}

export async function syncActivity(deps: SyncDeps): Promise<SyncOutcome> {
  const now = deps.now ?? (() => new Date());
  const retry = { maxAttempts: deps.maxAttempts, sleep: deps.sleep };
  const windows = recentDayWindows(deps.today, deps.timeZone, deps.days ?? SYNC_DAYS);
  const at = () => now().toISOString();

  let readings;
  let workouts: ImportedWorkout[] = [];
  try {
    readings = await deps.provider.readDays(windows);
    if (deps.provider.readWorkouts && deps.upsertWorkouts) {
      workouts = await deps.provider.readWorkouts(windows[0].start, now());
    }
  } catch (e: any) {
    return { status: 'provider_error', at: at(), message: String(e?.message ?? e) };
  }

  const rows = toDayRows(readings, deps.provider.id, deps.timeZone);
  const daysResult = await withRetry(() => deps.upsertDays(rows), retry);
  if (daysResult.error) {
    return { status: isTransient(daysResult.error) ? 'network_error' : 'rejected', at: at(), message: daysResult.error.message ?? '' };
  }
  if (workouts.length > 0 && deps.upsertWorkouts) {
    const w = await withRetry(() => deps.upsertWorkouts!(workouts), retry);
    if (w.error) {
      return { status: isTransient(w.error) ? 'network_error' : 'rejected', at: at(), message: w.error.message ?? '' };
    }
  }
  const withData = readings.filter((r) => r.steps !== null || r.distanceM !== null || r.activeKcal !== null).length;
  return { status: 'ok', at: at(), days: rows.length, workouts: workouts.length, withData };
}
