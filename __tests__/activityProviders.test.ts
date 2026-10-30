// Health providers, local day bounds and sync. Native health modules are
// mocked: these tests prove the mapping and error handling, not that
// HealthKit or Health Connect behave this way on a device (see
// docs/v1/ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md, device testing).
import { Platform } from 'react-native';
import { dayWindow, recentDayWindows, startOfLocalDay } from '../src/activity/dayBounds';
import { healthKitProvider, __resetHealthKitModule } from '../src/activity/providers/healthKit';
import { healthConnectProvider, __resetHealthConnectModule } from '../src/activity/providers/healthConnect';
import { deviceMotionProvider, __resetPedometerModule } from '../src/activity/providers/deviceMotion';
import { providersForPlatform } from '../src/activity/providers';
import { isTransient, syncActivity, withRetry } from '../src/activity/sync';
import { toDayRows } from '../src/services/activityApi';
import type { ActivityProvider } from '../src/activity/types';

const mockHk = {
  isHealthDataAvailableAsync: jest.fn(),
  getRequestStatusForAuthorization: jest.fn(),
  requestAuthorization: jest.fn(),
  queryStatisticsForQuantity: jest.fn(),
  queryWorkoutSamples: jest.fn(),
};
const mockHc = {
  getSdkStatus: jest.fn(),
  initialize: jest.fn(),
  getGrantedPermissions: jest.fn(),
  requestPermission: jest.fn(),
  aggregateRecord: jest.fn(),
  readRecords: jest.fn(),
  openHealthConnectSettings: jest.fn(),
};
const mockPedometer = {
  isAvailableAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getStepCountAsync: jest.fn(),
};
jest.mock('@kingstinct/react-native-healthkit', () => mockHk);
jest.mock('react-native-health-connect', () => mockHc);
jest.mock('expo-sensors', () => ({ Pedometer: mockPedometer }));

const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });

beforeEach(() => {
  jest.clearAllMocks();
  __resetHealthKitModule();
  __resetHealthConnectModule();
  __resetPedometerModule();
  setOS('ios');
});

describe('local day bounds', () => {
  it('starts a Casablanca day at local midnight', () => {
    expect(startOfLocalDay('2026-10-29', 'Africa/Casablanca').toISOString()).toBe('2026-10-28T23:00:00.000Z');
  });
  it('handles 23- and 25-hour days at DST changes', () => {
    const spring = dayWindow('2026-03-29', 'Europe/Paris');
    const autumn = dayWindow('2026-10-25', 'Europe/Paris');
    expect((spring.end.getTime() - spring.start.getTime()) / 3600000).toBe(23);
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3600000).toBe(25);
  });
  it('uses the calendar of far-ahead and far-behind zones', () => {
    expect(startOfLocalDay('2026-10-29', 'Pacific/Kiritimati').toISOString()).toBe('2026-10-28T10:00:00.000Z');
    expect(startOfLocalDay('2026-10-29', 'Pacific/Pago_Pago').toISOString()).toBe('2026-10-29T11:00:00.000Z');
  });
  it('lists the last N days oldest first, contiguous', () => {
    const w = recentDayWindows('2026-10-29', 'Africa/Casablanca', 7);
    expect(w.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
    for (let i = 1; i < w.length; i++) expect(w[i].start.getTime()).toBe(w[i - 1].end.getTime());
  });
});

describe('platform providers', () => {
  it('offers Apple Health then the motion sensor on iOS, Health Connect on Android, nothing on web', () => {
    expect(providersForPlatform('ios').map((p) => p.id)).toEqual(['apple_health', 'device_motion']);
    expect(providersForPlatform('android').map((p) => p.id)).toEqual(['health_connect']);
    expect(providersForPlatform('web')).toEqual([]);
  });
});

