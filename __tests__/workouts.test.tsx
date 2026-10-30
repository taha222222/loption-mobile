// Workout engine: session state machine, GPS filtering, upload queue and
// the workout screen, with the API mocked. Server rules (MET estimate,
// overlap refusal, deduplication) are tested in supabase/tests/run_v1_activity.sh.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  activeSeconds,
  addDistance,
  finishSession,
  pauseSession,
  restoreAfterLaunch,
  resumeSession,
  startSession,
} from '../src/activity/workoutSession';
import { evaluatePoint, formatDistance, formatDuration, formatPace, haversineM, paceSecondsPerKm, speedKmh } from '../src/activity/gps';
import { useWorkoutStore } from '../src/stores/workoutStore';
import { importProviderWorkouts } from '../src/services/workoutApi';
import WorkoutScreen from '../app/(app)/workout';

const mockUpload = jest.fn();
const mockFetch = jest.fn();
jest.mock('../src/services/workoutApi', () => ({
  ...jest.requireActual('../src/services/workoutApi'),
  uploadAppWorkout: (...a: any[]) => mockUpload(...a),
  fetchWorkouts: (...a: any[]) => mockFetch(...a),
}));
const mockUpsert = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: { from: () => ({ upsert: (...a: any[]) => mockUpsert(...a) }) },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `ws-${++mockUuid}` }));
const mockGps = { request: jest.fn(), watch: jest.fn() };
jest.mock('../src/activity/workoutGps', () => ({
  requestWorkoutGps: () => mockGps.request(),
  watchWorkoutLocation: (cb: any) => mockGps.watch(cb),
}));
jest.mock('../src/activity/sync', () => ({
  ...jest.requireActual('../src/activity/sync'),
  // no real backoff delays in tests
  withRetry: (call: any, o: any = {}) => jest.requireActual('../src/activity/sync').withRetry(call, { ...o, sleep: async () => {} }),
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ kind: 'run' }),
}));

const t0 = new Date('2026-10-29T08:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  useWorkoutStore.getState().reset();
  mockUpload.mockResolvedValue({ data: true, error: null });
  mockGps.request.mockResolvedValue('granted');
  mockGps.watch.mockResolvedValue(() => {});
});

describe('session state machine', () => {
  it('counts active time from timestamps and excludes pauses', () => {
    let s = startSession('run', 'id-1', 'Africa/Casablanca', t0, true);
    s = pauseSession(s, at(600));
    expect(activeSeconds(s, at(900))).toBe(600); // paused: clock does not move
    s = resumeSession(s, at(900));
    expect(activeSeconds(s, at(1500))).toBe(1200);
    const r = finishSession(s, at(1500));
    expect(r).toEqual({
      ok: true,
      session: expect.objectContaining({ clientSessionId: 'id-1', activeSeconds: 1200, startedAt: t0.toISOString(), endedAt: at(1500).toISOString() }),
    });
  });

  it('refuses a session shorter than a minute', () => {
    const s = startSession('walk', 'id-2', 'Africa/Casablanca', t0, false);
    expect(finishSession(s, at(30))).toEqual({ ok: false, reason: 'too_short' });
  });

  it('restores a session interrupted by app termination paused at its last heartbeat (gap not counted)', () => {
    let s = startSession('walk', 'id-3', 'Africa/Casablanca', t0, false);
    s = { ...s, lastSeenAt: at(1200).toISOString() };
    const restored = restoreAfterLaunch(s);
    expect(restored.status).toBe('paused');
    expect(restored.interrupted).toBe(true);
    expect(activeSeconds(restored, at(7200))).toBe(1200);
  });

  it('never enables GPS for a gym session and adds distance only while running', () => {
    expect(startSession('gym', 'g', 'UTC', t0, true).gps.enabled).toBe(false);
    let s = startSession('cycle', 'c', 'UTC', t0, true);
    s = addDistance(s, 50);
    s = pauseSession(s, at(60));
    s = addDistance(s, 500);
    expect(s.gps.distanceM).toBe(50);
  });

  it('records no distance when GPS was refused or unused', () => {
    const s = startSession('run', 'r', 'UTC', t0, false);
    const r = finishSession(s, at(600));
    expect(r.ok && r.session.distanceM).toBeNull();
  });
});

