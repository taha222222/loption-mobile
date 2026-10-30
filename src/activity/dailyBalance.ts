// src/activity/dailyBalance.ts
// Pure helpers for the Daily Tracking screen. Every number comes from the
// server (activity_daily_summary); these functions only shape it and never
// fill gaps: a day without data stays "no data" (null), which is different
// from a measured zero.
import { dateRange } from '../nutrition/dates';
import type { ActivitySource, ProviderAvailability, ProviderPermission } from './types';

export type EnergyMethod = 'platform_total' | 'bmr_plus_active' | 'tdee_baseline';

export interface DailyBalance {
  date: string;
  entryCount: number;
  consumedKcal: number | null; // null = no meal logged
  hasMealLog: boolean;
  bmrKcal: number | null;
  tdeeKcal: number | null;
  activitySource: ActivitySource | null; // null = nothing synced that day
  steps: number | null;
  distanceM: number | null;
  activeKcal: number | null;
  coverage: 'partial' | 'complete' | null;
  syncedAt: string | null;
  budgetKcal: number | null; // null = no personalised budget
  method: EnergyMethod | null;
  remainingKcal: number | null; // negative when over budget
  workoutCount: number;
  workoutSeconds: number;
  workoutKcal: number | null;
  workoutKcalEstimated: boolean;
}

const int = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const METHODS: EnergyMethod[] = ['platform_total', 'bmr_plus_active', 'tdee_baseline'];
const SOURCES: ActivitySource[] = ['apple_health', 'health_connect', 'device_motion'];

// One entry per date in [from, to]; a date the server did not return has no data.
export function toDailyBalances(rows: any[], from: string, to: string): DailyBalance[] {
  const byDate = new Map<string, any>();
  for (const r of rows ?? []) if (r?.local_date) byDate.set(String(r.local_date).slice(0, 10), r);
  return dateRange(from, to).map((date) => {
    const r = byDate.get(date) ?? {};
    const hasMealLog = !!r.has_meal_log;
    const source = SOURCES.includes(r.activity_source) ? (r.activity_source as ActivitySource) : null;
    return {
      date,
      entryCount: hasMealLog ? (int(r.entry_count) ?? 0) : 0,
      consumedKcal: hasMealLog ? int(r.consumed_kcal) : null,
      hasMealLog,
      bmrKcal: int(r.bmr_kcal),
      tdeeKcal: int(r.tdee_kcal),
      activitySource: source,
      steps: source ? int(r.steps) : null,
      distanceM: source ? int(r.distance_m) : null,
      activeKcal: source ? int(r.active_energy_kcal) : null,
      coverage: r.coverage === 'complete' || r.coverage === 'partial' ? r.coverage : null,
      syncedAt: r.synced_at ?? null,
      budgetKcal: int(r.energy_estimate_kcal),
      method: METHODS.includes(r.energy_method) ? r.energy_method : null,
      remainingKcal: int(r.remaining_kcal),
      workoutCount: int(r.workout_count) ?? 0,
      workoutSeconds: int(r.workout_seconds) ?? 0,
      workoutKcal: int(r.workout_kcal),
      workoutKcalEstimated: !!r.workout_kcal_estimated,
    };
  });
}

export const METHOD_LABEL: Record<EnergyMethod, string> = {
  platform_total: 'Dépense totale mesurée',
  bmr_plus_active: 'Métabolisme de base + activité mesurée',
  tdee_baseline: 'Estimation habituelle (TDEE)',
};

// Short form for the card's chip (the full label is shown under the card).
export const METHOD_SHORT: Record<EnergyMethod, string> = {
  platform_total: 'Mesuré',
  bmr_plus_active: 'BMR + activité',
  tdee_baseline: 'Estimation TDEE',
};

export const METHOD_EXPLAINED: Record<EnergyMethod, string> = {
  platform_total: 'Votre plateforme santé a mesuré votre dépense totale de la journée.',
  bmr_plus_active:
    'Votre métabolisme de base (estimé) plus l’énergie active mesurée par votre plateforme santé. Aujourd’hui, il augmente au fil de vos mouvements.',
  tdee_baseline:
    'Sans données d’activité fiables, votre budget est votre dépense habituelle estimée (métabolisme × niveau d’activité déclaré).',
};

