// src/activity/providers/healthKit.ts
// Apple Health (HealthKit), read-only. Needs a development or store build
// with the HealthKit entitlement (config plugin in app.json); Expo Go has no
// HealthKit module, so the native module is loaded lazily and its absence is
// reported as 'needs_native_build'.
//
// HealthKit does not tell an app whether READ access was granted (privacy):
// after the request the state is 'requested', and a denied type simply
// returns no samples. The UI says so instead of claiming access.
import { Platform } from 'react-native';
import type { ActivityProvider, DailyReading, DayWindow, ImportedWorkout, ProviderPermission, WorkoutKind } from '../types';

const STEPS = 'HKQuantityTypeIdentifierStepCount';
const DISTANCE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';
const ACTIVE = 'HKQuantityTypeIdentifierActiveEnergyBurned';
const BASAL = 'HKQuantityTypeIdentifierBasalEnergyBurned';
const WORKOUT = 'HKWorkoutTypeIdentifier';
// Minimum read set: steps, walking/running distance, active and basal
// energy (basal + active = total energy for a finished day), workouts.
export const HEALTHKIT_READ_TYPES = [STEPS, DISTANCE, ACTIVE, BASAL, WORKOUT] as const;

// HKWorkoutActivityType values for the four L'OPTION workout kinds.
const KIND_BY_ACTIVITY_TYPE: Record<number, WorkoutKind> = {
  52: 'walk', // walking
  37: 'run', // running
  13: 'cycle', // cycling
  50: 'gym', // traditionalStrengthTraining
  20: 'gym', // functionalStrengthTraining
};

type HealthKitModule = any;
let cached: HealthKitModule | null | undefined;

function load(): HealthKitModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') return (cached = null);
  try {
    // Lazy: the native module is absent in Expo Go and on other platforms.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@kingstinct/react-native-healthkit');
  } catch {
    cached = null;
  }
  return cached ?? null;
}

// For tests only.
export function __resetHealthKitModule() {
  cached = undefined;
}

const sum = (res: any): number | null => {
  const q = res?.sumQuantity?.quantity;
  return typeof q === 'number' && Number.isFinite(q) ? q : null;
};

async function statistic(hk: HealthKitModule, identifier: string, unit: string, w: DayWindow): Promise<number | null> {
  const res = await hk.queryStatisticsForQuantity(identifier, ['cumulativeSum'], {
    unit,
    filter: { date: { startDate: w.start, endDate: w.end } },
  });
  return sum(res);
}

export const healthKitProvider: ActivityProvider = {
  id: 'apple_health',

  async availability() {
    if (Platform.OS !== 'ios') return 'unsupported';
    const hk = load();
    if (!hk) return 'needs_native_build';
    try {
      return (await hk.isHealthDataAvailableAsync()) ? 'available' : 'unsupported';
    } catch {
      return 'needs_native_build';
    }
  },

  async permission(): Promise<ProviderPermission> {
    const hk = load();
    if (!hk) return 'not_requested';
    try {
      // 1 = shouldRequest, 2 = unnecessary (already asked)
      const status = await hk.getRequestStatusForAuthorization({ toRead: HEALTHKIT_READ_TYPES });
      return status === 2 ? 'requested' : 'not_requested';
    } catch {
      return 'not_requested';
    }
  },

  async requestPermission(): Promise<ProviderPermission> {
    const hk = load();
    if (!hk) return 'not_requested';
    await hk.requestAuthorization({ toRead: HEALTHKIT_READ_TYPES });
    return 'requested';
  },

  async readDays(days) {
    const hk = load();
    if (!hk) throw new Error('HealthKit unavailable');
    const now = Date.now();
    const out: DailyReading[] = [];
    for (const w of days) {
      const [steps, distance, active, basal] = await Promise.all([
        statistic(hk, STEPS, 'count', w),
        statistic(hk, DISTANCE, 'm', w),
        statistic(hk, ACTIVE, 'kcal', w),
        statistic(hk, BASAL, 'kcal', w),
      ]);
      const finished = w.end.getTime() <= now;
      out.push({
        date: w.date,
        steps: steps === null ? null : Math.round(steps),
        distanceM: distance === null ? null : Math.round(distance),
        activeKcal: active === null ? null : Math.round(active),
        // Total energy only when HealthKit recorded both parts for a whole day.
        totalKcal: finished && basal !== null && active !== null ? Math.round(basal + active) : null,
      });
    }
    return out;
  },

  async readWorkouts(start, end) {
    const hk = load();
    if (!hk) throw new Error('HealthKit unavailable');
    const workouts = await hk.queryWorkoutSamples({
      limit: 0,
      ascending: true,
      filter: { date: { startDate: start, endDate: end } },
    });
    const out: ImportedWorkout[] = [];
    for (const proxy of workouts ?? []) {
      const w = typeof proxy?.toJSON === 'function' ? proxy.toJSON() : proxy;
      if (typeof proxy?.dispose === 'function') proxy.dispose();
      const kind = KIND_BY_ACTIVITY_TYPE[Number(w?.workoutActivityType)];
      if (!kind || !w?.uuid) continue;
      const startedAt = new Date(w.startDate);
      const endedAt = new Date(w.endDate);
      const seconds = Number(w?.duration?.quantity);
      out.push({
        externalId: String(w.uuid),
        kind,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        activeSeconds: Math.round(Number.isFinite(seconds) && seconds > 0 ? seconds : (endedAt.getTime() - startedAt.getTime()) / 1000),
        distanceM: quantityIn(w?.totalDistance, 'm'),
        energyKcal: quantityIn(w?.totalEnergyBurned, 'kcal'),
      });
    }
    return out;
  },
};

// Workout totals come in the user's preferred unit; convert the common ones.
function quantityIn(q: any, target: 'm' | 'kcal'): number | null {
  const value = Number(q?.quantity);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = String(q?.unit ?? target);
  const factor: Record<string, number> =
    target === 'm' ? { m: 1, km: 1000, mi: 1609.344, ft: 0.3048, yd: 0.9144 } : { kcal: 1, Cal: 1, cal: 0.001, kJ: 0.239006 };
  const f = factor[unit];
  return f === undefined ? null : Math.round(value * f);
}
