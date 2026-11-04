// src/activity/metPreview.ts
// Live calorie preview for the workout screen. The saved value is always
// the server's (workout_session_prepare): this file only mirrors the
// server's tables so the running screen can show the same estimate before
// the upload. No constant is defined here that the server does not use;
// __tests__/gpsLiveMap.test.ts compares these tables with the migrations.
// The MET values are pending owner review (DECISIONS #16, #19).
import type { WorkoutKind } from './types';
import type { GymIntensity } from './workoutSession';

// public.activity_met(kind, speed_mps): [upper speed bound (exclusive), MET].
export const MET_TIERS: Record<Exclude<WorkoutKind, 'gym'>, { unknown: number; tiers: [number, number][]; top: number }> = {
  walk: { unknown: 3.5, tiers: [[0.9, 2.0], [1.12, 2.8], [1.56, 3.5], [1.79, 4.3]], top: 5.0 },
  run: { unknown: 7.0, tiers: [[1.95, 6.0], [2.42, 8.3], [2.92, 9.8], [3.36, 11.0], [3.81, 11.8], [4.25, 12.8]], top: 14.5 },
  cycle: { unknown: 7.5, tiers: [[4.47, 4.0], [5.36, 6.8], [6.26, 8.0], [7.15, 10.0]], top: 12.0 },
};
export const GYM_MET_DEFAULT = 3.5; // activity_met('gym', …)
// public.activity_gym_met(intensity)
export const GYM_MET: Record<GymIntensity, number> = { light: 3.5, moderate: 5.0, vigorous: 6.0 };

export function metFor(kind: WorkoutKind, speedMps: number | null, intensity?: GymIntensity | null): number {
  if (kind === 'gym') return intensity ? GYM_MET[intensity] : GYM_MET_DEFAULT;
  const t = MET_TIERS[kind];
  if (speedMps === null) return t.unknown;
  for (const [below, met] of t.tiers) if (speedMps < below) return met;
  return t.top;
}

// Same rule as the server: speed only from a distance of at least 100 m;
// net energy above rest = (MET - 1) x weight x active hours. No weight (or an
// implausible one) means no estimate, never a guess.
export function previewKcal(input: {
  kind: WorkoutKind;
  activeSeconds: number;
  distanceM: number | null;
  weightKg: number | null | undefined;
  intensity?: GymIntensity | null;
}): number | null {
  const { kind, activeSeconds, distanceM, weightKg } = input;
  if (!weightKg || weightKg < 25 || weightKg > 350 || !(activeSeconds > 0)) return null;
  const speed = distanceM !== null && distanceM >= 100 ? distanceM / activeSeconds : null;
  const met = metFor(kind, speed, input.intensity);
  return Math.round(((met - 1) * weightKg * activeSeconds) / 3600);
}
