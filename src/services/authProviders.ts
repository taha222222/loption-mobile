// src/services/authProviders.ts
// Which sign-in methods the Supabase project has enabled.
//
// Provider credentials (Google client secret, Apple key) live only in the
// Supabase Dashboard; the app never holds them. The app reads the public
// Auth settings endpoint (GET /auth/v1/settings with the anon key), which
// reports whether each external provider is switched on. When a provider is
// off, its button explains that it is not configured yet instead of failing.
import { readSupabaseConfig } from '../config/env';

export type OAuthProvider = 'google' | 'apple';

export interface AuthProviderSettings {
  google: boolean;
  apple: boolean;
  email: boolean;
  // True when the project confirms e-mails automatically (no verification
  // e-mail is sent). Reported so the app never claims an e-mail was sent.
  mailerAutoconfirm: boolean;
}

export type ProviderSettingsResult =
  | { status: 'loaded'; settings: AuthProviderSettings }
  | { status: 'unknown' };

const TIMEOUT_MS = 6000;
let cached: Promise<ProviderSettingsResult> | null = null;

export function fetchAuthProviderSettings(
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  }
): Promise<ProviderSettingsResult> {
  if (cached) return cached;
  const request = (async (): Promise<ProviderSettingsResult> => {
    const { url, anonKey } = readSupabaseConfig(env);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${url}/auth/v1/settings`, {
        headers: { apikey: anonKey },
        signal: controller.signal,
      });
      if (!response.ok) return { status: 'unknown' };
      const body: any = await response.json();
      const external = body?.external ?? {};
      return {
        status: 'loaded',
        settings: {
          google: external.google === true,
          apple: external.apple === true,
          email: external.email !== false,
          mailerAutoconfirm: body?.mailer_autoconfirm === true,
        },
      };
    } catch {
      return { status: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  })();
  cached = request;
  // Do not keep a failed lookup: the next screen retries.
  request.then((r) => {
    if (r.status === 'unknown' && cached === request) cached = null;
  });
  return request;
}

export function resetAuthProviderSettingsCache() {
  cached = null;
}
