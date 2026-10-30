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
import type { ActivitySource, ProviderAvailability, ProviderPermission } from '../activity/types';
import { deviceTimeZone, localDate } from '../nutrition/dates';
import { deleteActivitySource, upsertActivityDays } from '../services/activityApi';

export interface ProviderState {
  id: ActivitySource;
  availability: ProviderAvailability;
}

interface ActivityState {
  ownerId: string | null;
  source: ActivitySource | null;
  connectedAt: string | null;
  lastSync: SyncOutcome | null;
  permission: ProviderPermission | null;
  providers: ProviderState[];
  syncing: boolean;
  claimForUser: (userId: string) => Promise<void>;
  inspect: () => Promise<void>;
  connect: (id: ActivitySource) => Promise<ProviderPermission>;
  disconnect: (options: { deleteImported: boolean }) => Promise<{ ok: boolean }>;
  sync: () => Promise<SyncOutcome | null>;
  reset: () => void;
}

const initial = {
  ownerId: null as string | null,
  source: null as ActivitySource | null,
  connectedAt: null as string | null,
  lastSync: null as SyncOutcome | null,
  permission: null as ProviderPermission | null,
  providers: [] as ProviderState[],
  syncing: false,
};

let inFlight: Promise<SyncOutcome | null> | null = null;

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      ...initial,

      claimForUser: async (userId) => {
        await waitForHydration();
        if (get().ownerId !== userId) set({ ...initial, ownerId: userId });
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
        set({ source: id, connectedAt: new Date().toISOString(), permission, lastSync: null });
        await get().sync();
        return permission;
      },

      disconnect: async ({ deleteImported }) => {
        const source = get().source;
        if (!source) return { ok: true };
        if (deleteImported) {
          const r = await deleteActivitySource(source);
          if (r.error) return { ok: false };
        }
        set({ source: null, connectedAt: null, lastSync: null, permission: null });
        return { ok: true };
      },

      sync: async () => {
        if (inFlight) return inFlight;
        const provider = providerById(get().source);
        if (!provider) return null;
        inFlight = (async () => {
          set({ syncing: true });
          try {
            if ((await provider.availability()) !== 'available') return null;
            const timeZone = deviceTimeZone();
            const outcome = await syncActivity({
              provider,
              timeZone,
              today: localDate(timeZone),
              upsertDays: upsertActivityDays,
            });
            set({ lastSync: outcome });
            return outcome;
          } finally {
            set({ syncing: false });
            inFlight = null;
          }
        })();
        return inFlight;
      },

      reset: () => set({ ...initial }),
    }),
    {
      name: 'loption-activity',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ownerId: s.ownerId, source: s.source, connectedAt: s.connectedAt, lastSync: s.lastSync }),
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
