// src/activity/motionNative.ts — JavaScript interface of the L'OPTION phone motion
// module (ios/LoptionMotionModule.swift, android/.../LoptionMotionModule.kt).
// The native module exists only in a development or store build: in Expo
// Go, on the web and in tests `motion()` returns null and callers show an
// honest "needs the L'OPTION app build" state.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { CounterSnapshot } from './stepCounter';

export interface MotionCapabilities {
  platform: 'ios' | 'android';
  stepCounting: boolean;
  distance: boolean;
  history: boolean; // iOS: the system keeps 7 days
  background: boolean; // Android: background readings possible
  historyDays: number;
}

export interface MotionQuery {
  steps: number;
  distanceM: number | null;
  from: number;
  to: number;
}

export interface PermissionResponse {
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
}

export interface MotionUpdate {
  steps?: number; // iOS: steps since the start passed to startLiveUpdates
  distanceM?: number | null;
  counter?: number; // Android: cumulative counter value
  bootCount?: number;
  from?: number;
  to: number;
}

interface NativeMotion {
  capabilities(): MotionCapabilities;
  startLiveUpdates(fromMs: number): void;
  stopLiveUpdates(): void;
  addListener(event: 'onMotionUpdate', cb: (u: MotionUpdate) => void): { remove(): void };
  // iOS
  authorizationStatus?(): 'authorized' | 'denied' | 'restricted' | 'not_determined';
  queryAsync?(startMs: number, endMs: number): Promise<MotionQuery>;
  // Android
  getPermissionsAsync?(): Promise<PermissionResponse>;
  requestPermissionsAsync?(): Promise<PermissionResponse>;
  recordSnapshotAsync?(): Promise<CounterSnapshot | null>;
  getSnapshotsAsync?(sinceMs: number): Promise<CounterSnapshot[]>;
  clearSnapshotsAsync?(): Promise<void>;
  setBackgroundEnabledAsync?(enabled: boolean): Promise<boolean>;
  isBackgroundEnabled?(): boolean;
}

let cached: NativeMotion | null | undefined;

export function motion(): NativeMotion | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return (cached = null);
  try {
    cached = requireOptionalNativeModule<NativeMotion>('LoptionMotion') ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

// For tests only.
export function __setMotionModule(m: NativeMotion | null | undefined) {
  cached = m;
}
