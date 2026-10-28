// src/services/permissions.ts
// Customer-side notification and location permissions, requested only from
// the explanation screens after onboarding. Each request is made at most
// once per screen visit, and never when the operating system will not show
// a prompt again (canAskAgain = false); then the app points to Settings.
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Linking, Platform } from 'react-native';

export type PermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined';

function toState(response: { status: string; canAskAgain?: boolean; granted?: boolean }): PermissionState {
  if (response.granted || response.status === 'granted') return 'granted';
  if (response.status === 'undetermined') return 'undetermined';
  // Denied: blocked when the OS will not prompt again (iOS after one denial,
  // Android after "don't ask again" / two denials).
  return response.canAskAgain === false ? 'blocked' : 'denied';
}

// --- Notifications ---------------------------------------------------------
export async function getNotificationPermission(): Promise<PermissionState> {
  try {
    return toState(await Notifications.getPermissionsAsync());
  } catch {
    return 'denied';
  }
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  try {
    const current = toState(await Notifications.getPermissionsAsync());
    if (current === 'granted' || current === 'blocked') return current;
    if (Platform.OS === 'android') {
      // Android 13+ shows the prompt only once a channel exists.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Commandes et livraisons',
        importance: AndroidImportance.DEFAULT,
      });
    }
    return toState(await Notifications.requestPermissionsAsync());
  } catch {
    return 'denied';
  }
}

// --- Location --------------------------------------------------------------
export async function getLocationPermission(): Promise<PermissionState> {
  try {
    return toState(await Location.getForegroundPermissionsAsync());
  } catch {
    return 'denied';
  }
}

export async function requestLocationPermission(): Promise<PermissionState> {
  try {
    const current = toState(await Location.getForegroundPermissionsAsync());
    if (current === 'granted' || current === 'blocked') return current;
    return toState(await Location.requestForegroundPermissionsAsync());
  } catch {
    return 'denied';
  }
}

export type AddressSuggestion =
  | { kind: 'found'; address: string; latitude: number; longitude: number }
  | { kind: 'position_only'; latitude: number; longitude: number }
  | { kind: 'error' };

const POSITION_TIMEOUT_MS = 12000;

// Current position and a suggested street address. The suggestion is only
// a pre-fill: the customer must confirm or correct it before it is saved,
// and a granted permission alone never counts as a saved address.
export async function suggestDeliveryAddress(): Promise<AddressSuggestion> {
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS)),
    ]);
    if (!position) return { kind: 'error' };
    const { latitude, longitude } = position.coords;
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      const address = place ? formatPlace(place) : '';
      return address ? { kind: 'found', address, latitude, longitude } : { kind: 'position_only', latitude, longitude };
    } catch {
      return { kind: 'position_only', latitude, longitude };
    }
  } catch {
    return { kind: 'error' };
  }
}

export function formatPlace(place: Partial<Location.LocationGeocodedAddress>): string {
  const street = [place.streetNumber, place.street].filter(Boolean).join(' ');
  const parts = [street || place.name, place.district, place.city].filter(
    (part, index, all): part is string => !!part && all.indexOf(part) === index
  );
  return parts.join(', ');
}

export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
