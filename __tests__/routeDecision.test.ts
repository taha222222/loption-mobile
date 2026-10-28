import { decideRoute, isEmailVerified, isOnboardingComplete, RouteInput } from '../src/navigation/routeDecision';

const base: RouteInput = {
  authLoading: false,
  hasSession: true,
  emailVerified: true,
  role: 'customer',
  roleStatus: 'resolved',
  profileStatus: 'loaded',
  onboardingComplete: true,
  setupStatus: 'done',
  group: '(app)',
};

describe('decideRoute', () => {
  it('waits while the session is being restored', () => {
    expect(decideRoute({ ...base, authLoading: true })).toEqual({ kind: 'wait' });
  });

  it('sends signed-out users to the welcome screen and allows only the auth group', () => {
    const signedOut = { ...base, hasSession: false, role: null, roleStatus: 'idle' as const };
    expect(decideRoute({ ...signedOut, group: '(app)' })).toEqual({ kind: 'redirect', href: '/(auth)/welcome' });
    expect(decideRoute({ ...signedOut, group: '(admin)' })).toEqual({ kind: 'redirect', href: '/(auth)/welcome' });
    expect(decideRoute({ ...signedOut, group: 'onboarding' })).toEqual({ kind: 'redirect', href: '/(auth)/welcome' });
    expect(decideRoute({ ...signedOut, group: 'setup' })).toEqual({ kind: 'redirect', href: '/(auth)/welcome' });
    expect(decideRoute({ ...signedOut, group: undefined })).toEqual({ kind: 'redirect', href: '/(auth)/welcome' });
    expect(decideRoute({ ...signedOut, group: '(auth)', screen: 'login' })).toEqual({ kind: 'allow' });
  });

  it('always lets the OAuth / e-mail-link callback run', () => {
    expect(decideRoute({ ...base, hasSession: false, group: 'auth-callback' })).toEqual({ kind: 'allow' });
    expect(decideRoute({ ...base, authLoading: true, group: 'auth-callback' })).toEqual({ kind: 'allow' });
  });

  it('confines an unverified e-mail account to the verification screen, for every role', () => {
    const unverified = { ...base, emailVerified: false };
    for (const group of ['(app)', 'onboarding', 'setup', '(admin)', undefined]) {
      expect(decideRoute({ ...unverified, group })).toEqual({ kind: 'redirect', href: '/(auth)/verify-email' });
    }
    expect(decideRoute({ ...unverified, group: '(auth)', screen: 'login' })).toEqual({
      kind: 'redirect',
      href: '/(auth)/verify-email',
    });
    expect(decideRoute({ ...unverified, group: '(auth)', screen: 'verify-email' })).toEqual({ kind: 'allow' });
    expect(decideRoute({ ...unverified, role: 'admin', group: '(admin)' })).toEqual({
      kind: 'redirect',
      href: '/(auth)/verify-email',
    });
  });

  it('never allows customer routes before the role is resolved', () => {
    for (const roleStatus of ['idle', 'loading'] as const) {
      expect(decideRoute({ ...base, role: null, roleStatus })).toEqual({ kind: 'wait' });
    }
    expect(decideRoute({ ...base, role: null, roleStatus: 'error' })).toEqual({ kind: 'error', reason: 'role' });
  });

  it.each([
    ['admin', '(admin)', '/(admin)'],
    ['driver', '(driver)', '/(driver)'],
    ['collaborator', '(collaborator)', '/(collaborator)'],
  ] as const)('keeps %s inside its own group', (role, group, href) => {
    expect(decideRoute({ ...base, role, group })).toEqual({ kind: 'allow' });
    expect(decideRoute({ ...base, role, group: '(app)' })).toEqual({ kind: 'redirect', href });
    expect(decideRoute({ ...base, role, group: 'onboarding' })).toEqual({ kind: 'redirect', href });
    expect(decideRoute({ ...base, role, group: '(auth)' })).toEqual({ kind: 'redirect', href });
  });

  it('keeps customers out of staff groups', () => {
    for (const group of ['(admin)', '(driver)', '(collaborator)']) {
      expect(decideRoute({ ...base, group })).toEqual({ kind: 'redirect', href: '/(app)' });
    }
  });

  it('waits for the customer profile before choosing onboarding vs app', () => {
    expect(decideRoute({ ...base, profileStatus: 'unloaded' })).toEqual({ kind: 'wait' });
    expect(decideRoute({ ...base, profileStatus: 'loading' })).toEqual({ kind: 'wait' });
    expect(decideRoute({ ...base, profileStatus: 'error' })).toEqual({ kind: 'error', reason: 'profile' });
  });

  it('routes customers through onboarding until it is complete', () => {
    const incomplete = { ...base, onboardingComplete: false };
    expect(decideRoute({ ...incomplete, group: '(app)' })).toEqual({ kind: 'redirect', href: '/onboarding' });
    expect(decideRoute({ ...incomplete, group: 'onboarding' })).toEqual({ kind: 'allow' });
    expect(decideRoute({ ...base, group: 'onboarding' })).toEqual({ kind: 'redirect', href: '/(app)' });
    expect(decideRoute({ ...base, group: undefined })).toEqual({ kind: 'redirect', href: '/(app)' });
  });

  it('shows the permission introduction once after onboarding, then the home screen', () => {
    expect(decideRoute({ ...base, setupStatus: 'unknown' })).toEqual({ kind: 'wait' });
    expect(decideRoute({ ...base, setupStatus: 'pending', group: '(app)' })).toEqual({ kind: 'redirect', href: '/setup' });
    expect(decideRoute({ ...base, setupStatus: 'pending', group: 'setup' })).toEqual({ kind: 'allow' });
    expect(decideRoute({ ...base, setupStatus: 'done', group: 'setup' })).toEqual({ kind: 'redirect', href: '/(app)' });
    // Not before onboarding is complete
    expect(decideRoute({ ...base, onboardingComplete: false, setupStatus: 'pending', group: 'setup' })).toEqual({
      kind: 'redirect',
      href: '/onboarding',
    });
  });

  it('never shows the home screen before the profile and setup state are known (returning user)', () => {
    expect(decideRoute({ ...base, profileStatus: 'loading', setupStatus: 'done' })).toEqual({ kind: 'wait' });
    expect(decideRoute({ ...base, setupStatus: 'unknown' })).toEqual({ kind: 'wait' });
    expect(decideRoute({ ...base })).toEqual({ kind: 'allow' });
  });
});

