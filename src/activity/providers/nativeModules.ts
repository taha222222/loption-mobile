// src/activity/providers/nativeModules.ts
// Whether a health library's native module is present in this binary.
// The libraries throw while being imported when it is missing (Expo Go, a
// build made before the library was added), and React Native reports an
// error thrown by a lazy require to the red error screen even when the
// caller catches it. So the native module is looked up first, which never
// throws, and the library is only loaded when it is there.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { TurboModuleRegistry } from 'react-native';

export const NATIVE_MODULE = {
  healthKit: 'NitroModules', // @kingstinct/react-native-healthkit runs on Nitro
  healthConnect: 'HealthConnect',
} as const;

export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function hasNativeModule(name: string): boolean {
  if (isExpoGo()) return false;
  try {
    return TurboModuleRegistry.get(name) != null;
  } catch {
    return false;
  }
}
