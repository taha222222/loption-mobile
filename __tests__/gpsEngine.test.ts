// GPS live map engine: pure helpers (current pace and speed, sampling,
// calorie preview against the server's tables), the on-device fix buffer
// under concurrent writes, and recovery after the system closed the app.
// expo-location is mocked: real OS delivery is a device test
// (docs/v1/DEVICE_TEST_PROCEDURES.md §4).
import * as fs from 'fs';
import * as path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { drainFixes, handleTaskBatch, lastBufferedFixAt, startBackgroundGps } from '../src/activity/backgroundGps';
import { currentSpeedMps, evaluatePoint, kmh, paceFromSpeed, samplingFor } from '../src/activity/gps';
import { GYM_MET, MET_TIERS, metFor, previewKcal } from '../src/activity/metPreview';
import { restoreAfterLaunch, startSession } from '../src/activity/workoutSession';

const mockLoc = { start: jest.fn() };
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  startLocationUpdatesAsync: (...a: any[]) => mockLoc.start(...a),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: async () => true,
  getForegroundPermissionsAsync: async () => ({ granted: true }),
}));

const T = 1_800_000_000_000;
// Points 3 s apart moving north at `mps` (1 deg latitude ≈ 111 195 m).
const walkRoute = (n: number, mps: number, startT = T) =>
  Array.from({ length: n }, (_, i) => ({ lat: 33.5 + (i * 3 * mps) / 111195, lng: -7.6, t: startT + i * 3000 }));

describe('current pace and speed', () => {
  it('reads the last minute of the running stretch', () => {
    const route = walkRoute(21, 1.4); // 60 s at 1.4 m/s
    const v = currentSpeedMps(route, route[20].t)!;
    expect(v).toBeGreaterThan(1.35);
    expect(v).toBeLessThan(1.45);
    expect(paceFromSpeed(v)).toBe(Math.round(1000 / v)); // ≈ 11'54" /km
    expect(kmh(5)).toBe(18);
  });

  it('shows nothing when the last fix is stale, the window too short, or the phone stands still', () => {
    const route = walkRoute(21, 1.4);
    expect(currentSpeedMps(route, route[20].t + 31_000)).toBeNull(); // no fix for 31 s
    expect(currentSpeedMps(route.slice(0, 4), route[3].t)).toBeNull(); // 9 s only
    expect(paceFromSpeed(0.3)).toBeNull();
  });

  it('never measures across a gap or a pause', () => {
    const before = walkRoute(10, 3);
    const after = walkRoute(4, 1, before[9].t + 3000).map((p, i) => (i === 0 ? { ...p, start: true } : p));
    // Only the 9 s after the restart are in the window: too short to show.
    expect(currentSpeedMps([...before, ...after], after[3].t)).toBeNull();
  });
});

describe('GPS noise', () => {
  const p = (lat: number, t: number, accuracy: number | null = 5) => ({ latitude: lat, longitude: -7.6, accuracy, timestamp: t });
  it('drops inaccurate fixes, standing-still jitter and jumps; a hike follows walking limits', () => {
    expect(evaluatePoint(p(33.5, T), p(33.5001, T + 3000, 65), 'walk')).toMatchObject({ use: false, reason: 'inaccurate' });
    expect(evaluatePoint(p(33.5, T), p(33.50001, T + 3000), 'walk')).toMatchObject({ use: false, reason: 'jitter' }); // 1 m
    expect(evaluatePoint(p(33.5, T), p(33.501, T + 3000), 'walk')).toMatchObject({ use: false, reason: 'too_fast' }); // 111 m in 3 s
    expect(evaluatePoint(p(33.5, T), p(33.5001, T + 3000), 'walk')).toMatchObject({ use: true }); // 11 m in 3 s
    expect(evaluatePoint(p(33.5, T), p(33.5001, T + 45_000), 'walk')).toMatchObject({ use: false, gap: true });
  });
});

describe('battery-aware sampling', () => {
  it('asks less often and less precisely on foot than on a bike, and nothing for the gym', () => {
    expect(samplingFor('walk')).toEqual({ accuracy: 'high', timeIntervalMs: 3000, distanceIntervalM: 5 });
    expect(samplingFor('run').accuracy).toBe('best');
    expect(samplingFor('cycle')).toEqual({ accuracy: 'best', timeIntervalMs: 2000, distanceIntervalM: 10 });
    expect(startSession('gym', 'g', 'Africa/Casablanca', new Date(T), true).gps.enabled).toBe(false);
  });

  it('starts background updates with the kind’s sampling and a truthful notification', async () => {
    mockLoc.start.mockResolvedValue(undefined);
    await startBackgroundGps('s1', 'walk');
    expect(mockLoc.start).toHaveBeenCalledWith(
      'loption-workout-gps',
      expect.objectContaining({
        accuracy: 4,
        timeInterval: 3000,
        distanceInterval: 5,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: expect.objectContaining({ notificationTitle: 'Votre activité est en cours', killServiceOnDestroy: true }),
      })
    );
  });
});

