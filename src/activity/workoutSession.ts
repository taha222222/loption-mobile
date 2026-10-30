// src/activity/workoutSession.ts
// Pure state machine for a workout recorded in the app. Time is measured
// from timestamps (not timers), so a session stays correct while the app is
// in the background; pauses are excluded from the active time. If the app
// is terminated, the session is restored paused at the last moment the app
// was seen running, so an unknown gap is never counted.
import type { WorkoutKind } from './types';

export type SessionStatus = 'running' | 'paused';

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
  gps: { enabled: boolean; distanceM: number; points: number; gaps: number };
  interrupted?: boolean; // restored after the app was terminated
}

export interface FinishedSession {
  clientSessionId: string;
  kind: WorkoutKind;
  timeZone: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  distanceM: number | null;
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
    gps: { enabled: gps && KINDS_WITH_DISTANCE.includes(kind), distanceM: 0, points: 0, gaps: 0 },
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

export function addDistance(s: ActiveSession, meters: number): ActiveSession {
  if (!s.gps.enabled || s.status !== 'running' || !(meters > 0)) return s;
  return { ...s, gps: { ...s.gps, distanceM: s.gps.distanceM + meters, points: s.gps.points + 1 } };
}

export function noteGpsGap(s: ActiveSession): ActiveSession {
  return { ...s, gps: { ...s.gps, gaps: s.gps.gaps + 1 } };
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
    },
  };
}