describe('GPS distance', () => {
  const p = (lat: number, lon: number, s: number, accuracy: number | null = 5) => ({ latitude: lat, longitude: lon, accuracy, timestamp: t0.getTime() + s * 1000 });

  it('computes great-circle distances', () => {
    expect(Math.round(haversineM(p(0, 0, 0), p(1, 0, 1)) / 100) / 10).toBe(111.2);
  });

  it('ignores inaccurate fixes, jitter, impossible speeds; never bridges a gap', () => {
    expect(evaluatePoint(null, p(33.5, -7.6, 0), 'walk')).toMatchObject({ use: false, anchor: true, reason: 'first' });
    expect(evaluatePoint(p(33.5, -7.6, 0), p(33.5001, -7.6, 5, 80), 'walk')).toMatchObject({ use: false, reason: 'inaccurate' });
    expect(evaluatePoint(p(33.5, -7.6, 0), p(33.50001, -7.6, 5), 'walk')).toMatchObject({ use: false, reason: 'jitter' });
    expect(evaluatePoint(p(33.5, -7.6, 0), p(33.501, -7.6, 5), 'walk')).toMatchObject({ use: false, reason: 'too_fast' }); // 111 m in 5 s
    expect(evaluatePoint(p(33.5, -7.6, 0), p(33.501, -7.6, 5), 'cycle')).toMatchObject({ use: true });
    expect(evaluatePoint(p(33.5, -7.6, 0), p(33.51, -7.6, 600), 'walk')).toMatchObject({ use: false, anchor: true, gap: true });
  });

  it('shows pace and speed only for meaningful distances', () => {
    expect(paceSecondsPerKm(5000, 1500)).toBe(300);
    expect(formatPace(300)).toBe('5\'00" /km');
    expect(paceSecondsPerKm(50, 1500)).toBeNull();
    expect(speedKmh(18000, 3600)).toBe(18);
    expect(speedKmh(null, 3600)).toBeNull();
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(5230)).toBe('5,23 km');
  });
});

describe('workout store', () => {
  it('allows one session at a time', () => {
    const s = useWorkoutStore.getState();
    expect(s.start('walk', { gps: false })).toEqual({ ok: true });
    expect(useWorkoutStore.getState().start('run', { gps: false })).toEqual({ ok: false, reason: 'already_active' });
  });

  it.each(['walk', 'run', 'cycle', 'gym'] as const)('records and uploads a %s session', async (kind) => {
    jest.useFakeTimers({ now: t0 });
    useWorkoutStore.getState().start(kind, { gps: kind !== 'gym' });
    jest.setSystemTime(at(1800));
    const r = await useWorkoutStore.getState().finish();
    jest.useRealTimers();
    expect(r).toMatchObject({ ok: true, uploaded: true });
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ kind, activeSeconds: 1800 }));
    expect(useWorkoutStore.getState().pending).toEqual([]);
  });

  it('keeps a session queued on a network failure and re-sends it with the same id', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    jest.useFakeTimers({ now: t0 });
    useWorkoutStore.getState().start('walk', { gps: false });
    jest.setSystemTime(at(900));
    const r = await useWorkoutStore.getState().finish();
    jest.useRealTimers();
    expect(r).toMatchObject({ ok: true, uploaded: false });
    expect(useWorkoutStore.getState().pending).toHaveLength(1);
    const id = mockUpload.mock.calls[0][0].clientSessionId;
    mockUpload.mockResolvedValue({ data: true, error: null });
    await useWorkoutStore.getState().flush();
    expect(mockUpload.mock.calls.at(-1)[0].clientSessionId).toBe(id);
    expect(useWorkoutStore.getState().pending).toEqual([]);
  });

  it('keeps the session but drops a distance the server finds implausible', async () => {
    mockUpload
      .mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'implausible distance for this workout' } })
      .mockResolvedValueOnce({ data: true, error: null });
    jest.useFakeTimers({ now: t0 });
    useWorkoutStore.getState().start('walk', { gps: true });
    useWorkoutStore.setState((s) => ({ active: s.active && addDistance(s.active, 9000) }));
    jest.setSystemTime(at(600));
    await useWorkoutStore.getState().finish();
    jest.useRealTimers();
    expect(mockUpload.mock.calls[1][0].distanceM).toBeNull();
    expect(useWorkoutStore.getState().notice).toMatch(/sans distance/);
  });

  it('reports a session refused for overlap and does not retry it', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { code: '22023', message: 'workout overlaps another session' } });
    jest.useFakeTimers({ now: t0 });
    useWorkoutStore.getState().start('run', { gps: false });
    jest.setSystemTime(at(600));
    await useWorkoutStore.getState().finish();
    jest.useRealTimers();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(useWorkoutStore.getState().pending).toEqual([]);
    expect(useWorkoutStore.getState().notice).toMatch(/couvre déjà/);
  });
});

