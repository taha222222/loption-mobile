// src/services/activityApi.ts
// Supabase calls for daily activity. Every call runs as the signed-in
// customer: RLS limits rows to the owner and the database trigger stamps
// the owner, sync time and day coverage.
import { supabase } from '../lib/supabase';
import type { ActivitySource, DailyReading } from '../activity/types';
import { DailyBalance, toDailyBalances } from '../activity/dailyBalance';

export type ApiError = { code?: string; message?: string };
export type Result<T> = { data: T; error: null } | { data: null; error: ApiError };

export interface DayRow {
  local_date: string;
  source: ActivitySource;
  time_zone: string;
  steps: number | null;
  distance_m: number | null;
  active_energy_kcal: number | null;
  total_energy_kcal: number | null;
  measured_from?: string | null;
  measured_to?: string | null;
}

// The phone sensor (device_motion) measures steps and, on iPhone, walking
// distance; never energy. Days without a reading are not sent.
export function toDayRows(readings: DailyReading[], source: ActivitySource, timeZone: string): DayRow[] {
  const phone = source === 'device_motion';
  return readings
    .filter((r) => !phone || r.steps !== null)
    .map((r) => ({
      local_date: r.date,
      source,
      time_zone: timeZone,
      steps: r.steps,
      distance_m: phone && r.steps === null ? null : r.distanceM,
      active_energy_kcal: phone ? null : r.activeKcal,
      total_energy_kcal: phone ? null : r.totalKcal,
      ...(phone ? { measured_from: r.measuredFrom ?? null, measured_to: r.measuredTo ?? null } : {}),
    }));
}

// A server without the standalone migration has no measurement window and
// refuses a phone distance: the same days are sent as steps only.
export function legacyPhoneRows(rows: DayRow[]): DayRow[] {
  return rows.map(({ measured_from: _f, measured_to: _t, ...r }) => (r.source === 'device_motion' ? { ...r, distance_m: null } : r));
}

const isSchemaMismatch = (e: ApiError) =>
  e.code === 'PGRST204' ||
  /measured_(from|to)/.test(String(e.message ?? '')) ||
  (e.code === '23514' && /"activity_daily_totals_check"/.test(String(e.message ?? '')));

// One row per (day, source): a re-sync updates it.
export async function upsertActivityDays(rows: DayRow[]): Promise<Result<true>> {
  if (rows.length === 0) return { data: true, error: null };
  let { error } = await supabase.from('activity_daily_totals').upsert(rows, { onConflict: 'user_id,local_date,source' });
  if (error && rows.some((r) => r.source === 'device_motion') && isSchemaMismatch(error)) {
    ({ error } = await supabase.from('activity_daily_totals').upsert(legacyPhoneRows(rows), { onConflict: 'user_id,local_date,source' }));
  }
  if (error) return { data: null, error };
  return { data: true, error: null };
}

// Disconnect: removes every day imported from this source (the customer's own rows only).
export async function deleteActivitySource(source: ActivitySource): Promise<Result<true>> {
  const { error } = await supabase.from('activity_daily_totals').delete().eq('source', source);
  if (error) return { data: null, error };
  return { data: true, error: null };
}

// Daily balance (budget, consumed, remaining, movement, workouts) for each day.
export async function fetchDailyBalance(from: string, to: string, today: string): Promise<Result<DailyBalance[]>> {
  const { data, error } = await supabase.rpc('activity_daily_summary', { p_from: from, p_to: to, p_today: today });
  if (error) return { data: null, error };
  return { data: toDailyBalances(data as any[], from, to), error: null };
}
