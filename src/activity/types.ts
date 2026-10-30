// src/activity/types.ts
// Shared types for daily activity and workouts. Values are what a health
// platform measured (or the server estimated); null always means "no data",
// never zero.

export type ActivitySource = 'apple_health' | 'health_connect' | 'device_motion';
export type WorkoutSource = 'app' | 'apple_health' | 'health_connect';
export type WorkoutKind = 'walk' | 'run' | 'cycle' | 'gym';

export type ProviderAvailability =
  | 'available'
  | 'unsupported' // platform has no such provider (web, Android for HealthKit, ...)
  | 'needs_native_build' // native module missing: Expo Go or an old build
  | 'needs_install' // Health Connect not installed
  | 'needs_update'; // Health Connect must be updated

// HealthKit never reveals whether READ access was granted: after the
// request the state is 'requested' and only the presence of data tells.
export type ProviderPermission = 'granted' | 'partial' | 'denied' | 'requested' | 'not_requested';

export interface DayWindow {
  date: string; // local calendar date, YYYY-MM-DD
  start: Date;
  end: Date; // exclusive
}

export interface DailyReading {
  date: string;
  steps: number | null;
  distanceM: number | null;
  activeKcal: number | null;
  totalKcal: number | null; // only for a finished day; the server drops it otherwise
}

export interface ImportedWorkout {
  externalId: string;
  kind: WorkoutKind;
  startedAt: string; // ISO
  endedAt: string; // ISO
  activeSeconds: number;
  distanceM: number | null;
  energyKcal: number | null; // as measured by the provider
}

export interface ActivityProvider {
  id: ActivitySource;
  availability(): Promise<ProviderAvailability>;
  permission(): Promise<ProviderPermission>;
  requestPermission(): Promise<ProviderPermission>;
  readDays(days: DayWindow[]): Promise<DailyReading[]>;
  readWorkouts?(start: Date, end: Date): Promise<ImportedWorkout[]>;
  openSettings?(): void;
}

export const WORKOUT_SOURCE_FOR: Record<ActivitySource, WorkoutSource | null> = {
  apple_health: 'apple_health',
  health_connect: 'health_connect',
  device_motion: null,
};
