// src/activity/gps.ts
// GPS distance for a workout started by the customer. Points are kept only
// in memory while the session runs; only the resulting distance is saved
// (the route itself is never uploaded). Inaccurate fixes, jitter while
// standing still and impossible jumps are ignored, and a gap (app in the
// background, signal lost) is never bridged with a straight line.
import type { WorkoutKind } from './types';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null; // metres
  timestamp: number; // ms
}

export const MAX_ACCURACY_M = 30;
export const MAX_GAP_MS = 30_000;
// Fastest plausible instantaneous speed per kind (m/s); the server applies
// its own limit to the session average.
const MAX_SPEED: Record<WorkoutKind, number> = { walk: 4, run: 8, cycle: 25, gym: 0 };

export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PointDecision =
  | { use: true; meters: number } // add `meters` and make the point the new anchor
  | { use: false; anchor: boolean; gap: boolean; reason: 'inaccurate' | 'first' | 'gap' | 'jitter' | 'too_fast' };

// Decide what a new fix contributes, given the last accepted anchor.
export function evaluatePoint(prev: GeoPoint | null, next: GeoPoint, kind: WorkoutKind): PointDecision {
  if (next.accuracy === null || next.accuracy > MAX_ACCURACY_M) return { use: false, anchor: false, gap: false, reason: 'inaccurate' };
  if (!prev) return { use: false, anchor: true, gap: false, reason: 'first' };
  const dt = next.timestamp - prev.timestamp;
  if (dt <= 0) return { use: false, anchor: false, gap: false, reason: 'jitter' };
  if (dt > MAX_GAP_MS) return { use: false, anchor: true, gap: true, reason: 'gap' };
  const meters = haversineM(prev, next);
  const noise = Math.max(3, ((prev.accuracy ?? 0) + (next.accuracy ?? 0)) / 2);
  if (meters < noise) return { use: false, anchor: false, gap: false, reason: 'jitter' };
  if (meters / (dt / 1000) > MAX_SPEED[kind]) return { use: false, anchor: false, gap: false, reason: 'too_fast' };
  return { use: true, meters };
}

// Pace in seconds per km (walk, run), only when the distance is meaningful.
export function paceSecondsPerKm(distanceM: number | null, seconds: number): number | null {
  if (!distanceM || distanceM < 100 || seconds < 60) return null;
  return Math.round(seconds / (distanceM / 1000));
}

// Average speed in km/h (cycling), same validity rule.
export function speedKmh(distanceM: number | null, seconds: number): number | null {
  if (!distanceM || distanceM < 100 || seconds < 60) return null;
  return Math.round((distanceM / 1000 / (seconds / 3600)) * 10) / 10;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatPace(secondsPerKm: number | null): string | null {
  if (secondsPerKm === null) return null;
  return `${Math.floor(secondsPerKm / 60)}'${String(secondsPerKm % 60).padStart(2, '0')}" /km`;
}

export function formatDistance(meters: number | null): string | null {
  if (meters === null) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1).replace('.', ',')} km`;
}
