// src/stores/setupStore.ts
// Tracks whether the notification/location introduction after onboarding
// is still pending for the signed-in customer ON THIS DEVICE. Operating
// system permissions are per device, so the flag is stored per account and
// device in AsyncStorage. It only decides whether to show an explanation
// screen; it never grants anything.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type SetupStatus = 'unknown' | 'pending' | 'done';

const keyFor = (userId: string) => `loption.setup.v1.${userId}`;

interface SetupState {
  status: SetupStatus;
  loadedUserId: string | null;
  load: (userId: string) => Promise<void>;
  markDone: (userId: string) => Promise<void>;
  reset: () => void;
}

export const useSetupStore = create<SetupState>((set, get) => ({
  status: 'unknown',
  loadedUserId: null,

  load: async (userId: string) => {
    set({ status: 'unknown', loadedUserId: userId });
    let done = false;
    try {
      done = (await AsyncStorage.getItem(keyFor(userId))) === 'done';
    } catch {
      // Storage unavailable: show the introduction again rather than skip it.
    }
    if (get().loadedUserId !== userId) return;
    set({ status: done ? 'done' : 'pending' });
  },

  markDone: async (userId: string) => {
    try {
      await AsyncStorage.setItem(keyFor(userId), 'done');
    } catch {
      // Not persisted: the introduction may show once more on next launch.
    }
    if (get().loadedUserId === userId) set({ status: 'done' });
  },

  reset: () => set({ status: 'unknown', loadedUserId: null }),
}));
