// src/activity/backgroundGps.ts
// GPS for one outdoor workout the customer started, including while the
// screen is off or another app is open:
//   iOS      location updates continue in the background for a session
//            started on screen ("while using the app" permission, blue
//            indicator shown); requires the build's location background mode.
//   Android  a foreground service with a visible notification
//            ("Votre activité est en cours"), started on screen; no background-location
//            permission is needed.
// Fixes are written to a small on-device buffer tagged with the session id;
// the workout store drains it (screen open: every few seconds; otherwise
// when the app comes back). Updates stop on pause, finish and discard, and
// any fix that arrives for another (or no) session is dropped, so nothing
// is ever recorded outside an active session. Without the native task
// support (Expo Go, web) the caller falls back to on-screen updates only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { samplingFor, type GeoPoint } from './gps';
import type { WorkoutKind } from './types';

export const WORKOUT_GPS_TASK = 'loption-workout-gps';
const SESSION_KEY = 'loption-gps-session';
const BUFFER_KEY = 'loption-gps-buffer';

export interface BufferedFix extends GeoPoint {
  session: string;
  error?: boolean; // the task reported an error here: a gap, no position
}

// Called by the background task with a batch of locations (or an error).
export async function handleTaskBatch(locations: Location.LocationObject[] | undefined, error: unknown): Promise<void> {
  const session = await AsyncStorage.getItem(SESSION_KEY);
  if (!session) return; // no active session: drop
  if (error) {
    await append([{ session, latitude: 0, longitude: 0, accuracy: null, timestamp: Date.now(), error: true }]);
    return;
  }
  const fixes = (locations ?? []).map((l) => ({
    session,
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    timestamp: l.timestamp,
  }));
  if (fixes.length) await append(fixes);
}

// Each batch is written under its own key, so a drain running at the same
// moment as the task can never lose or double a batch (no read-modify-write
// of a shared list). Oldest batches go first past MAX_BATCHES.
const BATCH_PREFIX = `${BUFFER_KEY}:`;
const MAX_BATCHES = 2000;
let seq = 0;

async function append(fixes: BufferedFix[]) {
  seq = (seq + 1) % 1_000_000;
  const key = `${BATCH_PREFIX}${String(Date.now()).padStart(15, '0')}-${String(seq).padStart(6, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  await AsyncStorage.setItem(key, JSON.stringify(fixes));
  const keys = await batchKeys();
  if (keys.length > MAX_BATCHES) await AsyncStorage.multiRemove(keys.slice(0, keys.length - MAX_BATCHES));
}

async function batchKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(BATCH_PREFIX)).sort();
}

async function readBatches(keys: string[]): Promise<BufferedFix[]> {
  if (!keys.length) return [];
  const out: BufferedFix[] = [];
  for (const [, raw] of await AsyncStorage.multiGet(keys)) {
    try {
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) out.push(...list);
    } catch {
      /* a damaged batch is skipped */
    }
  }
  return out;
}

// Returns (and removes) the buffered fixes of `session`, oldest first. An
// error marker comes back with `error: true` (a gap). Only the batches read
// here are removed; one written meanwhile waits for the next drain.
export async function drainFixes(session: string): Promise<BufferedFix[]> {
  const keys = await batchKeys();
  const fixes = await readBatches(keys);
  const legacy = await AsyncStorage.getItem(BUFFER_KEY); // single list of an older app version
  if (legacy) {
    try {
      fixes.push(...(JSON.parse(legacy) as BufferedFix[]));
    } catch {
      /* ignored */
    }
    await AsyncStorage.removeItem(BUFFER_KEY);
  }
  if (keys.length) await AsyncStorage.multiRemove(keys);
  return fixes.filter((f) => f.session === session).sort((a, b) => a.timestamp - b.timestamp);
}

// Time of the newest real fix buffered for `session`, without draining:
// evidence that the session was still recording after the last heartbeat
// (used when the app restarts after the system closed it).
export async function lastBufferedFixAt(session: string): Promise<number | null> {
  const fixes = (await readBatches(await batchKeys())).filter((f) => f.session === session && !f.error);
  return fixes.length ? Math.max(...fixes.map((f) => f.timestamp)) : null;
}

export async function startBackgroundGps(session: string, kind: WorkoutKind = 'walk'): Promise<boolean> {
  const sampling = samplingFor(kind);
  try {
    await AsyncStorage.setItem(SESSION_KEY, session);
    await Location.startLocationUpdatesAsync(WORKOUT_GPS_TASK, {
      accuracy: sampling.accuracy === 'best' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
      timeInterval: sampling.timeIntervalMs,
      distanceInterval: sampling.distanceIntervalM,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Votre activité est en cours',
        notificationBody: 'L’OPTION enregistre votre parcours. Touchez pour revenir à la séance.',
        killServiceOnDestroy: true,
      },
    });
    return true;
  } catch {
    await AsyncStorage.removeItem(SESSION_KEY);
    return false;
  }
}

export async function stopBackgroundGps(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(WORKOUT_GPS_TASK)) {
      await Location.stopLocationUpdatesAsync(WORKOUT_GPS_TASK);
    }
  } catch {
    /* not started (Expo Go, web) */
  }
}

export async function gpsPermissionStillGranted(): Promise<boolean> {
  try {
    return (await Location.getForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
