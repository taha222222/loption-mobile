// src/activity/workoutSession.ts
// Pure state machine for a workout recorded in the app. Time is measured
// from timestamps (not timers), so a session stays correct while the app is
// in the background; pauses are excluded from the active time. If the app
// is terminated, the session is restored paused at the last moment the app
// was seen running, so an unknown gap is never counted.
import type { CounterSnapshot } from './stepCounter';
import type { WorkoutKind } from './types';

export type SessionStatus = 'running' | 'paused';

// GPS route kept on the device only (shown in the summary, never uploaded).
export interface RoutePoint {
  lat: number;
  lng: number;
  t: number; // ms
  start?: boolean; // first point of a stretch (after a gap or a pause): not joined to the previous one
}
export const MAX_ROUTE_POINTS = 2000;

export type GymIntensity = 'light' | 'moderate' | 'vigorous';
export type GymCategory = 'upper_body' | 'lower_body' | 'full_body' | 'core' | 'cardio' | 'mobility';
export interface GymSet {
  reps: number;
  weightKg: number | null;
  restSeconds: number | null;
}
export interface GymExercise {
  id: string; // local id (list key)
  name: string;
  category: GymCategory;
  sets: GymSet[];
}
export const MAX_EXERCISES = 30;
export const MAX_SETS = 20;

export interface Segment {
  start: string; // ISO
  end: string | null; // null while running
}

export interface ActiveSession {
  id: string; // client_session_id (idempotency key of the upload)
  kind: WorkoutKind;
  timeZone: string;
  startedAt: string;
  status: SessionStatus;
  segments: Segment[];
  lastSeenAt: string; // last heartbeat while the app was running
  gps: { enabled: boolean; distanceM: number; points: number; gaps: number; lastFixAt?: number | null; lost?: 'permission' | null };
  interrupted?: boolean; // restored after the app was terminated
  route?: RoutePoint[];
  // Phone steps during the session (Android counter readings): the reading
  // at the start of the running segment, and the steps of closed segments
  // (null when a segment cannot be measured, e.g. after a reboot).
  openMark?: CounterSnapshot | null;
  segmentSteps?: (number | null)[];
  gym?: { intensity: GymIntensity; exercises: GymExercise[] };
}

export interface FinishedSession {
  clientSessionId: string;
  kind: WorkoutKind;
  timeZone: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  distanceM: number | null;
  steps?: number | null;
  intensity?: GymIntensity | null;
  gym?: GymExercise[] | null;
  gymSaved?: boolean; // the gym log reached the server
  segments?: Segment[]; // to read the phone's steps per segment (iPhone)
}

export const MIN_ACTIVE_SECONDS = 60;
export const KINDS_WITH_DISTANCE: WorkoutKind[] = ['walk', 'run', 'cycle'];

const iso = (d: Date) => d.toISOString();

export function startSession(kind: WorkoutKind, id: string, timeZone: string, now: Date, gps: boolean): ActiveSession {
  return {
    id,
    kind,
    timeZone,
    startedAt: iso(now),
    status: 'running',
    segments: [{ start: iso(now), end: null }],
    lastSeenAt: iso(now),
    gps: { enabled: gps && KINDS_WITH_DISTANCE.includes(kind), distanceM: 0, points: 0, gaps: 0, lastFixAt: null, lost: null },
    route: [],
    segmentSteps: [],
    openMark: null,
    ...(kind === 'gym' ? { gym: { intensity: 'moderate' as GymIntensity, exercises: [] } } : {}),
  };
}

export function pauseSession(s: ActiveSession, now: Date): ActiveSession {
  if (s.status !== 'running') return s;
  return {
    ...s,
    status: 'paused',
    segments: s.segments.map((seg, i) => (i === s.segments.length - 1 ? { ...seg, end: iso(now) } : seg)),
    lastSeenAt: iso(now),
  };
}

export function resumeSession(s: ActiveSession, now: Date): ActiveSession {
  if (s.status !== 'paused') return s;
  return { ...s, status: 'running', segments: [...s.segments, { start: iso(now), end: null }], lastSeenAt: iso(now), interrupted: false };
}

export function heartbeat(s: ActiveSession, now: Date): ActiveSession {
  return s.status === 'running' ? { ...s, lastSeenAt: iso(now) } : s;
}

export function activeSeconds(s: ActiveSession, now: Date): number {
  let ms = 0;
  for (const seg of s.segments) {
    const end = seg.end ? new Date(seg.end).getTime() : now.getTime();
    ms += Math.max(0, end - new Date(seg.start).getTime());
  }
  return Math.floor(ms / 1000);
}

// Called once when a persisted session is loaded in a new app process: a
// session that was running is paused at its last heartbeat.
export function restoreAfterLaunch(s: ActiveSession): ActiveSession {
  if (s.status !== 'running') return s;
  return { ...pauseSession(s, new Date(s.lastSeenAt)), interrupted: true };
}

export function addDistance(s: ActiveSession, meters: number, point?: RoutePoint): ActiveSession {
  if (!s.gps.enabled || s.status !== 'running' || !(meters > 0)) return s;
  return {
    ...s,
    gps: { ...s.gps, distanceM: s.gps.distanceM + meters, points: s.gps.points + 1, lastFixAt: point?.t ?? s.gps.lastFixAt ?? null, lost: null },
    route: point ? addRoutePoint(s.route ?? [], point) : s.route,
  };
}

