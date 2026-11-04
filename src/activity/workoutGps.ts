// src/activity/workoutGps.ts
// Location updates for one running workout, in the foreground only, after
// the customer chose GPS for that session (fallback when background updates
// are unavailable, e.g. Expo Go): when the app leaves the screen the
// subscription stops and the gap is not bridged. Also the position shown
// on the map before Start (`watchPreviewLocation`), which records nothing.
import * as Location from 'expo-location';
import { samplingFor, type GeoPoint } from './gps';
import type { WorkoutKind } from './types';

export type GpsPermission = 'granted' | 'denied' | 'undetermined';

// Current state without asking: 'undetermined' = the system prompt can still
// be shown; 'denied' = only the phone's settings can change it.
export async function workoutGpsStatus(): Promise<GpsPermission> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

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

export async function watchWorkoutLocation(onPoint: (p: GeoPoint) => void, kind: WorkoutKind = 'walk'): Promise<() => void> {
  const sampling = samplingFor(kind);
  const sub = await Location.watchPositionAsync(
    {
      accuracy: sampling.accuracy === 'best' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
      timeInterval: sampling.timeIntervalMs,
      distanceInterval: sampling.distanceIntervalM,
    },
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

// Position on the map before the session starts ("Recherche de votre
// position…" → "Prêt"). Nothing is stored or uploaded; stops when the
// screen leaves the pre-start step or the session starts.
export async function watchPreviewLocation(onPoint: (p: GeoPoint) => void): Promise<() => void> {
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 }, (loc) =>
    onPoint({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? null,
      timestamp: loc.timestamp,
    })
  );
  return () => sub.remove();
}
