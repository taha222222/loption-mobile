// src/stores/workoutStore.ts
// The workout being recorded and the uploads not yet confirmed, persisted
// per account so a session survives the app being closed. A session that
// was running when the app was terminated is restored paused at its last
// heartbeat (the unknown gap is not counted). Completed sessions stay in
// the upload queue until the server confirms them; retries reuse the same
// client_session_id, so a session is never stored twice.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { evaluatePoint, GeoPoint } from '../activity/gps';
import { isTransient, withRetry } from '../activity/sync';
import type { WorkoutKind } from '../activity/types';
import {
  ActiveSession,
  addDistance,
  finishSession,
  FinishedSession,
  heartbeat,
  noteGpsGap,
  pauseSession,
  restoreAfterLaunch,
  resumeSession,
  startSession,
} from '../activity/workoutSession';
import { addDays, deviceTimeZone, localDate } from '../nutrition/dates';
import { deleteWorkout, fetchWorkouts, uploadAppWorkout, workoutErrorMessage, WorkoutRecord } from '../services/workoutApi';

interface WorkoutState {
  ownerId: string | null;
  active: ActiveSession | null;
  pending: FinishedSession[];
  notice: string | null;
  history: WorkoutRecord[];
  historyStatus: 'idle' | 'loading' | 'ready' | 'error';
  claimForUser: (userId: string) => Promise<void>;
  start: (kind: WorkoutKind, options: { gps: boolean }) => { ok: true } | { ok: false; reason: 'already_active' };
  pause: () => void;
  resume: () => void;
  beat: () => void;
  addPoint: (p: GeoPoint) => void;
  finish: () => Promise<{ ok: true; session: FinishedSession; uploaded: boolean } | { ok: false; reason: 'too_short' | 'none' }>;
  discard: () => void;
  flush: () => Promise<void>;
  loadHistory: (days?: number) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  reset: () => void;
}

// Last accepted GPS fix of the running segment (memory only).
let anchor: GeoPoint | null = null;
let flushing: Promise<void> | null = null;

const initial = {
  ownerId: null as string | null,
  active: null as ActiveSession | null,
  pending: [] as FinishedSession[],
  notice: null as string | null,
  history: [] as WorkoutRecord[],
  historyStatus: 'idle' as const,
};

export const useWorkoutStore = create<WorkoutState>()(
  persist(
    (set, get) => ({
      ...initial,

      claimForUser: async (userId) => {
        await waitForHydration();
        if (get().ownerId !== userId) {
          anchor = null;
          set({ ...initial, ownerId: userId });
        }
      },

      start: (kind, { gps }) => {
        if (get().active) return { ok: false, reason: 'already_active' };
        anchor = null;
        set({ active: startSession(kind, randomUUID(), deviceTimeZone(), new Date(), gps), notice: null });
        return { ok: true };
      },

      pause: () => {
        const a = get().active;
        if (a) set({ active: pauseSession(a, new Date()) });
      },

      resume: () => {
        const a = get().active;
        anchor = null; // never bridge a pause with a straight line
        if (a) set({ active: resumeSession(a, new Date()) });
      },

      beat: () => {
        const a = get().active;
        if (a) set({ active: heartbeat(a, new Date()) });
      },

      addPoint: (p) => {
        const a = get().active;
        if (!a || a.status !== 'running' || !a.gps.enabled) return;
        const d = evaluatePoint(anchor, p, a.kind);
        if (d.use) {
          anchor = p;
          set({ active: addDistance(a, d.meters) });
        } else if (d.anchor) {
          anchor = p;
          if (d.gap) set({ active: noteGpsGap(a) });
        }
      },

      finish: async () => {
        const a = get().active;
        if (!a) return { ok: false, reason: 'none' };
        const result = finishSession(a, new Date());
        if (!result.ok) return { ok: false, reason: 'too_short' };
        anchor = null;
        set({ active: null, pending: [...get().pending, result.session] });
        await get().flush();
        const uploaded = !get().pending.some((p) => p.clientSessionId === result.session.clientSessionId);
        return { ok: true, session: result.session, uploaded };
      },

      discard: () => {
        anchor = null;
        set({ active: null });
      },

      flush: async () => {
        if (flushing) return flushing;
        flushing = (async () => {
          for (const session of [...get().pending]) {
            let r = await withRetry(() => uploadAppWorkout(session), { maxAttempts: 2 });
            let notice: string | null = null;
            if (r.error && /implausible distance/i.test(String(r.error.message)) && session.distanceM !== null) {
              // Keep the session, drop the GPS distance the server refused.
              r = await withRetry(() => uploadAppWorkout({ ...session, distanceM: null }), { maxAttempts: 2 });
              notice = 'La distance GPS n’était pas plausible : la séance a été enregistrée sans distance.';
            }
            if (r.error && isTransient(r.error)) {
              set({ notice: workoutErrorMessage(r.error) });
              continue; // stays queued; retried on the next flush
            }
            set({
              pending: get().pending.filter((p) => p.clientSessionId !== session.clientSessionId),
              notice: r.error ? workoutErrorMessage(r.error) : notice,
            });
          }
        })();
        try {
          await flushing;
        } finally {
          flushing = null;
        }
      },

      loadHistory: async (days = 30) => {
        const tz = deviceTimeZone();
        const today = localDate(tz);
        set({ historyStatus: get().history.length ? 'ready' : 'loading' });
        const r = await fetchWorkouts(addDays(today, -(days - 1)), today);
        if (r.error) {
          set({ historyStatus: 'error' });
          return;
        }
        set({ history: r.data.slice().reverse(), historyStatus: 'ready' });
      },

      remove: async (id) => {
        const r = await deleteWorkout(id);
        if (r.error) return false;
        set({ history: get().history.filter((w) => w.id !== id) });
        return true;
      },

      reset: () => {
        anchor = null;
        set({ ...initial });
      },
    }),
    {
      name: 'loption-workout',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ownerId: s.ownerId, active: s.active, pending: s.pending }),
      // A new app process: a session left running was interrupted.
      onRehydrateStorage: () => (state) => {
        if (state?.active) useWorkoutStore.setState({ active: restoreAfterLaunch(state.active) });
      },
    }
  )
);

function waitForHydration(): Promise<void> {
  if (useWorkoutStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useWorkoutStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
