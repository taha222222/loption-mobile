// src/config/env.ts
// Validates the public (client-safe) configuration baked into the bundle.
// Only EXPO_PUBLIC_* values belong here; never put service-role keys or
// payment secrets in the mobile app.

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type EnvSource = Record<string, string | undefined>;

export function readSupabaseConfig(env: EnvSource): SupabaseConfig {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const missing: string[] = [];
  if (!url) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!anonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values for your Supabase project.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url!);
  } catch {
    throw new ConfigError('EXPO_PUBLIC_SUPABASE_URL is not a valid URL.');
  }
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isLocalhost && parsed.protocol === 'http:')) {
    throw new ConfigError('EXPO_PUBLIC_SUPABASE_URL must use https (http is allowed only for localhost).');
  }

  if (looksLikeServiceRoleKey(anonKey!)) {
    throw new ConfigError(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY appears to be a service-role/secret key. ' +
        'Only the anon (publishable) key may be shipped in the mobile app.'
    );
  }

  return { url: url!.replace(/\/+$/, ''), anonKey: anonKey! };
}

// Rejects new-style secret keys and legacy JWT keys whose payload role is service_role.
function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}