describe('provider workout import', () => {
  const w = (id: string, kind: any, distanceM: number | null) => ({
    externalId: id,
    kind,
    startedAt: '2026-10-28T07:00:00Z',
    endedAt: '2026-10-28T07:40:00Z',
    activeSeconds: 2400,
    distanceM,
    energyKcal: 300,
  });

  it('imports each workout once (provider id), skipping refused ones and stopping on network failure', async () => {
    mockUpsert
      .mockResolvedValueOnce({ error: { code: '22023', message: 'implausible distance' } })
      .mockResolvedValueOnce({ error: null });
    const r = await importProviderWorkouts([w('a', 'run', 99999), w('b', 'gym', 500)], 'apple_health', 'Africa/Casablanca');
    expect(r.error).toBeNull();
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[1][0]).toMatchObject({ external_id: 'b', distance_m: null, distance_source: null, provider_energy_kcal: 300 });
    expect(mockUpsert.mock.calls[1][1]).toEqual({ onConflict: 'user_id,source,external_id', ignoreDuplicates: true });

    mockUpsert.mockResolvedValueOnce({ error: { message: 'Network request failed' } });
    const r2 = await importProviderWorkouts([w('c', 'walk', 3000), w('d', 'walk', 3000)], 'apple_health', 'Africa/Casablanca');
    expect(r2.error).not.toBeNull();
  });
});

describe('workout screen', () => {
  it('starts a run with GPS when allowed and shows the timer', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByText('Démarrer · Course'));
    await waitFor(() => expect(screen.getByText('En cours')).toBeTruthy());
    expect(useWorkoutStore.getState().active).toMatchObject({ kind: 'run', gps: { enabled: true } });
    await waitFor(() => expect(mockGps.watch).toHaveBeenCalled());
  });

  it('starts without distance when GPS permission is refused, and says so', async () => {
    mockGps.request.mockResolvedValue('denied');
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByText('Démarrer · Course'));
    await waitFor(() => expect(screen.getByText('GPS non autorisé')).toBeTruthy());
    expect(useWorkoutStore.getState().active?.gps.enabled).toBe(false);
    expect(mockGps.watch).not.toHaveBeenCalled();
    expect(screen.getByText('Sans GPS : seule la durée est enregistrée.')).toBeTruthy();
  });

  it('pauses and resumes', async () => {
    useWorkoutStore.getState().start('gym', { gps: false });
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByText('Pause'));
    expect(useWorkoutStore.getState().active?.status).toBe('paused');
    await fireEvent.press(screen.getByText('Reprendre'));
    expect(useWorkoutStore.getState().active?.status).toBe('running');
    expect(screen.getByText(/ne sont pas détectés automatiquement/)).toBeTruthy();
  });

  it('explains an interrupted session', async () => {
    useWorkoutStore.setState({ active: restoreAfterLaunch({ ...startSession('walk', 'x', 'UTC', t0, false), lastSeenAt: at(600).toISOString() }) });
    await render(<WorkoutScreen />);
    expect(screen.getByText('Séance interrompue')).toBeTruthy();
    expect(screen.getByText('Reprendre')).toBeTruthy();
  });
});
