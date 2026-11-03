// Production hardening: revoked motion access, measured Android reading
// behaviour, phone history never crossing accounts, offline and
// interrupted states. Native modules are mocked; device behaviour is in the
// device procedures of docs/v1/STANDALONE_TRACKING.md.
import React from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import { readingStats, type CounterSnapshot } from '../src/activity/stepCounter';
import { historyStartFor } from '../src/activity/motionOwner';
import { syncActivity } from '../src/activity/sync';
import { PermissionRevokedError, type ActivityProvider } from '../src/activity/types';
import { deviceMotionProvider } from '../src/activity/providers/deviceMotion';
import { dayWindow } from '../src/activity/dayBounds';
import { ActivityOverview } from '../src/components/tracking/ActivityOverview';
import { toDailyBalances } from '../src/activity/dailyBalance';
import { useActivityStore } from '../src/stores/activityStore';

const mockMotion: { module: any } = { module: null };
jest.mock('../src/activity/motionNative', () => ({ motion: () => mockMotion.module }));
jest.mock('../src/services/activityApi', () => ({
  ...jest.requireActual('../src/services/activityApi'),
  upsertActivityDays: jest.fn(async () => ({ data: true, error: null })),
}));
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
const t = (iso: string) => new Date(iso).getTime();

beforeEach(async () => {
  mockMotion.module = null;
  setOS('ios');
  await AsyncStorage.clear();
  useActivityStore.setState({ ownerId: null, source: null, lastSync: null, historyFrom: null, permission: null, diagnostics: null });
});

describe('measured Android reading behaviour', () => {
  it('reports what really happened over 24 h, not the 15-minute schedule', () => {
    const now = t('2026-11-03T12:00:00Z');
    const snap = (iso: string, origin: string): CounterSnapshot => ({ value: 1, wallTimeMs: t(iso), bootCount: 1, elapsedMs: 0, origin });
    const s = readingStats(
      [snap('2026-11-02T08:00:00Z', 'background'), snap('2026-11-03T08:00:00Z', 'background'), snap('2026-11-03T08:16:00Z', 'background'),
        snap('2026-11-03T10:30:00Z', 'background'), snap('2026-11-03T10:45:00Z', 'foreground')],
      now
    );
    expect(s).toEqual({ lastAt: t('2026-11-03T10:45:00Z'), readings24h: 4, background24h: 3, medianGapMin: 16, maxGapMin: 134 });
    expect(readingStats([], now)).toEqual({ lastAt: null, readings24h: 0, background24h: 0, medianGapMin: null, maxGapMin: null });
  });

  it('warns when the latest Android reading is old, and when access was withdrawn', async () => {
    const day = toDailyBalances(
      [{ local_date: '2026-11-03', activity_source: 'device_motion', steps: 4200, has_meal_log: false, synced_at: new Date().toISOString() }],
      '2026-11-03', '2026-11-03'
    )[0];
    await render(
      <ActivityOverview day={day} state="partial" isToday connected permissionDenied diagnostics={{ lastAt: t('2026-11-03T08:00:00Z'), readings24h: 3, background24h: 3, medianGapMin: 20, maxGapMin: 90 }}
        now={new Date('2026-11-03T11:00:00Z')} lastSuccessAt={null} syncing={false} onConnect={() => {}} onSync={() => {}} onStartWalk={() => {}} />
    );
    expect(screen.getByText(/Accès au mouvement retiré/)).toBeTruthy();
    expect(screen.getByText(/Dernière lecture du capteur à .* Android peut retarder les lectures/)).toBeTruthy();
    expect(screen.getByLabelText(/Pas : 4\s200/)).toBeTruthy(); // real data still shown, not hidden or zeroed
  });
});

