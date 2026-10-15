import { ConfigError, readSupabaseConfig } from '../src/config/env';

const b64url = (obj: object) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fakeJwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;

describe('readSupabaseConfig', () => {
  it('returns trimmed config for valid values', () => {
    expect(
      readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: ' https://abc.supabase.co/ ',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }),
      })
    ).toEqual({ url: 'https://abc.supabase.co', anonKey: fakeJwt({ role: 'anon' }) });
  });

  it('names every missing variable', () => {
    expect(() => readSupabaseConfig({})).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY/
    );
    expect(() =>
      readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: '  ' })
    ).toThrow(ConfigError);
  });

  it('rejects malformed and non-https URLs, allowing http only for localhost', () => {
    const key = 'anon';
    expect(() => readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'not a url', EXPO_PUBLIC_SUPABASE_ANON_KEY: key })).toThrow(
      /not a valid URL/
    );
    expect(() =>
      readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: key })
    ).toThrow(/https/);
    expect(
      readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://localhost:54321', EXPO_PUBLIC_SUPABASE_ANON_KEY: key }).url
    ).toBe('http://localhost:54321');
  });

  it('refuses service-role and secret keys', () => {
    const url = 'https://abc.supabase.co';
    expect(() =>
      readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role' }) })
    ).toThrow(/service-role/);
    expect(() =>
      readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_abc123' })
    ).toThrow(/service-role/);
  });
});
