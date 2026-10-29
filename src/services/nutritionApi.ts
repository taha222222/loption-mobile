// src/services/nutritionApi.ts
// Supabase calls for tracking and reminders. Every call runs as the signed-in
// customer: RLS and the database triggers decide what is allowed and compute
// calories, targets and streaks. Nothing here can submit a calorie value.
import { supabase } from '../lib/supabase';
import { toDaySummaries, toStreak, DaySummary, StreakInfo } from '../nutrition/tracking';

export interface LogEntry {
  id: string;
  mealName: string;
  servings: number;
  kcal: number;
  kcalPerServing: number;
  orderItemId: string | null;
  loggedAt: string;
}

export interface LoggableMeal {
  id: string;
  name: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface OrderedMeal {
  orderItemId: string;
  mealId: string;
  mealName: string;
  quantity: number;
  orderedAt: string;
}

export interface NotificationPreferences {
  reminders_enabled: boolean;
  daily_target_enabled: boolean;
  progress_enabled: boolean;
  evening_enabled: boolean;
  milestones_enabled: boolean;
  reengagement_enabled: boolean;
  daily_time: string;
  progress_time: string;
  evening_time: string;
  quiet_start: string;
  quiet_end: string;
  time_zone: string;
}

// Defaults proposed for review (see docs/v1/CALORIE_TRACKING_AND_ENGAGEMENT.md):
// everything off until the customer opts in.
export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'time_zone'> = {
  reminders_enabled: false,
  daily_target_enabled: true,
  progress_enabled: false,
  evening_enabled: false,
  milestones_enabled: true,
  reengagement_enabled: false,
  daily_time: '12:00',
  progress_time: '16:00',
  evening_time: '20:30',
  quiet_start: '22:00',
  quiet_end: '08:00',
};

type Result<T> = { data: T; error: null } | { data: null; error: { code?: string; message?: string } };

export async function fetchSummary(from: string, to: string, today: string): Promise<Result<DaySummary[]>> {
  const { data, error } = await supabase.rpc('nutrition_daily_summary', { p_from: from, p_to: to, p_today: today });
  if (error) return { data: null, error };
  return { data: toDaySummaries(data as any[], from, to), error: null };
}

export async function fetchStreak(today: string): Promise<Result<StreakInfo>> {
  const { data, error } = await supabase.rpc('nutrition_streak', { p_today: today });
  if (error) return { data: null, error };
  return { data: toStreak(Array.isArray(data) ? data[0] : data), error: null };
}

export async function fetchEntries(date: string): Promise<Result<LogEntry[]>> {
  const { data, error } = await supabase
    .from('nutrition_log_entries')
    .select('id, meal_name, servings, kcal, kcal_per_serving, order_item_id, logged_at')
    .eq('local_date', date)
    .is('deleted_at', null)
    .order('logged_at', { ascending: true });
  if (error) return { data: null, error };
  return {
    data: (data ?? []).map((r: any) => ({
      id: r.id,
      mealName: r.meal_name,
      servings: Number(r.servings),
      kcal: Number(r.kcal),
      kcalPerServing: Number(r.kcal_per_serving),
      orderItemId: r.order_item_id ?? null,
      loggedAt: r.logged_at,
    })),
    error: null,
  };
}

export interface LogMealInput {
  requestId: string; // idempotency key: the same value for retries of one tap
  mealId: string;
  servings: number;
  localDate: string;
  timeZone: string;
  orderItemId?: string | null;
}

// Retries with the same requestId never create a second entry
// (ON CONFLICT (user_id, client_request_id) DO NOTHING).
export async function logMeal(input: LogMealInput): Promise<Result<true>> {
  const { error } = await supabase.from('nutrition_log_entries').upsert(
    {
      client_request_id: input.requestId,
      meal_id: input.mealId,
      servings: input.servings,
      local_date: input.localDate,
      time_zone: input.timeZone,
      order_item_id: input.orderItemId ?? null,
    },
    { onConflict: 'user_id,client_request_id', ignoreDuplicates: true }
  );
  if (error) return { data: null, error };
  return { data: true, error: null };
}

export async function removeEntry(id: string): Promise<Result<true>> {
  const { error } = await supabase
    .from('nutrition_log_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return { data: null, error };
  return { data: true, error: null };
}

// Meals with a positive calorie value (others cannot be logged).
export async function fetchLoggableMeals(): Promise<Result<LoggableMeal[]>> {
  const { data, error } = await supabase
    .from('meals')
    .select('id, name, calories, protein, carbs, fat')
    .gt('calories', 0)
    .order('name', { ascending: true });
  if (error) return { data: null, error };
  return { data: (data ?? []) as LoggableMeal[], error: null };
}

// The customer's own recent orders (RLS) with their items.
export async function fetchOrderedMeals(sinceIso: string): Promise<Result<OrderedMeal[]>> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, order_items(id, meal_id, meal_name, quantity)')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error };
  const out: OrderedMeal[] = [];
  for (const o of (data ?? []) as any[]) {
    for (const i of o.order_items ?? []) {
      if (!i?.meal_id) continue;
      out.push({ orderItemId: i.id, mealId: i.meal_id, mealName: i.meal_name, quantity: Number(i.quantity) || 1, orderedAt: o.created_at });
    }
  }
  return { data: out, error: null };
}

export async function syncProfileTimeZone(userId: string, timeZone: string): Promise<void> {
  await supabase.from('user_profiles').update({ time_zone: timeZone }).eq('user_id', userId);
}

export async function fetchPreferences(): Promise<Result<NotificationPreferences | null>> {
  const { data, error } = await supabase.from('notification_preferences').select('*').maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  const p = data as any;
  const hhmm = (t: string) => String(t).slice(0, 5);
  return {
    data: {
      ...p,
      daily_time: hhmm(p.daily_time),
      progress_time: hhmm(p.progress_time),
      evening_time: hhmm(p.evening_time),
      quiet_start: hhmm(p.quiet_start),
      quiet_end: hhmm(p.quiet_end),
    } as NotificationPreferences,
    error: null,
  };
}

export async function savePreferences(prefs: NotificationPreferences): Promise<Result<true>> {
  const { error } = await supabase.from('notification_preferences').upsert(prefs, { onConflict: 'user_id' });
  if (error) return { data: null, error };
  return { data: true, error: null };
}
