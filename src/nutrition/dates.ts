// src/nutrition/dates.ts
// Local calendar dates for tracking. A day is the customer's local calendar
// day in their current IANA time zone; dates are 'YYYY-MM-DD' strings so
// they never shift when converted between zones. The server re-checks every
// date against the same time zone.
import { getCalendars } from 'expo-localization';

export function deviceTimeZone(): string {
  try {
    const tz = getCalendars()[0]?.timeZone;
    if (tz) return tz;
  } catch {
    // fall through
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    // fall through
  }
  return 'UTC';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The local calendar date of `at` in `timeZone`.
export function localDate(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const value = `${get('year')}-${get('month')}-${get('day')}`;
    if (DATE_RE.test(value)) return value;
  } catch {
    // Unknown zone: fall back to UTC rather than guessing.
  }
  return at.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Inclusive list of dates from `from` to `to` (empty when from > to).
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
    .replace('.', '');
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Aujourd’hui';
  if (date === addDays(today, -1)) return 'Hier';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`)
  );
}
