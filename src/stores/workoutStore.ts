// src/stores/workoutStore.ts
// The workout being recorded and the uploads not yet confirmed, persisted
// per account so a session survives the app being closed or the phone
// restarting. A session that was running when the app was terminated is
// restored paused at its last heartbeat (the unknown gap is not counted).
// Completed sessions stay in the upload queue until the server confirms
// them; retries reuse the same client_session_id, so a session is never
// stored twice. GPS runs only between start/resume and pause/finish/discard
// of a session that asked for it (src/activity/backgroundGps.ts).
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { evaluatePoint, GeoPoint } from '../activity/gps';
import { drainFixes, gpsPermissionStillGranted, startBackgroundGps, stopBackgroundGps } from '../activity/backgroundGps';
import { motion } from '../activity/motionNative';
import { segmentSteps } from '../activity/stepCounter';
import { isTransient, withRetry } from '../activity/sync';
import type { WorkoutKind } from '../activity/types';
import {
  ActiveSession,
  addDistance,
  addExercise,
  addSet,
  anchorRoute,
  closeSegmentSteps,
  finishSession,
  FinishedSession,
  GymCategory,
  GymIntensity,
  GymSet,
  heartbeat,
  KINDS_WITH_DISTANCE,
  markSegmentStart,
  noteGpsGap,
  noteGpsLost,
  pauseSession,
  removeExercise,
  removeLastSet,
  restoreAfterLaunch,
  resumeSession,
  RoutePoint,
  setGymIntensity,
  startSession,
} from '../activity/workoutSession';
import { addDays, deviceTimeZone, localDate } from '../nutrition/dates';
import {
  deleteWorkout,
  fetchWorkouts,
  saveGymLog,
  uploadAppWorkout,
  workoutErrorMessage,
  WorkoutRecord,
} from '../services/workoutApi';

export interface WorkoutSummary {
  session: FinishedSession;
  route: RoutePoint[];
  uploaded: boolean;
}

interface WorkoutState {
  ownerId: string | null;
  active: ActiveSession | null;
  pending: FinishedSession[];
  notice: string | null;
  history: WorkoutRecord[];
  historyStatus: 'idle' | 'loading' | 'ready' | 'error';
  // Routes of recent sessions, on this device only (never uploaded).
  routes: Record<string, RoutePoint[]>;
  // 'background': GPS continues with the screen off; 'screen': only while
  // the workout screen is open (no native task support, e.g. Expo Go).
  gpsMode: 'off' | 'background' | 'screen';
  lastSummary: WorkoutSummary | null;
  claimForUser: (userId: string) => Promise<void>;
  start: (kind: WorkoutKind, options: { gps: boolean }) => Promise<{ ok: true } | { ok: false; reason: 'already_active' }>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  beat: () => void;
  addPoint: (p: GeoPoint & { error?: boolean }) => void;
  drainGps: () => Promise<void>;
  checkGpsPermission: () => Promise<void>;
  finish: () => Promise<{ ok: true; session: FinishedSession; uploaded: boolean } | { ok: false; reason: 'too_short' | 'none' }>;
  discard: () => Promise<void>;
  flush: () => Promise<void>;
  loadHistory: (days?: number) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  setIntensity: (i: GymIntensity) => void;
  addExercise: (name: string, category: GymCategory) => void;
  removeExercise: (id: string) => void;
  addSet: (exerciseId: string, set: GymSet) => void;
  removeLastSet: (exerciseId: string) => void;
  reset: () => void;
}

// Last accepted GPS fix of the running segment (memory only).
let anchor: GeoPoint | null = null;
let flushing: Promise<void> | null = null;
const MAX_ROUTES = 10;

const initial = {
  ownerId: null as string | null,
  active: null as ActiveSession | null,
  pending: [] as FinishedSession[],
  notice: null as string | null,
  history: [] as WorkoutRecord[],
  historyStatus: 'idle' as const,
  routes: {} as Record<string, RoutePoint[]>,
  gpsMode: 'off' as const,
  lastSummary: null as WorkoutSummary | null,
};

const countsSteps = (kind: WorkoutKind) => kind === 'walk' || kind === 'run';

