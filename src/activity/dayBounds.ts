// src/activity/dayBounds.ts
// Start and end instants of a local calendar day in an IANA time zone,
// correct across DST changes (a day can last 23 or 25 hours). Health
// platforms are queried with these bounds so a day means the same thing on
// the phone and on the server.
import { addDays } from '../nutrition/dates';

// Offset (ms) of `timeZone` at instant `at`: local wall time minus UTC.
export function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The instant at which `date` begins (00:00 local) in `timeZone`.
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - zoneOffsetMs(timeZone, new Date(wall));
  // A second pass settles days where the offset changes near midnight.
  t = wall - zoneOffsetMs(timeZone, new Date(t));
  return new Date(t);
}

export function dayWindow(date: string, timeZone: string) {
  return { date, start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDays(date, 1), timeZone) };
}

// The `count` local days ending with `today`, oldest first.
export function recentDayWindows(today: string, timeZone: string, count: number) {
  return Array.from({ length: count }, (_, i) => dayWindow(addDays(today, i - (count - 1)), timeZone));
}
