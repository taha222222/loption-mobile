// src/activity/dailyBalance.ts
// Pure helpers for the Daily Tracking screen. Every number comes from the
// server (activity_daily_summary); these functions only shape it and never
// fill gaps: a day without data stays "no data" (null), which is different
// from a measured zero.
import { dateRange } from '../nutrition/dates';
import type { ActivitySource, ProviderAvailability, ProviderPermission } from './types';

export type EnergyMethod = 'platform_total' | 'bmr_plus_active' | 'bmr_plus_movement' | 'tdee_baseline';
export type EnergyConfidence = 'measured' | 'estimated' | 'baseline';

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
  // Standalone-tracking fields (null on a server without that migration).
  baseKcal: number | null; // rest + digestion part of the budget
  stepKcal: number | null; // walking outside recorded walks/runs
  countedWorkoutKcal: number; // workout energy inside the budget
  activityKcal: number | null; // movement energy shown as "calories actives"
  activeMinutes: number; // recorded workout minutes
  walkDistanceM: number | null;
  walkDistanceEstimated: boolean;
  measuredFrom: string | null;
  measuredTo: string | null;
  confidence: EnergyConfidence | null;
}

const int = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const METHODS: EnergyMethod[] = ['platform_total', 'bmr_plus_active', 'bmr_plus_movement', 'tdee_baseline'];
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
      baseKcal: int(r.base_kcal),
      stepKcal: int(r.step_kcal),
      countedWorkoutKcal: int(r.counted_workout_kcal) ?? 0,
      activityKcal: r.activity_kcal === undefined ? (source && source !== 'device_motion' ? int(r.active_energy_kcal) : null) : int(r.activity_kcal),
      activeMinutes: int(r.active_minutes) ?? Math.floor((int(r.workout_seconds) ?? 0) / 60),
      walkDistanceM: r.walk_distance_m === undefined ? (source ? int(r.distance_m) : null) : int(r.walk_distance_m),
      walkDistanceEstimated: !!r.walk_distance_estimated,
      measuredFrom: r.measured_from ?? null,
      measuredTo: r.measured_to ?? null,
      confidence: r.confidence === 'measured' || r.confidence === 'estimated' || r.confidence === 'baseline' ? r.confidence : null,
    };
  });
}

// Plain language first; the technical terms stay in the optional details.
export const METHOD_LABEL: Record<EnergyMethod, string> = {
  platform_total: 'Mesuré par votre application santé',
  bmr_plus_active: 'Repos + activité mesurée',
  bmr_plus_movement: 'Repos + vos pas et séances',
  tdee_baseline: 'Estimation selon votre profil',
};

// Short form for the card's chip (the full label is shown under the card).
export const METHOD_SHORT: Record<EnergyMethod, string> = {
  platform_total: 'Mesuré',
  bmr_plus_active: 'Repos + activité',
  bmr_plus_movement: 'Repos + mouvement',
  tdee_baseline: 'Profil',
};

export const METHOD_EXPLAINED: Record<EnergyMethod, string> = {
  platform_total: 'Votre plateforme santé a mesuré votre dépense totale de la journée.',
  bmr_plus_active:
    'Votre métabolisme de base (estimé) plus l’énergie active mesurée par votre plateforme santé. Aujourd’hui, il augmente au fil de vos mouvements.',
  bmr_plus_movement:
    'L’énergie que votre corps utilise au repos et pour digérer (métabolisme de base × 1,1), plus l’énergie de vos pas mesurés par le téléphone et de vos séances. Les pas d’une marche ou d’une course enregistrée ne sont comptés qu’une fois. Aujourd’hui, il augmente au fil de vos mouvements.',
  tdee_baseline:
    'Sans données d’activité fiables, votre budget est votre dépense habituelle estimée (métabolisme × niveau d’activité déclaré).',
};

// Optional technical details (behind the info button), one line each.
export function budgetDetails(d: DailyBalance): string[] {
  const out: string[] = [];
  if (d.method === 'bmr_plus_movement') {
    if (d.baseKcal !== null) out.push(`Repos et digestion : ${d.baseKcal} kcal (métabolisme de base ${d.bmrKcal ?? '—'} kcal × 1,1)`);
    if (d.stepKcal !== null) out.push(`Pas : ${d.stepKcal} kcal (0,5 kcal par kg et par km de marche)`);
    if (d.countedWorkoutKcal > 0) out.push(`Séances : ${d.countedWorkoutKcal} kcal (estimation selon l’effort, le poids et la durée)`);
    if (d.walkDistanceEstimated) out.push('Distance estimée à partir de vos pas et de votre taille.');
  } else if (d.method === 'bmr_plus_active') {
    if (d.bmrKcal !== null) out.push(`Métabolisme de base : ${d.bmrKcal} kcal`);
    if (d.activeKcal !== null) out.push(`Énergie active mesurée : ${d.activeKcal} kcal (vos séances en font déjà partie)`);
  } else if (d.method === 'tdee_baseline' && d.tdeeKcal !== null) {
    out.push(`Dépense habituelle estimée (TDEE) : ${d.tdeeKcal} kcal`);
  }
  out.push('Ce sont des estimations, pas un avis médical.');
  return out;
}

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
  if (!d.budgetKcal) return 0;
  const active = d.method === 'bmr_plus_active' ? d.activeKcal : d.method === 'bmr_plus_movement' ? d.activityKcal : null;
  if (!active) return 0;
  return Math.max(0, Math.min(1, active / d.budgetKcal));
}

export function minutesChartMax(days: DailyBalance[]): number {
  let max = 0;
  for (const d of days) max = Math.max(max, d.activeMinutes);
  return Math.max(30, Math.ceil(max / 30) * 30);
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