describe('calorie preview mirrors the server', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261030120000_v1_activity_tracking.sql'), 'utf8');
  const standalone = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261103120000_v1_standalone_tracking.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('create function public.activity_met('), sql.indexOf('revoke all on function public.activity_met('));
  const branch = (kind: string) => {
    const start = fn.indexOf(`when '${kind}' then`);
    const rest = fn.slice(start + 1);
    const next = rest.search(/\n\s+when '/);
    return fn.slice(start, next < 0 ? undefined : start + 1 + next);
  };

  it.each(['walk', 'run', 'cycle'] as const)('%s tiers equal public.activity_met', (kind) => {
    const text = branch(kind);
    const t = MET_TIERS[kind];
    expect(text).toContain(`p_speed_mps is null then ${t.unknown.toFixed(1)}`);
    for (const [below, met] of t.tiers) expect(text).toContain(`p_speed_mps < ${below} then ${met.toFixed(1)}`);
    expect(text).toContain(`else ${t.top.toFixed(1)} end`);
    expect((text.match(/p_speed_mps </g) ?? []).length).toBe(t.tiers.length);
  });

  it('gym values equal public.activity_gym_met', () => {
    expect(standalone).toContain(
      `when 'light' then ${GYM_MET.light.toFixed(1)} when 'moderate' then ${GYM_MET.moderate.toFixed(1)} when 'vigorous' then ${GYM_MET.vigorous.toFixed(1)}`
    );
    expect(fn).toContain("when 'gym' then 3.5");
  });

  it('gives the server’s worked example and never guesses without a weight', () => {
    // SQL W01: a 30-minute walk, 70 kg, no distance: (3.5 - 1) x 70 x 0.5 h = 88.
    expect(previewKcal({ kind: 'walk', activeSeconds: 1800, distanceM: null, weightKg: 70 })).toBe(88);
    // SQL W04: vigorous gym, 60 kg, 30 min: (6 - 1) x 60 x 0.5 = 150.
    expect(previewKcal({ kind: 'gym', activeSeconds: 1800, distanceM: null, weightKg: 60, intensity: 'vigorous' })).toBe(150);
    expect(metFor('run', 2.5)).toBe(9.8);
    expect(metFor('walk', 0.5)).toBe(2.0);
    // Under 100 m the speed is not used (MET 3.5), as on the server.
    expect(previewKcal({ kind: 'walk', activeSeconds: 600, distanceM: 50, weightKg: 70 })).toBe(Math.round((2.5 * 70 * 600) / 3600));
    expect(previewKcal({ kind: 'run', activeSeconds: 600, distanceM: 2000, weightKg: null })).toBeNull();
  });
});

describe('fix buffer', () => {
  const loc = (t: number) => ({ coords: { latitude: 33.5, longitude: -7.6, accuracy: 5 }, timestamp: t }) as any;
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockLoc.start.mockResolvedValue(undefined);
  });

  it('loses and doubles nothing when the task writes while the app drains', async () => {
    await startBackgroundGps('s1');
    await handleTaskBatch([loc(1000)], null);
    const draining = drainFixes('s1');
    await handleTaskBatch([loc(2000)], null); // arrives during the drain
    const first = await draining;
    const second = await drainFixes('s1');
    const all = [...first, ...second].map((f) => f.timestamp).sort();
    expect(all).toEqual([1000, 2000]);
  });

  it('reports the newest real fix without draining it', async () => {
    await startBackgroundGps('s1');
    await handleTaskBatch([loc(5000), loc(7000)], null);
    await handleTaskBatch(undefined, new Error('no fix'));
    expect(await lastBufferedFixAt('s1')).toBe(7000);
    expect(await drainFixes('s1')).toHaveLength(3);
  });

  it('reads the single-list buffer of an older app version once', async () => {
    await AsyncStorage.setItem('loption-gps-buffer', JSON.stringify([{ session: 's1', latitude: 1, longitude: 1, accuracy: 5, timestamp: 9 }]));
    expect((await drainFixes('s1')).map((f) => f.timestamp)).toEqual([9]);
    expect(await drainFixes('s1')).toEqual([]);
  });
});

describe('restore after the system closed the app', () => {
  it('pauses at the last heartbeat, or at a later recorded fix, never in the future', () => {
    const s = { ...startSession('run', 'r', 'Africa/Casablanca', new Date(T), true), lastSeenAt: new Date(T + 60_000).toISOString() };
    expect(restoreAfterLaunch(s).segments[0].end).toBe(new Date(T + 60_000).toISOString());
    expect(restoreAfterLaunch(s, T + 300_000, T + 900_000).segments[0].end).toBe(new Date(T + 300_000).toISOString());
    expect(restoreAfterLaunch(s, T + 30_000, T + 900_000).segments[0].end).toBe(new Date(T + 60_000).toISOString());
    expect(restoreAfterLaunch(s, T + 5_000_000, T + 900_000).segments[0].end).toBe(new Date(T + 900_000).toISOString());
    expect(restoreAfterLaunch(s).interrupted).toBe(true);
  });
});
