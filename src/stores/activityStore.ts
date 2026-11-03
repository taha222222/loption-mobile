// src/stores/activityStore.ts
// Which health platform the customer connected on this device, and the
// last sync. Persisted per account (like the cart): another account
// signing in on the same device starts disconnected. Health values
// themselves are never stored on the device; they live on the server
// (owner-only) and are reloaded for display.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { providerById, providersForPlatform } from '../activity/providers';
import { SyncOutcome, syncActivity } from '../activity/sync';
import { WORKOUT_SOURCE_FOR, type ActivitySource, type ProviderAvailability, type ProviderPermission } from '../activity/types';
import { deviceTimeZone, localDate } from '../nutrition/dates';
import { deleteActivitySource, upsertActivityDays } from '../services/activityApi';
import { motion } from '../activity/motionNative';
import type { ReadingStats } from '../activity/stepCounter';
import { historyStartFor, motionOwner, setMotionOwner } from '../activity/motionOwner';
import { deleteImportedWorkouts, importProviderWorkouts } from '../services/workoutApi';

export interface ProviderState {
  id: ActivitySource;
  availability: ProviderAvailability;
}

interface ActivityState {
  ownerId: string | null;
  source: ActivitySource | null;
  connectedAt: string | null;
  lastSync: SyncOutcome | null;
  lastSuccessAt: string | null; // last sync the server accepted (shown to the customer)
  historyFrom: string | null; // phone sensor: steps before this belong to another account
  permission: ProviderPermission | null;
  // Android phone sensor: real background reading behaviour (last 24 h).
  diagnostics: ReadingStats | null;
  providers: ProviderState[];
  syncing: boolean;
  claimForUser: (userId: string) => Promise<void>;
  inspect: () => Promise<void>;
  connect: (id: ActivitySource) => Promise<ProviderPermission>;
  disconnect: (options: { deleteImported: boolean }) => Promise<{ ok: boolean }>;
  // Reads the phone/platform and uploads. Throttled (MIN_SYNC_MS) unless
  // forced: the sensor batches on its own, so frequent uploads add nothing.
  sync: (options?: { force?: boolean }) => Promise<SyncOutcome | null>;
  reset: () => void;
}

const initial = {
  ownerId: null as string | null,
  source: null as ActivitySource | null,
  connectedAt: null as string | null,
  lastSync: null as SyncOutcome | null,
  lastSuccessAt: null as string | null,
  historyFrom: null as string | null,
  permission: null as ProviderPermission | null,
  diagnostics: null as ReadingStats | null,
  providers: [] as ProviderState[],
  syncing: false,
};

let inFlight: Promise<SyncOutcome | null> | null = null;
export const MIN_SYNC_MS = 2 * 60_000;

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      ...initial,

      claimForUser: async (userId) => {
        await waitForHydration();
        if (get().ownerId !== userId) {
          if (get().source === 'device_motion') await motion()?.setBackgroundEnabledAsync?.(false).catch(() => undefined);
          set({ ...initial, ownerId: userId });
        }
      },

      inspect: async () => {
        const providers = await Promise.all(
          providersForPlatform().map(async (p) => ({ id: p.id, availability: await p.availability() }))
        );
        const current = providerById(get().source);
        const permission = current ? await current.permission() : null;
        set({ providers, permission });
      },

      connect: async (id) => {
        const provider = providerById(id);
        if (!provider) return 'not_requested';
        if ((await provider.availability()) !== 'available') return 'not_requested';
        const permission = await provider.requestPermission();
        if (permission === 'denied' || permission === 'not_requested') {
          set({ permission });
          return permission;
        }
        let historyFrom: string | null = null;
        const userId = get().ownerId;
        if (id === 'device_motion' && userId) {
          const previous = await motionOwner();
          historyFrom = historyStartFor(previous, userId, new Date());
          if (previous !== userId) {
            // Another account's counter readings never reach this account.
            await motion()?.clearSnapshotsAsync?.().catch(() => undefined);
            if (previous) await motion()?.recordSnapshotAsync?.().catch(() => null);
            await setMotionOwner(userId);
          }
        }
        set({ source: id, connectedAt: new Date().toISOString(), permission, lastSync: null, historyFrom });
        await get().sync();
        return permission;
      },

      disconnect: async ({ deleteImported }) => {
        const source = get().source;
        if (!source) return { ok: true };
        if (deleteImported) {
          const r = await deleteActivitySource(source);
          if (r.error) return { ok: false };
          const workoutSource = WORKOUT_SOURCE_FOR[source];
          if (workoutSource && (await deleteImportedWorkouts(workoutSource)).error) return { ok: false };
        }
        if (source === 'device_motion') await motion()?.setBackgroundEnabledAsync?.(false).catch(() => undefined);
        set({ source: null, connectedAt: null, lastSync: null, lastSuccessAt: null, permission: null, historyFrom: null });
        return { ok: true };
      },

      sync: async ({ force = false } = {}) => {
        if (inFlight) return inFlight;
        const provider = providerById(get().source);
        if (!provider) return null;
        const last = get().lastSync;
        if (!force && last?.status === 'ok' && Date.now() - new Date(last.at).getTime() < MIN_SYNC_MS) return last;
        inFlight = (async () => {
          set({ syncing: true });
          try {
            if ((await provider.availability()) !== 'available') return null;
            const timeZone = deviceTimeZone();
            const workoutSource = WORKOUT_SOURCE_FOR[provider.id];
            const outcome = await syncActivity({
              provider,
              timeZone,
              today: localDate(timeZone),
              upsertDays: upsertActivityDays,
              notBefore: get().historyFrom,
              upsertWorkouts: workoutSource ? (w) => importProviderWorkouts(w, workoutSource, timeZone) : undefined,
            });
            const revoked = outcome.status === 'provider_error' && outcome.message === 'permission_denied';
            const diagnostics = provider.diagnostics ? await provider.diagnostics().catch(() => null) : null;
            set({
              lastSync: outcome,
              diagnostics,
              ...(outcome.status === 'ok' ? { lastSuccessAt: outcome.at } : {}),
              ...(revoked ? { permission: 'denied' as const } : {}),
            });
            return outcome;
          } finally {
            set({ syncing: false });
            inFlight = null;
          }
        })();
        return inFlight;
      },

      // Sign-out / account change: stop background readings of the phone
      // sensor (they would belong to nobody signed in).
      reset: () => {
        if (get().source === 'device_motion') void motion()?.setBackgroundEnabledAsync?.(false).catch(() => undefined);
        set({ ...initial });
      },
    }),
    {
      name: 'loption-activity',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        ownerId: s.ownerId,
        source: s.source,
        connectedAt: s.connectedAt,
        lastSync: s.lastSync,
        lastSuccessAt: s.lastSuccessAt,
        historyFrom: s.historyFrom,
      }),
    }
  )
);

function waitForHydration(): Promise<void> {
  if (useActivityStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useActivityStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