describe('revoked iPhone motion access', () => {
  it('a query refused by Core Motion is reported as permission denied, not a read error', async () => {
    mockMotion.module = {
      capabilities: () => ({ platform: 'ios', stepCounting: true }),
      authorizationStatus: () => 'denied',
      queryAsync: jest.fn().mockRejectedValue(Object.assign(new Error('not authorized'), { code: 'E_MOTION_DENIED' })),
    };
    await expect(deviceMotionProvider.readDays([dayWindow('2026-11-02', 'Africa/Casablanca')])).rejects.toBeInstanceOf(PermissionRevokedError);
  });

  it('the store marks the permission denied after such a sync', async () => {
    mockMotion.module = {
      capabilities: () => ({ platform: 'ios', stepCounting: true }),
      authorizationStatus: () => 'denied',
      queryAsync: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'E_MOTION_DENIED' })),
    };
    useActivityStore.setState({ ownerId: 'u1', source: 'device_motion', permission: 'granted' });
    const outcome = await useActivityStore.getState().sync({ force: true });
    expect(outcome?.status).toBe('provider_error');
    expect(useActivityStore.getState().permission).toBe('denied');
  });
});

describe('phone history never crosses accounts', () => {
  it('the first account on the phone gets the device history; another account only from now', () => {
    const now = new Date('2026-11-03T10:00:00Z');
    expect(historyStartFor(null, 'a', now)).toBeNull();
    expect(historyStartFor('a', 'a', now)).toBeNull();
    expect(historyStartFor('a', 'b', now)).toBe('2026-11-03T10:00:00.000Z');
  });

  it('sync does not read before notBefore', async () => {
    const readDays = jest.fn(async (w: any[]) => w.map((x) => ({ date: x.date, steps: 1, distanceM: null, activeKcal: null, totalKcal: null })));
    const provider = { id: 'device_motion', availability: async () => 'available', permission: async () => 'granted', requestPermission: async () => 'granted', readDays } as unknown as ActivityProvider;
    await syncActivity({
      provider, timeZone: 'Africa/Casablanca', today: '2026-11-03', upsertDays: async () => ({ data: true, error: null }),
      notBefore: '2026-11-03T09:00:00.000Z',
    });
    const windows = readDays.mock.calls[0][0];
    expect(windows.map((w: any) => w.date)).toEqual(['2026-11-03']); // earlier days are another account's
    expect(windows[0].start.toISOString()).toBe('2026-11-03T09:00:00.000Z');
  });

  it('enabling the counter for a second account wipes the previous readings on Android and limits history', async () => {
    setOS('android');
    mockMotion.module = {
      capabilities: () => ({ platform: 'android', stepCounting: true }),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      getPermissionsAsync: jest.fn(async () => ({ granted: true })),
      setBackgroundEnabledAsync: jest.fn(async () => true),
      recordSnapshotAsync: jest.fn(async () => null),
      clearSnapshotsAsync: jest.fn(async () => undefined),
      getSnapshotsAsync: jest.fn(async () => []),
    };
    await AsyncStorage.setItem('loption-motion-owner', 'previous-user');
    useActivityStore.setState({ ownerId: 'new-user' });
    await useActivityStore.getState().connect('device_motion');
    expect(mockMotion.module.clearSnapshotsAsync).toHaveBeenCalled();
    expect(useActivityStore.getState().historyFrom).not.toBeNull();
    expect(await AsyncStorage.getItem('loption-motion-owner')).toBe('new-user');
  });

  it('the same account reconnecting keeps its device history', async () => {
    setOS('android');
    mockMotion.module = {
      capabilities: () => ({ platform: 'android', stepCounting: true }),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      getPermissionsAsync: jest.fn(async () => ({ granted: true })),
      setBackgroundEnabledAsync: jest.fn(async () => true),
      recordSnapshotAsync: jest.fn(async () => null),
      clearSnapshotsAsync: jest.fn(async () => undefined),
      getSnapshotsAsync: jest.fn(async () => []),
    };
    await AsyncStorage.setItem('loption-motion-owner', 'u1');
    useActivityStore.setState({ ownerId: 'u1' });
    await useActivityStore.getState().connect('device_motion');
    expect(mockMotion.module.clearSnapshotsAsync).not.toHaveBeenCalled();
    expect(useActivityStore.getState().historyFrom).toBeNull();
  });

  it('signing out stops background readings of the phone sensor', () => {
    mockMotion.module = { setBackgroundEnabledAsync: jest.fn(async () => false) };
    useActivityStore.setState({ ownerId: 'u1', source: 'device_motion' });
    useActivityStore.getState().reset();
    expect(mockMotion.module.setBackgroundEnabledAsync).toHaveBeenCalledWith(false);
    expect(useActivityStore.getState().source).toBeNull();
  });
});
