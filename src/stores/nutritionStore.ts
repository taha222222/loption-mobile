// src/stores/nutritionStore.ts
// Today's tracking state for the signed-in customer, always reloaded from
// the server (summary, entries, streak). Logging keeps one idempotency key
// per pending request, so a retry after a timeout or a double tap never
// creates a second entry.
import { create } from 'zustand';
import { randomUUID } from 'expo-crypto';
import { addDays, deviceTimeZone, localDate } from '../nutrition/dates';
import { DaySummary, StreakInfo, trackingErrorMessage } from '../nutrition/tracking';
import * as api from '../services/nutritionApi';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type HistoryRange = 7 | 30;

interface NutritionState {
  timeZone: string;
  today: string;
  range: HistoryRange;
  history: DaySummary[];
  entries: api.LogEntry[];
  streak: StreakInfo | null;
  status: LoadStatus;
  error: string | null;
  // pending idempotency keys, by request signature
  pending: Record<string, string>;
  refresh: () => Promise<void>;
  setRange: (range: HistoryRange) => Promise<void>;
  logMeal: (input: {
    mealId: string;
    servings: number;
    orderItemId?: string | null;
    localDate?: string;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  removeEntry: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  reset: () => void;
}

const initial = () => {
  const timeZone = deviceTimeZone();
  return {
    timeZone,
    today: localDate(timeZone),
    range: 7 as HistoryRange,
    history: [] as DaySummary[],
    entries: [] as api.LogEntry[],
    streak: null as StreakInfo | null,
    status: 'idle' as LoadStatus,
    error: null as string | null,
    pending: {} as Record<string, string>,
  };
};

let generation = 0;

export const useNutritionStore = create<NutritionState>((set, get) => ({
  ...initial(),

  refresh: async () => {
    const run = ++generation;
    // The day can change while the app is open, or the customer travels.
    const timeZone = deviceTimeZone();
    const today = localDate(timeZone);
    const from = addDays(today, -(get().range - 1));
    set({ timeZone, today, status: get().status === 'ready' ? 'ready' : 'loading', error: null });
    const [summary, entries, streak] = await Promise.all([
      api.fetchSummary(from, today, today),
      api.fetchEntries(today),
      api.fetchStreak(today),
    ]);
    if (run !== generation) return; // a newer refresh (or a reset) superseded this one
    if (summary.error || entries.error || streak.error) {
      set({ status: 'error', error: 'Impossible de charger votre suivi. Vérifiez votre connexion et réessayez.' });
      return;
    }
    set({ history: summary.data, entries: entries.data, streak: streak.data, status: 'ready', error: null });
  },

  setRange: async (range) => {
    set({ range });
    await get().refresh();
  },

  logMeal: async ({ mealId, servings, orderItemId = null, localDate: date }) => {
    const { timeZone, today } = get();
    const day = date ?? today;
    const signature = `${mealId}|${orderItemId ?? ''}|${servings}|${day}`;
    const requestId = get().pending[signature] ?? randomUUID();
    set({ pending: { ...get().pending, [signature]: requestId } });
    const result = await api.logMeal({ requestId, mealId, servings, orderItemId, localDate: day, timeZone });
    if (result.error) {
      // Keep the key: retrying the same request must not duplicate it.
      return { ok: false, message: trackingErrorMessage(result.error) };
    }
    const { [signature]: _done, ...rest } = get().pending;
    set({ pending: rest });
    await get().refresh();
    return { ok: true };
  },

  removeEntry: async (id) => {
    const result = await api.removeEntry(id);
    if (result.error) return { ok: false, message: trackingErrorMessage(result.error) };
    await get().refresh();
    return { ok: true };
  },

  reset: () => {
    generation++;
    set(initial());
  },
}));
