// src/activity/providers/healthConnect.ts
// Android Health Connect, read-only. Needs a development or store build
// (config plugin in app.json, minSdk 26); Health Connect itself must be
// installed (built into Android 14+). Aggregates with no data origin mean
// "no data" and are reported as null, not 0.
import { Platform } from 'react-native';
import type { ActivityProvider, DailyReading, ImportedWorkout, ProviderPermission, WorkoutKind } from '../types';

export const HEALTH_CONNECT_READ = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'TotalCaloriesBurned' },
  { accessType: 'read', recordType: 'ExerciseSession' },
] as const;

// Health Connect ExerciseType values for the four workout kinds.
const KIND_BY_EXERCISE_TYPE: Record<number, WorkoutKind> = {
  79: 'walk', // WALKING
  56: 'run', // RUNNING
  57: 'run', // RUNNING_TREADMILL
  8: 'cycle', // BIKING
  9: 'cycle', // BIKING_STATIONARY
  70: 'gym', // STRENGTH_TRAINING
  81: 'gym', // WEIGHTLIFTING
};

type HealthConnectModule = any;
let cached: HealthConnectModule | null | undefined;
let initialized = false;

function load(): HealthConnectModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') return (cached = null);
  try {
    // Lazy: the native module is absent in Expo Go and on other platforms.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-health-connect');
  } catch {
    cached = null;
  }
  return cached ?? null;
}

// For tests only.
export function __resetHealthConnectModule() {
  cached = undefined;
  initialized = false;
}

async function ready(hc: HealthConnectModule): Promise<boolean> {
  if (!initialized) initialized = !!(await hc.initialize());
  return initialized;
}

const hasOrigin = (r: any) => Array.isArray(r?.dataOrigins) && r.dataOrigins.length > 0;

export const healthConnectProvider: ActivityProvider = {
  id: 'health_connect',

  async availability() {
    if (Platform.OS !== 'android') return 'unsupported';
    const hc = load();
    if (!hc) return 'needs_native_build';
    try {
      const status = await hc.getSdkStatus(); // 1 unavailable, 2 update required, 3 available
      if (status === 3) return 'available';
      if (status === 2) return 'needs_update';
      return 'needs_install';
    } catch {
      return 'needs_native_build';
    }
  },

  async permission(): Promise<ProviderPermission> {
    const hc = load();
    if (!hc) return 'not_requested';
    try {
      if (!(await ready(hc))) return 'not_requested';
      const granted: any[] = await hc.getGrantedPermissions();
      return grantState(granted);
    } catch {
      return 'not_requested';
    }
  },

  async requestPermission(): Promise<ProviderPermission> {
    const hc = load();
    if (!hc) return 'not_requested';
    if (!(await ready(hc))) return 'not_requested';
    const granted: any[] = await hc.requestPermission(HEALTH_CONNECT_READ as any);
    const state = grantState(granted);
    return state === 'not_requested' ? 'denied' : state;
  },

  async readDays(days) {
    const hc = load();
    if (!hc || !(await ready(hc))) throw new Error('Health Connect unavailable');
    const now = Date.now();
    const out: DailyReading[] = [];
    for (const w of days) {
      const timeRangeFilter = { operator: 'between', startTime: w.start.toISOString(), endTime: w.end.toISOString() };
      const [steps, distance, active, total] = await Promise.all([
        hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter }).catch(() => null),
        hc.aggregateRecord({ recordType: 'Distance', timeRangeFilter }).catch(() => null),
        hc.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter }).catch(() => null),
        hc.aggregateRecord({ recordType: 'TotalCaloriesBurned', timeRangeFilter }).catch(() => null),
      ]);
      const finished = w.end.getTime() <= now;
      out.push({
        date: w.date,
        steps: hasOrigin(steps) ? Math.round(Number(steps.COUNT_TOTAL) || 0) : null,
        distanceM: hasOrigin(distance) ? Math.round(Number(distance.DISTANCE?.inMeters) || 0) : null,
        activeKcal: hasOrigin(active) ? Math.round(Number(active.ACTIVE_CALORIES_TOTAL?.inKilocalories) || 0) : null,
        totalKcal: finished && hasOrigin(total) ? Math.round(Number(total.ENERGY_TOTAL?.inKilocalories) || 0) : null,
      });
    }
    return out;
  },

  async readWorkouts(start, end) {
    const hc = load();
    if (!hc || !(await ready(hc))) throw new Error('Health Connect unavailable');
    const res = await hc.readRecords('ExerciseSession', {
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
    });
    const out: ImportedWorkout[] = [];
    for (const r of res?.records ?? []) {
      const kind = KIND_BY_EXERCISE_TYPE[Number(r?.exerciseType)];
      const id = r?.metadata?.id;
      if (!kind || !id) continue;
      const startedAt = new Date(r.startTime);
      const endedAt = new Date(r.endTime);
      const filter = { operator: 'between', startTime: r.startTime, endTime: r.endTime };
      // Per-session totals restricted to the app that recorded the session.
      const origin = r?.metadata?.dataOrigin ? [r.metadata.dataOrigin] : undefined;
      const [distance, energy] = await Promise.all([
        hc.aggregateRecord({ recordType: 'Distance', timeRangeFilter: filter, dataOriginFilter: origin }).catch(() => null),
        hc.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter: filter, dataOriginFilter: origin }).catch(() => null),
      ]);
      out.push({
        externalId: String(id),
        kind,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        activeSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
        distanceM: kind !== 'gym' && hasOrigin(distance) ? Math.round(Number(distance.DISTANCE?.inMeters) || 0) : null,
        energyKcal: hasOrigin(energy) ? Math.round(Number(energy.ACTIVE_CALORIES_TOTAL?.inKilocalories) || 0) : null,
      });
    }
    return out;
  },

  openSettings() {
    const hc = load();
    try {
      hc?.openHealthConnectSettings();
    } catch {
      // nothing to open
    }
  },
};

function grantState(granted: any[]): ProviderPermission {
  const types = new Set((granted ?? []).filter((p) => p?.accessType === 'read').map((p) => p.recordType));
  const wanted = HEALTH_CONNECT_READ.map((p) => p.recordType);
  const n = wanted.filter((t) => types.has(t)).length;
  if (n === wanted.length) return 'granted';
  if (n > 0) return 'partial';
  return 'not_requested';
}
