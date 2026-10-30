// src/stores/trackingStore.ts
// Daily Tracking tab: the daily balance for the chosen range, the selected
// day and its timeline (meals eaten + workouts). Always reloaded from the
// server; a sync with the connected health platform runs first when one is
// connected, and pending workout uploads are flushed.
import { create } from 'zustand';
import type { DailyBalance } from '../activity/dailyBalance';
import { addDays, deviceTimeZone, localDate } from '../nutrition/dates';
import { fetchDailyBalance } from '../services/activityApi';
import { isMissingServerFeature } from '../lib/serverFeatures';
import { fetchEntries, LogEntry } from '../services/nutritionApi';
import { fetchWorkouts, WorkoutRecord } from '../services/workoutApi';
import { useActivityStore } from './activityStore';
import { useWorkoutStore } from './workoutStore';

export type TrackingRange = 7 | 30;

interface TrackingState {
  today: string;
  range: TrackingRange;
  selected: string;
  days: DailyBalance[];
  meals: LogEntry[];
  workouts: WorkoutRecord[];
  // 'unavailable': the server does not have the feature yet (migration not applied).
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  dayStatus: 'idle' | 'loading' | 'ready' | 'error';
  refresh: (options?: { sync?: boolean }) => Promise<void>;
  setRange: (range: TrackingRange) => Promise<void>;
  select: (date: string) => Promise<void>;
  reset: () => void;
}

const initial = () => {
  const today = localDate(deviceTimeZone());
  return {
    today,
    range: 7 as TrackingRange,
    selected: today,
    days: [] as DailyBalance[],
    meals: [] as LogEntry[],
    workouts: [] as WorkoutRecord[],
    status: 'idle' as const,
    dayStatus: 'idle' as const,
  };
};

let generation = 0;

export const useTrackingStore = create<TrackingState>((set, get) => ({
  ...initial(),

  refresh: async ({ sync = true } = {}) => {
    const run = ++generation;
    const tz = deviceTimeZone();
    const today = localDate(tz);
    const previousToday = get().today;
    // Keep a past day selected; follow "today" when the date changed.
    const selected = get().selected === previousToday ? today : get().selected;
    set({ today, selected, status: get().status === 'ready' ? 'ready' : 'loading' });
    if (sync) {
      await Promise.allSettled([useActivityStore.getState().sync(), useWorkoutStore.getState().flush()]);
      if (run !== generation) return;
    }
    const from = addDays(today, -(get().range - 1));
    const [days] = await Promise.all([
      fetchDailyBalance(from, today, today).catch((e) => ({ data: null, error: { message: String(e?.message ?? e) } })),
      loadDay(selected, run),
    ]);
    if (run !== generation) return;
    if (days.error) {
      set({ status: isMissingServerFeature(days.error) ? 'unavailable' : 'error' });
      return;
    }
    set({ days: days.data, status: 'ready' });
  },

  setRange: async (range) => {
    set({ range });
    await get().refresh({ sync: false });
  },

  select: async (date) => {
    set({ selected: date });
    await loadDay(date, generation);
  },

  reset: () => {
    generation++;
    set(initial());
  },
}));

async function loadDay(date: string, run: number) {
  useTrackingStore.setState({ dayStatus: 'loading' });
  const failed = (e: any) => ({ data: null, error: { message: String(e?.message ?? e) } });
  const [meals, workouts] = await Promise.all([fetchEntries(date).catch(failed), fetchWorkouts(date, date).catch(failed)]);
  if (run !== generation || useTrackingStore.getState().selected !== date) return;
  if (meals.error || workouts.error) {
    useTrackingStore.setState({ dayStatus: 'error' });
    return;
  }
  useTrackingStore.setState({ meals: meals.data, workouts: workouts.data, dayStatus: 'ready' });
}
