// src/nutrition/reminders.ts
// Helpers for the reminder settings screen. The server applies the same
// rules (public.in_quiet_hours, notification_preferences_guard) and is the
// authority; these only give immediate feedback.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(t: string): boolean {
  return TIME_RE.test(t);
}

function toMinutes(t: string): number {
  const m = TIME_RE.exec(t);
  if (!m) throw new Error(`invalid time ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function fromMinutes(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Moves a HH:MM time by `minutes`, wrapping around midnight.
export function shiftTime(t: string, minutes: number): string {
  return fromMinutes(toMinutes(t) + minutes);
}

// Same rule as public.in_quiet_hours: [start, end), may wrap midnight;
// start = end means no quiet hours.
export function inQuietHours(t: string, start: string, end: string): boolean {
  const x = toMinutes(t);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? x >= s && x < e : x >= s || x < e;
}

export interface ReminderTimes {
  daily_time: string;
  progress_time: string;
  evening_time: string;
  quiet_start: string;
  quiet_end: string;
}

// Returns a customer message when a reminder time falls in quiet hours.
export function reminderTimesProblem(p: ReminderTimes): string | null {
  for (const [label, t] of [
    ['objectif du jour', p.daily_time],
    ['progression', p.progress_time],
    ['rappel du soir', p.evening_time],
  ] as const) {
    if (inQuietHours(t, p.quiet_start, p.quiet_end)) {
      return `L’heure du rappel « ${label} » (${t}) est dans vos heures de silence (${p.quiet_start}–${p.quiet_end}).`;
    }
  }
  return null;
}
