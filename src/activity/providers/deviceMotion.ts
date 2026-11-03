// src/activity/providers/deviceMotion.ts
// The phone's own motion sensor: the default activity source, no health
// platform needed (Apple Health / Health Connect stay optional).
//   iPhone   Core Motion (CMPedometer) through the L'OPTION motion module:
//            steps and walking distance for the last 7 days, measured by the
//            motion coprocessor even while the app is closed. Without the
//            module (an older build) expo-sensors gives steps only.
//   Android  the hardware step counter (TYPE_STEP_COUNTER) through the
//            L'OPTION motion module. Android keeps no history: the app keeps
//            readings on the device (when opened and every ~15 minutes in
//            the background) and derives each day from them
//            (src/activity/stepCounter.ts). A phone without a step counter
//            is reported as unsupported, never estimated.
// The value 'device_motion' is the stored source of both platforms.
import { Platform } from 'react-native';
import { motion } from '../motionNative';
import { dailySteps, readingStats } from '../stepCounter';
import { PermissionRevokedError, type ActivityProvider, type DailyReading, type ProviderPermission } from '../types';

type PedometerModule = any;
let cachedPedometer: PedometerModule | null | undefined;

function pedometer(): PedometerModule | null {
  if (cachedPedometer !== undefined) return cachedPedometer;
  if (Platform.OS !== 'ios') return (cachedPedometer = null);
  try {
    // Lazy: the native module is absent in Expo Go and on other platforms.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedPedometer = require('expo-sensors').Pedometer ?? null;
  } catch {
    cachedPedometer = null;
  }
  return cachedPedometer ?? null;
}

// For tests only.
export function __resetPedometerModule() {
  cachedPedometer = undefined;
}

const toPermission = (r: any): ProviderPermission =>
  r?.granted ? 'granted' : r?.canAskAgain === false || r?.status === 'denied' ? 'denied' : 'not_requested';

const IOS_STATUS: Record<string, ProviderPermission> = {
  authorized: 'granted',
  denied: 'denied',
  restricted: 'denied',
  not_determined: 'not_requested',
};

// Readings older than this are not kept on Android (10 days on the device).
const ANDROID_LOOKBACK_MS = 10 * 24 * 3600 * 1000;

export const deviceMotionProvider: ActivityProvider = {
  id: 'device_motion',

  async availability() {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
    const m = motion();
    if (m) {
      try {
        return m.capabilities().stepCounting ? 'available' : 'unsupported';
      } catch {
        return 'needs_native_build';
      }
    }
    if (Platform.OS === 'android') return 'needs_native_build';
    const p = pedometer();
    if (!p) return 'needs_native_build';
    try {
      return (await p.isAvailableAsync()) ? 'available' : 'unsupported';
    } catch {
      return 'needs_native_build';
    }
  },

  async permission() {
    const m = motion();
    try {
      if (m && Platform.OS === 'ios' && m.authorizationStatus) return IOS_STATUS[m.authorizationStatus()] ?? 'not_requested';
      if (m && Platform.OS === 'android' && m.getPermissionsAsync) return toPermission(await m.getPermissionsAsync());
      const p = pedometer();
      return p ? toPermission(await p.getPermissionsAsync()) : 'not_requested';
    } catch {
      return 'not_requested';
    }
  },

  async requestPermission() {
    const m = motion();
    if (m && Platform.OS === 'android' && m.requestPermissionsAsync) {
      const state = toPermission(await m.requestPermissionsAsync());
      if (state === 'granted') {
        // Background readings keep days complete while the app is closed.
        await m.setBackgroundEnabledAsync?.(true);
        await m.recordSnapshotAsync?.();
      }
      return state === 'not_requested' ? 'denied' : state;
    }
    const p = pedometer();
    if (p) {
      const state = toPermission(await p.requestPermissionsAsync());
      return state === 'not_requested' ? 'denied' : state;
    }
    if (m?.queryAsync) {
      // The first query shows the Motion & Fitness prompt.
      try {
        const now = Date.now();
        await m.queryAsync(now - 60_000, now);
      } catch {
        /* the status below tells */
      }
      return IOS_STATUS[m.authorizationStatus?.() ?? 'not_determined'] === 'granted' ? 'granted' : 'denied';
    }
    return 'not_requested';
  },

  async readDays(days) {
    const m = motion();
    const now = Date.now();
    if (Platform.OS === 'android') {
      if (!m?.getSnapshotsAsync) throw new Error('Step counter unavailable');
      await m.recordSnapshotAsync?.();
      const snaps = await m.getSnapshotsAsync(Math.max(days[0].start.getTime() - 24 * 3600 * 1000, now - ANDROID_LOOKBACK_MS));
      const tz = days[0].timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const byDate = new Map(dailySteps(snaps, tz).map((d) => [d.date, d]));
      return days.map((w): DailyReading => {
        const d = byDate.get(w.date);
        return {
          date: w.date,
          steps: d ? d.steps : null,
          distanceM: null,
          activeKcal: null,
          totalKcal: null,
          measuredFrom: d?.measuredFrom ?? null,
          measuredTo: d?.measuredTo ?? null,
        };
      });
    }
    const out: DailyReading[] = [];
    for (const w of days) {
      const end = w.end.getTime() > now ? new Date(now) : w.end;
      if (end.getTime() <= w.start.getTime()) continue;
      if (m?.queryAsync) {
        let r;
        try {
          r = await m.queryAsync(w.start.getTime(), end.getTime());
        } catch (e: any) {
          // Motion & Fitness turned off after it was granted.
          if (e?.code === 'E_MOTION_DENIED' || m.authorizationStatus?.() === 'denied') throw new PermissionRevokedError();
          throw e;
        }
        out.push({
          date: w.date,
          steps: Number.isFinite(r?.steps) ? Math.round(r.steps) : null,
          distanceM: r?.distanceM === null || r?.distanceM === undefined ? null : Math.round(r.distanceM),
          activeKcal: null,
          totalKcal: null,
          measuredFrom: w.start.toISOString(),
          measuredTo: end.toISOString(),
        });
        continue;
      }
      const p = pedometer();
      if (!p) throw new Error('Pedometer unavailable');
      const res = await p.getStepCountAsync(w.start, end);
      const steps = Number(res?.steps);
      out.push({
        date: w.date,
        steps: Number.isFinite(steps) ? Math.round(steps) : null,
        distanceM: null,
        activeKcal: null,
        totalKcal: null,
        measuredFrom: w.start.toISOString(),
        measuredTo: end.toISOString(),
      });
    }
    return out;
  },

  async diagnostics() {
    const m = motion();
    if (Platform.OS !== 'android' || !m?.getSnapshotsAsync) return null;
    const now = Date.now();
    return readingStats(await m.getSnapshotsAsync(now - 24 * 3600 * 1000 - 60_000), now);
  },
};
