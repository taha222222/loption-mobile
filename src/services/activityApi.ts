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
}

export function toDayRows(readings: DailyReading[], source: ActivitySource, timeZone: string): DayRow[] {
  return readings.map((r) => ({
    local_date: r.date,
    source,
    time_zone: timeZone,
    steps: r.steps,
    distance_m: source === 'device_motion' ? null : r.distanceM,
    active_energy_kcal: source === 'device_motion' ? null : r.activeKcal,
    total_energy_kcal: source === 'device_motion' ? null : r.totalKcal,
  }));
}

// One row per (day, source): a re-sync updates it.
export async function upsertActivityDays(rows: DayRow[]): Promise<Result<true>> {
  if (rows.length === 0) return { data: true, error: null };
  const { error } = await supabase.from('activity_daily_totals').upsert(rows, { onConflict: 'user_id,local_date,source' });
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
