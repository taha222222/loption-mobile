// src/activity/providers/index.ts
// Activity providers offered on this platform, in order of preference.
// Only one is connected at a time, so the same steps are never counted
// twice on the device; the server also uses one source per day.
import { Platform } from 'react-native';
import type { ActivityProvider, ActivitySource } from '../types';
import { deviceMotionProvider } from './deviceMotion';
import { healthConnectProvider } from './healthConnect';
import { healthKitProvider } from './healthKit';

export function providersForPlatform(os: string = Platform.OS): ActivityProvider[] {
  if (os === 'ios') return [healthKitProvider, deviceMotionProvider];
  if (os === 'android') return [healthConnectProvider];
  return [];
}

export function providerById(id: ActivitySource | null): ActivityProvider | null {
  if (!id) return null;
  return [healthKitProvider, deviceMotionProvider, healthConnectProvider].find((p) => p.id === id) ?? null;
}

export const PROVIDER_LABEL: Record<ActivitySource, string> = {
  apple_health: 'Apple Santé',
  health_connect: 'Health Connect',
  device_motion: 'Capteur de mouvement de l’iPhone',
};

// What each source measures, shown next to the values.
export const PROVIDER_SCOPE: Record<ActivitySource, string> = {
  apple_health: 'Pas, distance de marche et de course, énergie active et séances.',
  health_connect: 'Pas, distance (toutes activités), énergie active et séances.',
  device_motion: 'Pas uniquement, sur les 7 derniers jours.',
};
