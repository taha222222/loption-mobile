// src/activity/providers/deviceMotion.ts
// iPhone motion coprocessor (CMPedometer through expo-sensors): steps only,
// at most the last 7 days. A fallback for customers who prefer not to
// connect Apple Health. Android's step sensor only counts while the app is
// open and keeps no history, so it cannot provide an honest daily total and
// is not offered.
import { Platform } from 'react-native';
import type { ActivityProvider, DailyReading, ProviderPermission } from '../types';

type PedometerModule = any;
let cached: PedometerModule | null | undefined;

function load(): PedometerModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') return (cached = null);
  try {
    // Lazy: the native module is absent in Expo Go and on other platforms.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-sensors').Pedometer ?? null;
  } catch {
    cached = null;
  }
  return cached ?? null;
}

// For tests only.
export function __resetPedometerModule() {
  cached = undefined;
}

const toPermission = (r: any): ProviderPermission =>
  r?.granted ? 'granted' : r?.canAskAgain === false || r?.status === 'denied' ? 'denied' : 'not_requested';

export const deviceMotionProvider: ActivityProvider = {
  id: 'device_motion',

  async availability() {
    if (Platform.OS !== 'ios') return 'unsupported';
    const p = load();
    if (!p) return 'needs_native_build';
    try {
      return (await p.isAvailableAsync()) ? 'available' : 'unsupported';
    } catch {
      return 'needs_native_build';
    }
  },

  async permission() {
    const p = load();
    if (!p) return 'not_requested';
    try {
      return toPermission(await p.getPermissionsAsync());
    } catch {
      return 'not_requested';
    }
  },

  async requestPermission() {
    const p = load();
    if (!p) return 'not_requested';
    const state = toPermission(await p.requestPermissionsAsync());
    return state === 'not_requested' ? 'denied' : state;
  },

  async readDays(days) {
    const p = load();
    if (!p) throw new Error('Pedometer unavailable');
    const now = new Date();
    const out: DailyReading[] = [];
    for (const w of days) {
      const end = w.end.getTime() > now.getTime() ? now : w.end;
      const res = await p.getStepCountAsync(w.start, end);
      const steps = Number(res?.steps);
      out.push({
        date: w.date,
        steps: Number.isFinite(steps) ? Math.round(steps) : null,
        distanceM: null,
        activeKcal: null,
        totalKcal: null,
      });
    }
    return out;
  },
};