// A new segment of the route starts (first fix, after a gap or a pause).
export function anchorRoute(s: ActiveSession, point: RoutePoint): ActiveSession {
  if (!s.gps.enabled) return s;
  return { ...s, gps: { ...s.gps, lastFixAt: point.t, lost: null }, route: addRoutePoint(s.route ?? [], { ...point, start: true }) };
}

// Keeps the route bounded: past the limit every other point is dropped.
export function addRoutePoint(route: RoutePoint[], p: RoutePoint): RoutePoint[] {
  const next = [...route, p];
  if (next.length <= MAX_ROUTE_POINTS) return next;
  return next.filter((pt, i) => i % 2 === 0 || pt.start || i === next.length - 1);
}

export function noteGpsGap(s: ActiveSession): ActiveSession {
  return { ...s, gps: { ...s.gps, gaps: s.gps.gaps + 1 } };
}

// Location permission was withdrawn during the session: distance stops.
export function noteGpsLost(s: ActiveSession): ActiveSession {
  return { ...s, gps: { ...s.gps, lost: 'permission' } };
}

export const GPS_WEAK_MS = 30_000;
// 'ok' | 'searching' (no fix yet) | 'weak' (no accepted fix for 30 s) | 'lost'
export function gpsSignal(s: ActiveSession, nowMs: number): 'off' | 'ok' | 'searching' | 'weak' | 'lost' {
  if (!s.gps.enabled) return 'off';
  if (s.gps.lost) return 'lost';
  if (s.status !== 'running') return 'ok';
  if (!s.gps.lastFixAt) return 'searching';
  return nowMs - s.gps.lastFixAt > GPS_WEAK_MS ? 'weak' : 'ok';
}

// Phone steps (Android counter readings) at segment boundaries.
export function markSegmentStart(s: ActiveSession, mark: CounterSnapshot | null): ActiveSession {
  return { ...s, openMark: mark };
}
export function closeSegmentSteps(s: ActiveSession, steps: number | null): ActiveSession {
  return { ...s, openMark: null, segmentSteps: [...(s.segmentSteps ?? []), steps] };
}
export function totalSegmentSteps(s: ActiveSession): number | null {
  const list = s.segmentSteps ?? [];
  if (list.length === 0 || list.length < s.segments.length || list.some((n) => n === null)) return null;
  return list.reduce<number>((a, n) => a + (n ?? 0), 0);
}

// Gym log editing (pure; the screen keeps the list small).
export function setGymIntensity(s: ActiveSession, intensity: GymIntensity): ActiveSession {
  if (!s.gym) return s;
  return { ...s, gym: { ...s.gym, intensity } };
}
export function addExercise(s: ActiveSession, ex: GymExercise): ActiveSession {
  if (!s.gym || s.gym.exercises.length >= MAX_EXERCISES) return s;
  const name = ex.name.trim().slice(0, 60);
  if (!name) return s;
  return { ...s, gym: { ...s.gym, exercises: [...s.gym.exercises, { ...ex, name, sets: [] }] } };
}
export function removeExercise(s: ActiveSession, id: string): ActiveSession {
  if (!s.gym) return s;
  return { ...s, gym: { ...s.gym, exercises: s.gym.exercises.filter((e) => e.id !== id) } };
}
export function addSet(s: ActiveSession, exerciseId: string, set: GymSet): ActiveSession {
  if (!s.gym || !(set.reps >= 1 && set.reps <= 200)) return s;
  const weight = set.weightKg === null || !Number.isFinite(set.weightKg) ? null : Math.min(500, Math.max(0, Math.round(set.weightKg * 10) / 10));
  const rest = set.restSeconds === null || !Number.isFinite(set.restSeconds) ? null : Math.min(1800, Math.max(0, Math.round(set.restSeconds)));
  return {
    ...s,
    gym: {
      ...s.gym,
      exercises: s.gym.exercises.map((e) =>
        e.id === exerciseId && e.sets.length < MAX_SETS ? { ...e, sets: [...e.sets, { reps: Math.round(set.reps), weightKg: weight, restSeconds: rest }] } : e
      ),
    },
  };
}
export function removeLastSet(s: ActiveSession, exerciseId: string): ActiveSession {
  if (!s.gym) return s;
  return { ...s, gym: { ...s.gym, exercises: s.gym.exercises.map((e) => (e.id === exerciseId ? { ...e, sets: e.sets.slice(0, -1) } : e)) } };
}

export type FinishResult = { ok: true; session: FinishedSession } | { ok: false; reason: 'too_short' };

export function finishSession(s: ActiveSession, now: Date): FinishResult {
  const closed = s.status === 'running' ? pauseSession(s, now) : s;
  const seconds = activeSeconds(closed, now);
  if (seconds < MIN_ACTIVE_SECONDS) return { ok: false, reason: 'too_short' };
  const last = closed.segments[closed.segments.length - 1];
  return {
    ok: true,
    session: {
      clientSessionId: s.id,
      kind: s.kind,
      timeZone: s.timeZone,
      startedAt: s.startedAt,
      endedAt: last.end ?? iso(now),
      activeSeconds: seconds,
      distanceM: s.gps.enabled && s.gps.distanceM >= 1 ? Math.round(s.gps.distanceM) : null,
      steps: KINDS_WITH_DISTANCE.includes(s.kind) && s.kind !== 'cycle' ? totalSegmentSteps(closed) : null,
      intensity: s.kind === 'gym' ? (s.gym?.intensity ?? null) : null,
      gym: s.kind === 'gym' ? (s.gym?.exercises.filter((e) => e.sets.length > 0) ?? []) : null,
      gymSaved: false,
      segments: closed.segments,
    },
  };
}
