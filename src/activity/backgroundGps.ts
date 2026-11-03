// src/activity/backgroundGps.ts
// GPS for one outdoor workout the customer started, including while the
// screen is off or another app is open:
//   iOS      location updates continue in the background for a session
//            started on screen ("while using the app" permission, blue
//            indicator shown); requires the build's location background mode.
//   Android  a foreground service with a visible notification
//            ("Séance en cours"), started on screen; no background-location
//            permission is needed.
// Fixes are written to a small on-device buffer tagged with the session id;
// the workout store drains it (screen open: every few seconds; otherwise
// when the app comes back). Updates stop on pause, finish and discard, and
// any fix that arrives for another (or no) session is dropped, so nothing
// is ever recorded outside an active session. Without the native task
// support (Expo Go, web) the caller falls back to on-screen updates only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { GeoPoint } from './gps';

export const WORKOUT_GPS_TASK = 'loption-workout-gps';
const SESSION_KEY = 'loption-gps-session';
const BUFFER_KEY = 'loption-gps-buffer';
const MAX_BUFFER = 5000;

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

async function append(fixes: BufferedFix[]) {
  const raw = await AsyncStorage.getItem(BUFFER_KEY);
  let list: BufferedFix[] = [];
  try {
    list = raw ? JSON.parse(raw) : [];
  } catch {
    list = [];
  }
  await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify([...list, ...fixes].slice(-MAX_BUFFER)));
}

// Returns (and removes) the buffered fixes of `session`, oldest first. An
// error marker comes back with `error: true` (a gap).
export async function drainFixes(session: string): Promise<BufferedFix[]> {
  const raw = await AsyncStorage.getItem(BUFFER_KEY);
  if (!raw) return [];
  await AsyncStorage.removeItem(BUFFER_KEY);
  try {
    return (JSON.parse(raw) as BufferedFix[]).filter((f) => f.session === session).sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

export async function startBackgroundGps(session: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, session);
    await Location.startLocationUpdatesAsync(WORKOUT_GPS_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 3000,
      distanceInterval: 5,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Séance en cours',
        notificationBody: 'L’OPTION mesure la distance de votre séance.',
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
