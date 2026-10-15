// src/lib/supabase.ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { readSupabaseConfig } from '../config/env';

// EXPO_PUBLIC_* variables are inlined at build time only when referenced
// statically, so they must be read as explicit property accesses.
const config = readSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

export const supabase = createClient(config.url, config.anonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // There is no URL-based OAuth/magic-link callback handling in this app.
    detectSessionInUrl: false,
  },
});

// On native, timers are suspended in the background, so token refresh must
// follow the app's foreground state (Supabase React Native guidance).
// Registered once at module load; the client is a singleton.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