// Android: one counter reading for a segment boundary (null when unavailable).
async function counterMark() {
  if (Platform.OS !== 'android') return null;
  try {
    return (await motion()?.recordSnapshotAsync?.()) ?? null;
  } catch {
    return null;
  }
}

// iPhone: steps of the session's segments, read from Core Motion.
async function iosSegmentSteps(session: FinishedSession): Promise<number | null> {
  const m = motion();
  if (Platform.OS !== 'ios' || !m?.queryAsync || !session.segments?.length) return null;
  try {
    let total = 0;
    for (const seg of session.segments) {
      const end = seg.end ? new Date(seg.end).getTime() : new Date(session.endedAt).getTime();
      total += (await m.queryAsync(new Date(seg.start).getTime(), end)).steps;
    }
    return Math.round(total);
  } catch {
    return null;
  }
}

async function startGpsFor(session: ActiveSession, set: (p: Partial<WorkoutState>) => void) {
  if (!session.gps.enabled) return;
  const background = await startBackgroundGps(session.id);
  set({ gpsMode: background ? 'background' : 'screen' });
}

export const useWorkoutStore = create<WorkoutState>()(
  persist(
    (set, get) => ({
      ...initial,

      claimForUser: async (userId) => {
        await waitForHydration();
        if (get().ownerId !== userId) {
          anchor = null;
          await stopBackgroundGps();
          set({ ...initial, ownerId: userId });
        }
      },

      start: async (kind, { gps }) => {
        if (get().active) return { ok: false, reason: 'already_active' };
        anchor = null;
        let session = startSession(kind, randomUUID(), deviceTimeZone(), new Date(), gps);
        if (countsSteps(kind)) session = markSegmentStart(session, await counterMark());
        set({ active: session, notice: null, lastSummary: null, gpsMode: 'off' });
        await startGpsFor(session, set);
        return { ok: true };
      },

      pause: async () => {
        const a = get().active;
        if (!a || a.status !== 'running') return;
        await stopBackgroundGps();
        await get().drainGps();
        let next = pauseSession(get().active ?? a, new Date());
        if (countsSteps(a.kind)) next = closeSegmentSteps(next, segmentSteps(a.openMark ?? null, await counterMark()));
        set({ active: next, gpsMode: 'off' });
      },

      resume: async () => {
        const a = get().active;
        if (!a || a.status !== 'paused') return;
        anchor = null; // never bridge a pause with a straight line
        let next = resumeSession(a, new Date());
        if (countsSteps(a.kind)) next = markSegmentStart(next, await counterMark());
        set({ active: next });
        await startGpsFor(next, set);
      },

      beat: () => {
        const a = get().active;
        if (a) set({ active: heartbeat(a, new Date()) });
      },

      addPoint: (p) => {
        const a = get().active;
        if (!a || a.status !== 'running' || !a.gps.enabled || a.gps.lost) return;
        if (p.error || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) {
          // The background task reported an error: a gap, never bridged.
          anchor = null;
          set({ active: noteGpsGap(a) });
          return;
        }
        const point = { lat: p.latitude, lng: p.longitude, t: p.timestamp };
        const d = evaluatePoint(anchor, p, a.kind);
        if (d.use) {
          anchor = p;
          set({ active: addDistance(a, d.meters, point) });
        } else if (d.anchor) {
          anchor = p;
          set({ active: anchorRoute(d.gap ? noteGpsGap(a) : a, point) });
        }
      },

      drainGps: async () => {
        const a = get().active;
        if (!a || !a.gps.enabled) return;
        for (const fix of await drainFixes(a.id)) get().addPoint(fix);
      },

      checkGpsPermission: async () => {
        const a = get().active;
        if (!a || !a.gps.enabled || a.gps.lost) return;
        if (!(await gpsPermissionStillGranted())) {
          await stopBackgroundGps();
          anchor = null;
          set({ active: noteGpsLost(get().active ?? a), gpsMode: 'off' });
        }
      },

      finish: async () => {
        const a = get().active;
        if (!a) return { ok: false, reason: 'none' };
        await stopBackgroundGps();
        await get().drainGps();
        let closing = get().active ?? a;
        if (closing.status === 'running' && countsSteps(closing.kind)) {
          closing = closeSegmentSteps(closing, segmentSteps(closing.openMark ?? null, await counterMark()));
        }
        const result = finishSession(closing, new Date());
        if (!result.ok) {
          // Too short: GPS stays stopped until the customer resumes.
          if (closing.status === 'running') set({ active: pauseSession(closing, new Date()), gpsMode: 'off' });
          return { ok: false, reason: 'too_short' };
        }
        let session = result.session;
        if (countsSteps(session.kind) && session.steps == null) {
          const ios = await iosSegmentSteps(session);
          if (ios !== null) session = { ...session, steps: ios };
        }
        anchor = null;
        const route = closing.route ?? [];
        const routes = { ...get().routes, ...(route.length > 1 ? { [session.clientSessionId]: route } : {}) };
        const kept = Object.keys(routes).slice(-MAX_ROUTES);
        set({
          active: null,
          gpsMode: 'off',
          pending: [...get().pending, session],
          routes: Object.fromEntries(kept.map((k) => [k, routes[k]])),
        });
        await get().flush();
        const uploaded = !get().pending.some((p) => p.clientSessionId === session.clientSessionId);
        set({ lastSummary: { session, route, uploaded } });
        return { ok: true, session, uploaded };
      },

      discard: async () => {
        const a = get().active;
        anchor = null;
        await stopBackgroundGps();
        if (a) await drainFixes(a.id); // throw the buffered fixes away
        set({ active: null, gpsMode: 'off' });
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
            if (r.error && /implausible step count/i.test(String(r.error.message)) && session.steps != null) {
              r = await withRetry(() => uploadAppWorkout({ ...session, steps: null }), { maxAttempts: 2 });
            }
            if (r.error && isTransient(r.error)) {
              set({ notice: workoutErrorMessage(r.error) });
              continue; // stays queued; retried on the next flush
            }
            if (!r.error && session.gym && session.gym.length > 0 && !session.gymSaved) {
              const g = await withRetry(() => saveGymLog(session.clientSessionId, session.gym ?? []), { maxAttempts: 2 });
              if (g.error && isTransient(g.error)) {
                // The session is stored; only the exercise list is retried.
                set({
                  pending: get().pending.map((p) => (p.clientSessionId === session.clientSessionId ? { ...p, gymSaved: false } : p)),
                  notice: 'Séance enregistrée. Le détail des exercices sera envoyé dès que la connexion revient.',
                });
                continue;
              }
              if (g.error) notice = 'Séance enregistrée, mais le détail des exercices n’a pas pu être envoyé.';
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

      setIntensity: (i) => {
        const a = get().active;
        if (a) set({ active: setGymIntensity(a, i) });
      },
      addExercise: (name, category) => {
        const a = get().active;
        if (a) set({ active: addExercise(a, { id: randomUUID(), name, category, sets: [] }) });
      },
      removeExercise: (id) => {
        const a = get().active;
        if (a) set({ active: removeExercise(a, id) });
      },
      addSet: (exerciseId, s) => {
        const a = get().active;
        if (a) set({ active: addSet(a, exerciseId, s) });
      },
      removeLastSet: (exerciseId) => {
        const a = get().active;
        if (a) set({ active: removeLastSet(a, exerciseId) });
      },

      reset: () => {
        anchor = null;
        void stopBackgroundGps();
        set({ ...initial });
      },
    }),
    {
      name: 'loption-workout',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ownerId: s.ownerId, active: s.active, pending: s.pending, routes: s.routes }),
      // A new app process: a session left running was interrupted. Its GPS
      // is stopped (the customer resumes or finishes it explicitly).
      onRehydrateStorage: () => (state) => {
        if (state?.active) {
          useWorkoutStore.setState({ active: restoreAfterLaunch(state.active), gpsMode: 'off' });
          void stopBackgroundGps();
        }
      },
    }
  )
);

export { KINDS_WITH_DISTANCE };

function waitForHydration(): Promise<void> {
  if (useWorkoutStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useWorkoutStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
