// Sign-in / sign-up flows against mocked Supabase, browser and Apple modules.
// These tests cover the app's handling of each outcome. They do NOT verify
// real Google, Apple or e-mail delivery: no provider is configured yet.
import { Platform } from 'react-native';
import {
  completeAuthFromUrl,
  describeOutcome,
  resendVerificationEmail,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  validateEmail,
  validatePassword,
} from '../src/services/authFlows';

const mockAuth = {
  signInWithOAuth: jest.fn(),
  exchangeCodeForSession: jest.fn(),
  signInWithIdToken: jest.fn(),
  signUp: jest.fn(),
  resend: jest.fn(),
};
const mockFrom = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  get supabase() {
    return { auth: mockAuth, from: mockFrom };
  },
}));

const mockAdopt = jest.fn(async () => {});
const mockSignIn = jest.fn();
jest.mock('../src/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ adoptSession: mockAdopt, signIn: mockSignIn }) },
}));

const mockSettings = jest.fn();
jest.mock('../src/services/authProviders', () => ({
  fetchAuthProviderSettings: () => mockSettings(),
}));

const mockOpenAuthSession = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: any[]) => mockOpenAuthSession(...args),
  maybeCompleteAuthSession: jest.fn(),
}));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `loption://${path}` }));

const mockApple = { isAvailableAsync: jest.fn(), signInAsync: jest.fn() };
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: () => mockApple.isAvailableAsync(),
  signInAsync: (opts: any) => mockApple.signInAsync(opts),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'uuid',
  digestStringAsync: jest.fn(async (_alg: string, value: string) => `sha256(${value})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const enabled = { status: 'loaded', settings: { google: true, apple: true, email: true, mailerAutoconfirm: false } };
const session = { access_token: 't', user: { id: 'u1', email: 'a@x.ma' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.mockResolvedValue(enabled);
  Platform.OS = 'ios';
});

describe('Google', () => {
  it('reports "not configured" without opening a browser when the provider is off', async () => {
    mockSettings.mockResolvedValue({ status: 'loaded', settings: { ...enabled.settings, google: false } });
    expect(await signInWithGoogle()).toEqual({ kind: 'not_configured', provider: 'google' });
    expect(mockAuth.signInWithOAuth).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
    expect(describeOutcome({ kind: 'not_configured', provider: 'google' })?.title).toMatch(/pas encore configuré/);
  });

  it('uses PKCE OAuth with the app redirect and exchanges the returned code', async () => {
    mockAuth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://p.supabase.co/auth/v1/authorize?x' }, error: null });
    mockOpenAuthSession.mockResolvedValue({ type: 'success', url: 'loption://auth-callback?code=abc' });
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });

    expect(await signInWithGoogle()).toEqual({ kind: 'signed_in' });
    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'loption://auth-callback', skipBrowserRedirect: true },
    });
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(mockAdopt).toHaveBeenCalledWith(session);
  });

  it('treats a closed browser as a cancellation', async () => {
    mockAuth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://x' }, error: null });
    mockOpenAuthSession.mockResolvedValue({ type: 'cancel' });
    expect(await signInWithGoogle()).toEqual({ kind: 'cancelled' });
    expect(mockAdopt).not.toHaveBeenCalled();
  });

  it('maps "provider is not enabled" from the redirect to not configured (settings unknown)', async () => {
    mockSettings.mockResolvedValue({ status: 'unknown' });
    mockAuth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://x' }, error: null });
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url: 'loption://auth-callback?error=invalid_request&error_description=Unsupported+provider%3A+provider+is+not+enabled',
    });
    expect(await signInWithGoogle()).toEqual({ kind: 'not_configured', provider: 'google' });
  });

  it('reports errors without throwing', async () => {
    mockAuth.signInWithOAuth.mockRejectedValue(new Error('network'));
    expect((await signInWithGoogle()).kind).toBe('error');
  });
});

describe('Apple', () => {
  it('reports unavailable on devices without Sign in with Apple', async () => {
    mockApple.isAvailableAsync.mockResolvedValue(false);
    expect(await signInWithApple()).toEqual({ kind: 'unavailable', provider: 'apple' });
  });

  it('reports not configured when the provider is off', async () => {
    mockApple.isAvailableAsync.mockResolvedValue(true);
    mockSettings.mockResolvedValue({ status: 'loaded', settings: { ...enabled.settings, apple: false } });
    expect(await signInWithApple()).toEqual({ kind: 'not_configured', provider: 'apple' });
    expect(mockApple.signInAsync).not.toHaveBeenCalled();
  });

  it('handles the user cancelling the Apple sheet', async () => {
    mockApple.isAvailableAsync.mockResolvedValue(true);
    mockApple.signInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    expect(await signInWithApple()).toEqual({ kind: 'cancelled' });
  });

  it('sends the hashed nonce to Apple and the raw nonce to Supabase; works with a private relay e-mail', async () => {
    mockApple.isAvailableAsync.mockResolvedValue(true);
    mockApple.signInAsync.mockResolvedValue({ identityToken: 'id-token', fullName: { givenName: 'Sara', familyName: 'B' } });
    const relaySession = { ...session, user: { id: 'u2', email: 'abc123@privaterelay.appleid.com' } };
    mockAuth.signInWithIdToken.mockResolvedValue({ data: { session: relaySession }, error: null });
    const upsert = jest.fn(async () => ({ error: null }));
    mockFrom.mockReturnValue({ upsert });

    expect(await signInWithApple()).toEqual({ kind: 'signed_in' });
    expect(mockApple.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'sha256(uuiduuid)' }));
    expect(mockAuth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'id-token', nonce: 'uuiduuid' });
    // The name Apple shares once is kept only if no profile exists yet; no role is sent.
    expect(upsert).toHaveBeenCalledWith({ user_id: 'u2', full_name: 'Sara B' }, { onConflict: 'user_id', ignoreDuplicates: true });
    expect(mockAdopt).toHaveBeenCalledWith(relaySession);
  });

  it('maps an audience mismatch (bundle id not registered in Supabase) to not configured', async () => {
    mockApple.isAvailableAsync.mockResolvedValue(true);
    mockApple.signInAsync.mockResolvedValue({ identityToken: 'id-token' });
    mockAuth.signInWithIdToken.mockResolvedValue({ data: {}, error: { message: 'Unacceptable audience in id_token' } });
    expect(await signInWithApple()).toEqual({ kind: 'not_configured', provider: 'apple' });
  });

  it('uses the hosted OAuth flow outside iOS', async () => {
    Platform.OS = 'android';
    mockAuth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://x' }, error: null });
    mockOpenAuthSession.mockResolvedValue({ type: 'dismiss' });
    expect(await signInWithApple()).toEqual({ kind: 'cancelled' });
    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apple' }));
  });
});

describe('e-mail sign-up and verification', () => {
  it('validates e-mail and password before calling the server', async () => {
    expect(validateEmail('not-an-email')).not.toBeNull();
    expect(validateEmail(' A@Example.MA ')).toBeNull();
    expect(validatePassword('short1')).not.toBeNull();
    expect(validatePassword('lettersonly')).not.toBeNull();
    expect(validatePassword('12345678')).not.toBeNull();
    expect(validatePassword('secret123')).toBeNull();
    expect((await signUpWithEmail('bad', 'secret123')).kind).toBe('invalid_input');
    expect((await signUpWithEmail('a@x.ma', 'short')).kind).toBe('invalid_input');
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  it('sends only e-mail, password and the redirect: no profile, role or admin flag from the client', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'n', identities: [{}] }, session: null }, error: null });
    expect(await signUpWithEmail(' New@X.ma ', 'secret123')).toEqual({ kind: 'verification_sent', email: 'new@x.ma' });
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'new@x.ma',
      password: 'secret123',
      options: { emailRedirectTo: 'loption://auth-callback' },
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockAdopt).not.toHaveBeenCalled(); // unverified: no session is treated as signed in
  });

  it('never claims an e-mail was sent when delivery is not configured', async () => {
    mockAuth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 500, code: 'unexpected_failure', message: 'Error sending confirmation email' },
    });
    const outcome = await signUpWithEmail('a@x.ma', 'secret123');
    expect(outcome).toEqual({ kind: 'email_delivery_unavailable' });
    expect(describeOutcome(outcome)?.message).toMatch(/Aucun e-mail n’a été envoyé/);

    mockAuth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 400, code: 'email_address_not_authorized', message: 'Email address not authorized' },
    });
    expect(await signUpWithEmail('a@x.ma', 'secret123')).toEqual({ kind: 'email_delivery_unavailable' });
  });

  it('detects an already registered address (Supabase sends nothing)', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'x', identities: [] }, session: null }, error: null });
    expect(await signUpWithEmail('a@x.ma', 'secret123')).toEqual({ kind: 'account_exists', email: 'a@x.ma' });
  });

  it('adopts the session only when the project confirms e-mails automatically', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'n', identities: [{}] }, session }, error: null });
    expect(await signUpWithEmail('a@x.ma', 'secret123')).toEqual({ kind: 'signed_in' });
    expect(mockAdopt).toHaveBeenCalledWith(session);
  });

  it('resends the verification e-mail and reports rate limits', async () => {
    mockAuth.resend.mockResolvedValue({ error: null });
    expect(await resendVerificationEmail('a@x.ma')).toEqual({ kind: 'verification_sent', email: 'a@x.ma' });
    expect(mockAuth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@x.ma',
      options: { emailRedirectTo: 'loption://auth-callback' },
    });
    mockAuth.resend.mockResolvedValue({ error: { status: 429, code: 'over_email_send_rate_limit', message: 'rate' } });
    expect(await resendVerificationEmail('a@x.ma')).toEqual({ kind: 'rate_limited' });
  });

  it('routes an unconfirmed account to verification at login', async () => {
    mockSignIn.mockResolvedValue({ error: { code: 'email_not_confirmed', message: 'Email not confirmed' } });
    expect(await signInWithEmail('a@x.ma', 'secret123')).toEqual({ kind: 'verification_required', email: 'a@x.ma' });
    mockSignIn.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
    expect(await signInWithEmail('a@x.ma', 'secret123')).toEqual({ kind: 'error', message: 'E-mail ou mot de passe incorrect.' });
    mockSignIn.mockResolvedValue({ error: null });
    expect(await signInWithEmail('a@x.ma', 'secret123')).toEqual({ kind: 'signed_in' });
  });
});

describe('verification link / OAuth redirect', () => {
  it('maps an expired link to link_expired (resend offered)', async () => {
    expect(
      await completeAuthFromUrl('loption://auth-callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    ).toEqual({ kind: 'link_expired' });
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('explains a link opened on another device (no PKCE verifier here)', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'bad_code_verifier', message: 'code challenge does not match previously saved code verifier' },
    });
    expect(await completeAuthFromUrl('loption://auth-callback?code=other-device')).toEqual({ kind: 'link_other_device' });
    expect(mockAdopt).not.toHaveBeenCalled();
  });

  it('exchanges each code once even if the redirect arrives twice', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    const [a, b] = await Promise.all([
      completeAuthFromUrl('loption://auth-callback?code=twice'),
      completeAuthFromUrl('loption://auth-callback?code=twice'),
    ]);
    expect(a).toEqual({ kind: 'signed_in' });
    expect(b).toEqual({ kind: 'signed_in' });
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });
});
