import { fetchAuthProviderSettings, resetAuthProviderSettingsCache } from '../src/services/authProviders';

const env = { EXPO_PUBLIC_SUPABASE_URL: 'https://p.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const response = (body: any, ok = true) => ({ ok, json: async () => body }) as any;

beforeEach(() => resetAuthProviderSettingsCache());

describe('auth provider settings', () => {
  it('reads which providers are enabled from the public settings endpoint with the anon key only', async () => {
    const fetchImpl = jest.fn(async () =>
      response({ external: { google: false, apple: true, email: true }, mailer_autoconfirm: false })
    );
    const result = await fetchAuthProviderSettings(fetchImpl as any, env);
    expect(result).toEqual({
      status: 'loaded',
      settings: { google: false, apple: true, email: true, mailerAutoconfirm: false },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://p.supabase.co/auth/v1/settings',
      expect.objectContaining({ headers: { apikey: 'anon' } })
    );
  });

  it('treats missing providers as not configured', async () => {
    const result = await fetchAuthProviderSettings((async () => response({ external: {} })) as any, env);
    expect(result).toMatchObject({ status: 'loaded', settings: { google: false, apple: false } });
  });

  it('returns "unknown" (not a crash) when the request fails, and retries next time', async () => {
    const failing = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchAuthProviderSettings(failing as any, env)).toEqual({ status: 'unknown' });
    expect(await fetchAuthProviderSettings((async () => response({}, false)) as any, env)).toEqual({ status: 'unknown' });
    const ok = jest.fn(async () => response({ external: { google: true } }));
    expect((await fetchAuthProviderSettings(ok as any, env)).status).toBe('loaded');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
