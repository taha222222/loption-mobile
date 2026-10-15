import { decideRoute, isOnboardingComplete, RouteInput } from '../src/navigation/routeDecision';

const base: RouteInput = {
  authLoading: false,
  hasSession: true,
  role: 'customer',
  roleStatus: 'resolved',
  profileStatus: 'loaded',
  onboardingComplete: true,
  group: '(app)',
};

describe('decideRoute', () => {
  it('waits while the session is being restored', () => {
    expect(decideRoute({ ...base, authLoading: true })).toEqual({ kind: 'wait' });
  });

  it('sends signed-out users to login and allows only the auth group', () => {
    const signedOut = { ...base, hasSession: false, role: null, roleStatus: 'idle' as const };
    expect(decideRoute({ ...signedOut, group: '(app)' })).toEqual({ kind: 'redirect', href: '/(auth)/login' });
    expect(decideRoute({ ...signedOut, group: '(admin)' })).toEqual({ kind: 'redirect', href: '/(auth)/login' });
    expect(decideRoute({ ...signedOut, group: undefined })).toEqual({ kind: 'redirect', href: '/(auth)/login' });
    expect(decideRoute({ ...signedOut, group: '(auth)' })).toEqual({ kind: 'allow' });
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
});

describe('isOnboardingComplete', () => {
  it('requires weight, height and age', () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete({ weight: 70, height: 175, age: null })).toBe(false);
    expect(isOnboardingComplete({ weight: 70, height: 175, age: 30 })).toBe(true);
  });
});