// What to say about a day's movement data, from the most to the least specific.
export type MovementState =
  | 'unsupported' // no provider on this device (web)
  | 'needs_build' // Expo Go / old build: no native module
  | 'needs_install' // Health Connect missing or outdated
  | 'not_connected' // the customer has not connected a source
  | 'denied' // permission refused (Health Connect / motion)
  | 'not_synced' // connected, nothing synced for this day yet
  | 'no_data' // synced, the platform has no data for this day
  | 'stale' // today's data is older than STALE_MINUTES
  | 'partial' // today, in progress
  | 'complete'; // a finished day

export const STALE_MINUTES = 120;

export function movementState(
  day: DailyBalance | null,
  ctx: {
    today: string;
    now: Date;
    connected: ActivitySource | null;
    availability: ProviderAvailability | null;
    permission: ProviderPermission | null;
  }
): MovementState {
  // Data already on the server (possibly synced from another device) is
  // always shown, whatever this device's connection.
  if (day?.activitySource) {
    if (day.steps === null && day.distanceM === null && day.activeKcal === null) return 'no_data';
    if (day.date === ctx.today) {
      const age = day.syncedAt ? (ctx.now.getTime() - new Date(day.syncedAt).getTime()) / 60000 : Infinity;
      return age > STALE_MINUTES ? 'stale' : 'partial';
    }
    return day.coverage === 'complete' ? 'complete' : 'partial';
  }
  if (!ctx.connected) {
    if (ctx.availability === 'unsupported' || ctx.availability === null) return 'unsupported';
    if (ctx.availability === 'needs_native_build') return 'needs_build';
    if (ctx.availability === 'needs_install' || ctx.availability === 'needs_update') return 'needs_install';
    return 'not_connected';
  }
  if (ctx.permission === 'denied') return 'denied';
  return 'not_synced';
}

// Share of the budget used by the meals, 0..1 for drawing (over budget = 1).
export function intakeShare(d: DailyBalance): number {
  if (!d.budgetKcal || d.budgetKcal <= 0 || d.consumedKcal === null) return 0;
  return Math.max(0, Math.min(1, d.consumedKcal / d.budgetKcal));
}

// Part of the budget that comes from measured activity (BMR + active only).
export function activityShareOfBudget(d: DailyBalance): number {
  if (d.method !== 'bmr_plus_active' || !d.budgetKcal || !d.activeKcal) return 0;
  return Math.max(0, Math.min(1, d.activeKcal / d.budgetKcal));
}

export function balanceChartMax(days: DailyBalance[]): number {
  let max = 0;
  for (const d of days) max = Math.max(max, d.consumedKcal ?? 0, d.budgetKcal ?? 0);
  return Math.max(500, Math.ceil(max / 500) * 500);
}

export function stepsChartMax(days: DailyBalance[]): number {
  let max = 0;
  for (const d of days) max = Math.max(max, d.steps ?? 0);
  return Math.max(1000, Math.ceil(max / 1000) * 1000);
}

export function describeBalanceDay(d: DailyBalance): string {
  const meals = d.hasMealLog ? `${d.consumedKcal} kcal consommées` : 'aucun repas enregistré';
  const budget = d.budgetKcal !== null ? `, budget ${d.budgetKcal} kcal` : '';
  const steps = d.activitySource ? (d.steps !== null ? `, ${d.steps} pas` : ', pas non mesurés') : ', aucune activité synchronisée';
  return `${meals}${budget}${steps}`;
}

export interface WeekTotals {
  daysWithMeals: number;
  daysWithActivity: number;
  steps: number | null; // sum over days with data; null when none
  workoutCount: number;
  workoutSeconds: number;
}

export function weekTotals(days: DailyBalance[]): WeekTotals {
  const withSteps = days.filter((d) => d.steps !== null);
  return {
    daysWithMeals: days.filter((d) => d.hasMealLog).length,
    daysWithActivity: days.filter((d) => d.activitySource !== null).length,
    steps: withSteps.length ? withSteps.reduce((s, d) => s + (d.steps ?? 0), 0) : null,
    workoutCount: days.reduce((s, d) => s + d.workoutCount, 0),
    workoutSeconds: days.reduce((s, d) => s + d.workoutSeconds, 0),
  };
}
