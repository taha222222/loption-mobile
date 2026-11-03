// The on-device buffer between the GPS background task and the workout
// store. expo-location is mocked: whether the OS delivers fixes with the
// screen off is a device test (docs/v1/ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { drainFixes, handleTaskBatch, startBackgroundGps, stopBackgroundGps } from '../src/activity/backgroundGps';

const mockLoc = { start: jest.fn(), stop: jest.fn(), started: jest.fn() };
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  startLocationUpdatesAsync: (...a: any[]) => mockLoc.start(...a),
  stopLocationUpdatesAsync: (...a: any[]) => mockLoc.stop(...a),
  hasStartedLocationUpdatesAsync: (...a: any[]) => mockLoc.started(...a),
  getForegroundPermissionsAsync: async () => ({ granted: true }),
}));

const loc = (t: number) => ({ coords: { latitude: 33.5, longitude: -7.6, accuracy: 5 }, timestamp: t }) as any;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLoc.start.mockResolvedValue(undefined);
  mockLoc.started.mockResolvedValue(true);
});

it('keeps fixes only for the active session, oldest first', async () => {
  await startBackgroundGps('s1');
  expect(mockLoc.start).toHaveBeenCalledWith(
    'loption-workout-gps',
    expect.objectContaining({ foregroundService: expect.objectContaining({ notificationTitle: 'Séance en cours' }) })
  );
  await handleTaskBatch([loc(2000), loc(1000)], null);
  const fixes = await drainFixes('s1');
  expect(fixes.map((f) => f.timestamp)).toEqual([1000, 2000]);
  expect(await drainFixes('s1')).toEqual([]); // drained once
});

it('drops fixes that arrive with no active session (after finish or discard)', async () => {
  await startBackgroundGps('s1');
  await stopBackgroundGps();
  expect(mockLoc.stop).toHaveBeenCalled();
  await handleTaskBatch([loc(3000)], null);
  expect(await drainFixes('s1')).toEqual([]);
});

it('never returns another session’s fixes', async () => {
  await startBackgroundGps('old');
  await handleTaskBatch([loc(1000)], null);
  await startBackgroundGps('new');
  expect(await drainFixes('new')).toEqual([]);
});

it('records a task error as a gap marker', async () => {
  await startBackgroundGps('s1');
  await handleTaskBatch(undefined, new Error('location unavailable'));
  const [f] = await drainFixes('s1');
  expect(f.error).toBe(true);
});

it('reports failure when background updates cannot start (Expo Go)', async () => {
  mockLoc.start.mockRejectedValue(new Error('not supported'));
  await expect(startBackgroundGps('s1')).resolves.toBe(false);
  await handleTaskBatch([loc(1)], null);
  expect(await drainFixes('s1')).toEqual([]);
});
