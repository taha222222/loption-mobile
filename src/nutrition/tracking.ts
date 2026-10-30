// src/nutrition/tracking.ts
// Pure helpers for the tracking screens. Every number shown comes from the
// server (daily summary, streak); these functions only shape it and never
// fill gaps: a day without entries stays "no log" (consumed = null), which
// is different from a logged day.
import { dateRange } from './dates';

export interface DaySummary {
  date: string;
  entryCount: number;
  consumedKcal: number | null; // null = nothing logged that day
  hasLog: boolean;
  targetKcal: number | null; // null = no target known for that day
  targetSource: 'snapshot' | 'current' | null;
}

export interface StreakInfo {
  current: number;
  longest: number;
  lastLoggedDate: string | null;
  todayLogged: boolean;
  nextMilestone: number;
}

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

// Normalises nutrition_daily_summary rows and guarantees one entry per date
// in [from, to]; a date the server did not return is treated as "no log".
export function toDaySummaries(rows: any[], from: string, to: string): DaySummary[] {
  const byDate = new Map<string, any>();
  for (const r of rows ?? []) if (r?.local_date) byDate.set(String(r.local_date).slice(0, 10), r);
  return dateRange(from, to).map((date) => {
    const r = byDate.get(date);
    const hasLog = !!r?.has_log;
    const source = r?.target_source === 'snapshot' || r?.target_source === 'current' ? r.target_source : null;
    return {
      date,
      entryCount: hasLog ? (toInt(r.entry_count) ?? 0) : 0,
      consumedKcal: hasLog ? toInt(r.consumed_kcal) : null,
      hasLog,
      targetKcal: toInt(r?.target_kcal),
      targetSource: source,
    };
  });
}

export function toStreak(row: any): StreakInfo {
  return {
    current: toInt(row?.current_streak) ?? 0,
    longest: toInt(row?.longest_streak) ?? 0,
    lastLoggedDate: row?.last_logged_date ? String(row.last_logged_date).slice(0, 10) : null,
    todayLogged: !!row?.today_logged,
    nextMilestone: toInt(row?.next_milestone) ?? 7,
  };
}

// Remaining calories; negative when the target is exceeded; null when
// either value is unknown (never invented).
export function remainingKcal(target: number | null, consumed: number | null): number | null {
  if (target === null) return null;
  return target - (consumed ?? 0);
}

// Share of the target consumed, 0..1 (capped for drawing).
export function progressShare(target: number | null, consumed: number | null): number {
  if (!target || target <= 0 || consumed === null) return 0;
  return Math.max(0, Math.min(1, consumed / target));
}

// Upper bound of the chart scale: the largest consumed or target value,
// rounded up to the next 500 kcal (at least 500).
export function chartMax(days: DaySummary[]): number {
  let max = 0;
  for (const d of days) max = Math.max(max, d.consumedKcal ?? 0, d.targetKcal ?? 0);
  return Math.max(500, Math.ceil(max / 500) * 500);
}

export function describeDay(d: DaySummary): string {
  if (!d.hasLog) return 'aucun repas enregistré';
  const target = d.targetKcal !== null ? `, objectif ${d.targetKcal} kcal` : '';
  return `${d.consumedKcal} kcal consommées${target}`;
}

// Days still needed to reach the next milestone.
export function daysToMilestone(s: StreakInfo): number {
  return Math.max(0, s.nextMilestone - s.current);
}

// Maps a database error from logging/removing an entry to a customer message.
export function trackingErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const msg = String(error?.message ?? '');
  if (/no reliable calorie value/i.test(msg)) return 'Ce repas n’a pas de valeur calorique fiable : il ne peut pas être enregistré.';
  if (/previous 6 days/i.test(msg)) return 'Vous pouvez enregistrer un repas pour aujourd’hui et les 6 jours précédents.';
  if (/more servings logged than were ordered/i.test(msg)) return 'Toutes les portions de cette commande sont déjà enregistrées.';
  if (/order item not found/i.test(msg)) return 'Cette commande n’est pas liée à votre compte.';
  if (/not been delivered/i.test(msg)) return 'Cette commande n’a pas encore été livrée.';
  if (/unknown time zone/i.test(msg)) return 'Le fuseau horaire de l’appareil n’est pas reconnu.';
  if (/already removed/i.test(msg)) return 'Ce repas a déjà été retiré.';
  if (error?.code === '23514') return 'Quantité non valide (par quarts de portion, jusqu’à 10).';
  return 'Enregistrement impossible. Vérifiez votre connexion et réessayez.';
}

// "1 portion", "1,5 portions", "0,25 portion".
export function formatServings(servings: number): string {
  const n = Number(servings);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace('.', ',');
  return `${text} portion${n > 1 ? 's' : ''}`;
}
