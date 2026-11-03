// src/activity/motionOwner.ts
// The phone's step history (Core Motion's last 7 days on iPhone, the stored
// counter readings on Android) belongs to the device, not to an account.
// The device remembers which account last used it (kept across sign-out on
// purpose): when a different account enables step counting, it only gets
// steps from that moment on, never the previous person's history.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'loption-motion-owner';

export async function motionOwner(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setMotionOwner(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, userId);
  } catch {
    /* best effort: the next connect re-checks */
  }
}

// Start of the history an account may read: null = the full device history
// (the same account, or the first account on this phone).
export function historyStartFor(previousOwner: string | null, userId: string, now: Date): string | null {
  return previousOwner && previousOwner !== userId ? now.toISOString() : null;
}