describe('isOnboardingComplete', () => {
  it('uses the server-stamped completion time when the schema has it', () => {
    expect(isOnboardingComplete({ onboarding_completed_at: null, weight: 70, height: 175, age: 30 })).toBe(false);
    expect(isOnboardingComplete({ onboarding_completed_at: '2026-10-28T10:00:00Z' })).toBe(true);
  });

  it('falls back to weight, height and age on the older schema', () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete({ weight: 70, height: 175, age: null })).toBe(false);
    expect(isOnboardingComplete({ weight: 70, height: 175, age: 30 })).toBe(true);
  });
});

describe('isEmailVerified', () => {
  it('requires a confirmed address for e-mail accounts', () => {
    expect(isEmailVerified(null)).toBe(false);
    expect(isEmailVerified({ app_metadata: { provider: 'email', providers: ['email'] } })).toBe(false);
    expect(isEmailVerified({ email_confirmed_at: '2026-10-28T10:00:00Z', app_metadata: { provider: 'email' } })).toBe(true);
  });

  it('treats provider-verified identities (Google, Apple) as verified', () => {
    expect(isEmailVerified({ app_metadata: { provider: 'google', providers: ['google'] } })).toBe(true);
    expect(isEmailVerified({ app_metadata: { provider: 'apple', providers: ['apple'] } })).toBe(true);
    // An e-mail identity linked to the account still needs confirmation.
    expect(isEmailVerified({ app_metadata: { provider: 'google', providers: ['google', 'email'] } })).toBe(false);
  });
});
