// src/activity/stepCounter.ts
// Turns readings of Android's hardware step counter into daily totals.
// The counter counts steps since the last boot; Android keeps no history,
// so the app (and a background job every ~15 minutes) stores readings on
// the device. A day's steps are the increases between consecutive readings
// that fall in that day. Nothing is invented:
//   * reboot: the counter restarted at 0; the steps between the last reading
//     and the reboot are unknown and are NOT counted; the steps since the
//     boot are counted from the boot time.
//   * counter reset (value lower without a reboot): counted from the
//     previous reading as the new value (at most what the counter shows).
//   * an interval that crosses midnight is split by time only when it is
//     short (at most MAX_SPLIT_MS); a longer one is left out (a gap).
//   * an impossible rate (more than MAX_STEPS_PER_SECOND) is left out.
// A day with at least one interval has a measured count (possibly 0); a day
// without any is "no data" (absent from the result).
import { addDays, localDate } from '../nutrition/dates';
import { startOfLocalDay } from './dayBounds';

export interface CounterSnapshot {
  value: number; // cumulative steps since boot
  wallTimeMs: number;
  bootCount: number; // -1 when unknown
  elapsedMs: number; // ms since boot at the reading
  origin?: string;
}

export interface CounterDay {
  date: string;
  steps: number;
  measuredFrom: string; // ISO, first instant covered that day
  measuredTo: string; // ISO, last instant covered that day
  gaps: number; // intervals left out or partly unknown that touched the day
}

export const MAX_SPLIT_MS = 3 * 3600 * 1000;
export const MAX_STEPS_PER_SECOND = 5;
const BOOT_TOLERANCE_MS = 120_000;

export function sameBoot(a: CounterSnapshot, b: CounterSnapshot): boolean {
  if (a.bootCount >= 0 && b.bootCount >= 0) return a.bootCount === b.bootCount;
  // Without a boot counter: the estimated boot instant must match.
  return Math.abs(a.wallTimeMs - a.elapsedMs - (b.wallTimeMs - b.elapsedMs)) < BOOT_TOLERANCE_MS;
}

interface Interval {
  start: number;
  end: number;
  steps: number;
  partial: boolean; // part of the real interval is unknown
}

export function intervals(snapshots: CounterSnapshot[]): { list: Interval[]; dropped: Interval[] } {
  const sorted = [...snapshots]
    .filter((s) => Number.isFinite(s.value) && s.value >= 0 && Number.isFinite(s.wallTimeMs))
    .sort((x, y) => x.wallTimeMs - y.wallTimeMs);
  const list: Interval[] = [];
  const dropped: Interval[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (b.wallTimeMs <= a.wallTimeMs) continue;
    let iv: Interval;
    if (sameBoot(a, b) && b.value >= a.value) {
      iv = { start: a.wallTimeMs, end: b.wallTimeMs, steps: b.value - a.value, partial: false };
    } else if (!sameBoot(a, b)) {
      // Rebooted between a and b: count only what the new boot measured.
      const bootAt = Math.max(a.wallTimeMs, b.wallTimeMs - Math.max(0, b.elapsedMs));
      iv = { start: bootAt, end: b.wallTimeMs, steps: b.value, partial: true };
    } else {
      // Same boot but the value went down: the sensor was reset.
      iv = { start: a.wallTimeMs, end: b.wallTimeMs, steps: b.value, partial: true };
    }
    const seconds = Math.max(1, (iv.end - iv.start) / 1000);
    if (iv.end <= iv.start || iv.steps / seconds > MAX_STEPS_PER_SECOND) {
      dropped.push(iv);
      continue;
    }
    list.push(iv);
  }
  return { list, dropped };
}

export function dailySteps(snapshots: CounterSnapshot[], timeZone: string): CounterDay[] {
  const { list, dropped } = intervals(snapshots);
  const days = new Map<string, { steps: number; from: number; to: number; gaps: number }>();
  const touch = (date: string, from: number, to: number, steps: number, gap: boolean) => {
    const d = days.get(date) ?? { steps: 0, from, to, gaps: 0 };
    d.steps += steps;
    d.from = Math.min(d.from, from);
    d.to = Math.max(d.to, to);
    if (gap) d.gaps += 1;
    days.set(date, d);
  };
  const markGap = (date: string) => {
    const d = days.get(date);
    if (d) d.gaps += 1;
  };

  for (const iv of list) {
    const first = localDate(timeZone, new Date(iv.start));
    const last = localDate(timeZone, new Date(iv.end - 1));
    if (first === last) {
      touch(first, iv.start, iv.end, iv.steps, iv.partial);
      continue;
    }
    if (iv.end - iv.start > MAX_SPLIT_MS) {
      // Too long to tell which day the steps belong to.
      dropped.push(iv);
      continue;
    }
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const dayStart = startOfLocalDay(date, timeZone).getTime();
      const dayEnd = startOfLocalDay(addDays(date, 1), timeZone).getTime();
      const from = Math.max(iv.start, dayStart);
      const to = Math.min(iv.end, dayEnd);
      if (to <= from) continue;
      touch(date, from, to, (iv.steps * (to - from)) / (iv.end - iv.start), iv.partial);
    }
  }
  for (const iv of dropped) {
    markGap(localDate(timeZone, new Date(iv.start)));
    markGap(localDate(timeZone, new Date(iv.end - 1)));
  }
  return [...days.entries()]
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([date, d]) => ({
      date,
      steps: Math.round(d.steps),
      measuredFrom: new Date(d.from).toISOString(),
      measuredTo: new Date(d.to).toISOString(),
      gaps: d.gaps,
    }));
}

// Steps counted between two counter readings of a workout segment; null
// when they are not comparable (reboot or reset in between).
export function segmentSteps(start: CounterSnapshot | null, end: CounterSnapshot | null): number | null {
  if (!start || !end || end.wallTimeMs < start.wallTimeMs) return null;
  if (!sameBoot(start, end) || end.value < start.value) return null;
  return Math.round(end.value - start.value);
}