describe('Apple Health', () => {
  const past = dayWindow('2026-10-28', 'Africa/Casablanca');
  const today = { date: '2099-01-01', start: new Date('2099-01-01T00:00:00Z'), end: new Date('2099-01-02T00:00:00Z') };

  it('reports a missing native module as needing a development build (Expo Go)', async () => {
    let fresh: typeof healthKitProvider;
    jest.isolateModules(() => {
      jest.doMock('@kingstinct/react-native-healthkit', () => {
        throw new Error('NitroModules are not available in Expo Go');
      });
      fresh = require('../src/activity/providers/healthKit').healthKitProvider;
    });
    await expect(fresh!.availability()).resolves.toBe('needs_native_build');
    jest.doMock('@kingstinct/react-native-healthkit', () => mockHk);
  });

  it('is unsupported on Android and where HealthKit is unavailable (iPad)', async () => {
    setOS('android');
    await expect(healthKitProvider.availability()).resolves.toBe('unsupported');
    setOS('ios');
    __resetHealthKitModule();
    mockHk.isHealthDataAvailableAsync.mockResolvedValue(false);
    await expect(healthKitProvider.availability()).resolves.toBe('unsupported');
  });

  it('asks for read access only, and never claims it was granted', async () => {
    mockHk.requestAuthorization.mockResolvedValue(true);
    await expect(healthKitProvider.requestPermission()).resolves.toBe('requested');
    expect(mockHk.requestAuthorization).toHaveBeenCalledWith({ toRead: expect.any(Array) });
    expect(mockHk.requestAuthorization.mock.calls[0][0].toShare).toBeUndefined();
    mockHk.getRequestStatusForAuthorization.mockResolvedValue(1);
    await expect(healthKitProvider.permission()).resolves.toBe('not_requested');
    mockHk.getRequestStatusForAuthorization.mockResolvedValue(2);
    await expect(healthKitProvider.permission()).resolves.toBe('requested');
  });

  it('maps daily statistics; no samples is null (not 0); total only for a finished day with basal data', async () => {
    mockHk.queryStatisticsForQuantity.mockImplementation(async (id: string) => {
      const v: Record<string, number | undefined> = {
        HKQuantityTypeIdentifierStepCount: 8123.4,
        HKQuantityTypeIdentifierDistanceWalkingRunning: 6012.6,
        HKQuantityTypeIdentifierActiveEnergyBurned: 402.2,
        HKQuantityTypeIdentifierBasalEnergyBurned: 1700.1,
      };
      return v[id] === undefined ? { sources: [] } : { sumQuantity: { quantity: v[id], unit: 'x' }, sources: [] };
    });
    const [day, live] = await healthKitProvider.readDays([past, today]);
    expect(day).toEqual({ date: '2026-10-28', steps: 8123, distanceM: 6013, activeKcal: 402, totalKcal: 2102 });
    expect(live.totalKcal).toBeNull();

    mockHk.queryStatisticsForQuantity.mockResolvedValue({ sources: [] });
    const [empty] = await healthKitProvider.readDays([past]);
    expect(empty).toEqual({ date: '2026-10-28', steps: null, distanceM: null, activeKcal: null, totalKcal: null });
  });

  it('imports only walking, running, cycling and strength workouts, with provider units converted', async () => {
    const dispose = jest.fn();
    mockHk.queryWorkoutSamples.mockResolvedValue([
      {
        toJSON: () => ({
          uuid: 'mockHk-1',
          workoutActivityType: 37,
          startDate: '2026-10-28T07:00:00Z',
          endDate: '2026-10-28T07:40:00Z',
          duration: { quantity: 2280, unit: 's' },
          totalDistance: { quantity: 6.2, unit: 'km' },
          totalEnergyBurned: { quantity: 410, unit: 'kcal' },
        }),
        dispose,
      },
      { toJSON: () => ({ uuid: 'mockHk-2', workoutActivityType: 46, startDate: '2026-10-28T09:00:00Z', endDate: '2026-10-28T10:00:00Z' }), dispose },
      { toJSON: () => ({ uuid: 'mockHk-3', workoutActivityType: 50, startDate: '2026-10-28T18:00:00Z', endDate: '2026-10-28T18:45:00Z' }), dispose },
    ]);
    const w = await healthKitProvider.readWorkouts!(past.start, past.end);
    expect(w).toEqual([
      { externalId: 'mockHk-1', kind: 'run', startedAt: '2026-10-28T07:00:00.000Z', endedAt: '2026-10-28T07:40:00.000Z', activeSeconds: 2280, distanceM: 6200, energyKcal: 410 },
      { externalId: 'mockHk-3', kind: 'gym', startedAt: '2026-10-28T18:00:00.000Z', endedAt: '2026-10-28T18:45:00.000Z', activeSeconds: 2700, distanceM: null, energyKcal: null },
    ]);
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});

describe('Health Connect', () => {
  const past = dayWindow('2026-10-28', 'Africa/Casablanca');
  beforeEach(() => {
    setOS('android');
    mockHc.initialize.mockResolvedValue(true);
  });

  it('maps the SDK status to install / update / available', async () => {
    mockHc.getSdkStatus.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    await expect(healthConnectProvider.availability()).resolves.toBe('needs_install');
    await expect(healthConnectProvider.availability()).resolves.toBe('needs_update');
    await expect(healthConnectProvider.availability()).resolves.toBe('available');
  });

  it('distinguishes granted, partial and refused read permissions', async () => {
    const all = ['Steps', 'Distance', 'ActiveCaloriesBurned', 'TotalCaloriesBurned', 'ExerciseSession'].map((recordType) => ({ accessType: 'read', recordType }));
    mockHc.getGrantedPermissions.mockResolvedValueOnce(all).mockResolvedValueOnce(all.slice(0, 2)).mockResolvedValueOnce([]);
    await expect(healthConnectProvider.permission()).resolves.toBe('granted');
    await expect(healthConnectProvider.permission()).resolves.toBe('partial');
    await expect(healthConnectProvider.permission()).resolves.toBe('not_requested');
    mockHc.requestPermission.mockResolvedValue([]);
    await expect(healthConnectProvider.requestPermission()).resolves.toBe('denied');
    expect(mockHc.requestPermission.mock.calls[0][0].every((p: any) => p.accessType === 'read')).toBe(true);
  });

  it('reports an aggregate without data origin as null and a measured zero as 0', async () => {
    mockHc.aggregateRecord.mockImplementation(async ({ recordType }: any) => {
      if (recordType === 'Steps') return { COUNT_TOTAL: 0, dataOrigins: ['com.google.android.apps.fitness'] };
      if (recordType === 'Distance') return { DISTANCE: { inMeters: 0 }, dataOrigins: [] };
      if (recordType === 'ActiveCaloriesBurned') return { ACTIVE_CALORIES_TOTAL: { inKilocalories: 251.6 }, dataOrigins: ['x'] };
      return { ENERGY_TOTAL: { inKilocalories: 2310.2 }, dataOrigins: ['x'] };
    });
    const [day] = await healthConnectProvider.readDays([past]);
    expect(day).toEqual({ date: '2026-10-28', steps: 0, distanceM: null, activeKcal: 252, totalKcal: 2310 });
  });

  it('maps exercise sessions with their own app’s distance and energy, skipping other exercise types', async () => {
    mockHc.readRecords.mockResolvedValue({
      records: [
        { exerciseType: 8, startTime: '2026-10-28T16:00:00Z', endTime: '2026-10-28T17:00:00Z', metadata: { id: 'mockHc-1', dataOrigin: 'com.strava' } },
        { exerciseType: 73, startTime: '2026-10-28T06:00:00Z', endTime: '2026-10-28T06:30:00Z', metadata: { id: 'mockHc-2' } },
      ],
    });
    mockHc.aggregateRecord.mockImplementation(async ({ recordType }: any) =>
      recordType === 'Distance' ? { DISTANCE: { inMeters: 18250 }, dataOrigins: ['com.strava'] } : { ACTIVE_CALORIES_TOTAL: { inKilocalories: 520 }, dataOrigins: ['com.strava'] }
    );
    const w = await healthConnectProvider.readWorkouts!(past.start, past.end);
    expect(w).toEqual([
      { externalId: 'mockHc-1', kind: 'cycle', startedAt: '2026-10-28T16:00:00.000Z', endedAt: '2026-10-28T17:00:00.000Z', activeSeconds: 3600, distanceM: 18250, energyKcal: 520 },
    ]);
    expect(mockHc.aggregateRecord).toHaveBeenCalledWith(expect.objectContaining({ dataOriginFilter: ['com.strava'] }));
  });
});

describe('iPhone motion sensor', () => {
  it('reports steps only', async () => {
    mockPedometer.getStepCountAsync.mockResolvedValue({ steps: 4321 });
    const [day] = await deviceMotionProvider.readDays([dayWindow('2026-10-28', 'Africa/Casablanca')]);
    expect(day).toEqual({ date: '2026-10-28', steps: 4321, distanceM: null, activeKcal: null, totalKcal: null });
    expect(toDayRows([{ ...day, distanceM: 10, activeKcal: 5, totalKcal: 9 }], 'device_motion', 'Africa/Casablanca')[0]).toMatchObject({
      distance_m: null,
      active_energy_kcal: null,
      total_energy_kcal: null,
    });
  });
  it('treats a refused motion permission as denied', async () => {
    mockPedometer.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    await expect(deviceMotionProvider.requestPermission()).resolves.toBe('denied');
  });
});

describe('sync', () => {
  const provider: ActivityProvider = {
    id: 'apple_health',
    availability: async () => 'available',
    permission: async () => 'requested',
    requestPermission: async () => 'requested',
    readDays: jest.fn(async (days) => days.map((d) => ({ date: d.date, steps: 100, distanceM: null, activeKcal: null, totalKcal: null }))),
  };
  const noSleep = jest.fn(async () => {});

  it('classifies server answers as final and transport failures as transient', () => {
    expect(isTransient({ code: '22023', message: 'x' })).toBe(false);
    expect(isTransient({ code: 'PGRST301' })).toBe(false);
    expect(isTransient({ message: 'TypeError: Network request failed' })).toBe(true);
    expect(isTransient(null)).toBe(false);
  });

  it('retries network failures with backoff and succeeds without duplicating days', async () => {
    const upsertDays = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })
      .mockResolvedValueOnce({ data: true, error: null });
    const out = await syncActivity({ provider, timeZone: 'Africa/Casablanca', today: '2026-10-29', upsertDays, sleep: noSleep });
    expect(out).toMatchObject({ status: 'ok', days: 7, withData: 7 });
    expect(upsertDays).toHaveBeenCalledTimes(2);
    expect(upsertDays.mock.calls[0][0]).toEqual(upsertDays.mock.calls[1][0]); // same rows, same keys
    expect(noSleep).toHaveBeenCalledWith(1000);
  });

  it('does not retry a refusal by the server', async () => {
    const upsertDays = jest.fn().mockResolvedValue({ data: null, error: { code: '22023', message: 'unknown time zone' } });
    const out = await syncActivity({ provider, timeZone: 'Africa/Casablanca', today: '2026-10-29', upsertDays, sleep: noSleep });
    expect(out).toMatchObject({ status: 'rejected' });
    expect(upsertDays).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt and reports a network error', async () => {
    const upsertDays = jest.fn().mockResolvedValue({ data: null, error: { message: 'offline' } });
    const out = await syncActivity({ provider, timeZone: 'Africa/Casablanca', today: '2026-10-29', upsertDays, sleep: noSleep, maxAttempts: 3 });
    expect(out.status).toBe('network_error');
    expect(upsertDays).toHaveBeenCalledTimes(3);
  });

  it('reports a provider failure (e.g. access revoked mid-read) without sending anything', async () => {
    const failing = { ...provider, readDays: async () => { throw new Error('Authorization not determined'); } };
    const upsertDays = jest.fn();
    const out = await syncActivity({ provider: failing, timeZone: 'Africa/Casablanca', today: '2026-10-29', upsertDays });
    expect(out).toMatchObject({ status: 'provider_error' });
    expect(upsertDays).not.toHaveBeenCalled();
  });

  it('withRetry turns a thrown call into an error result', async () => {
    const r = await withRetry(async () => { throw new Error('boom'); }, { maxAttempts: 1 });
    expect(r.error?.message).toBe('boom');
  });
});
