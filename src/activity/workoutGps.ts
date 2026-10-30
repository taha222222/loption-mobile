// src/activity/workoutGps.ts
// Location updates for one running workout, in the foreground only, after
// the customer chose GPS for that session. Nothing is collected outside an
// active session, and nothing runs in the background: when the app leaves
// the screen the subscription stops and the gap is not bridged.
import * as Location from 'expo-location';
import type { GeoPoint } from './gps';

export type GpsPermission = 'granted' | 'denied' | 'undetermined';

export async function requestWorkoutGps(): Promise<GpsPermission> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'denied';
    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function watchWorkoutLocation(onPoint: (p: GeoPoint) => void): Promise<() => void> {
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
    (loc) =>
      onPoint({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
        timestamp: loc.timestamp,
      })
  );
  return () => sub.remove();
}
