// src/navigation/routeDecision.ts
// Pure routing policy shared by the root redirect effect and the per-group
// layout gates. Keeping it pure makes it unit-testable without React Native.
//
// This controls what the UI renders; it is NOT authorization. Data access
// must be enforced server-side (RLS / RPCs).
import type { RoleStatus, UserRole } from '../stores/authStore';
import type { ProfileStatus } from '../stores/userStore';
import type { SetupStatus } from '../stores/setupStore';

export type RouteDecision =
  | { kind: 'allow' }
  | { kind: 'wait' }
  | { kind: 'redirect'; href: string }
  | { kind: 'error'; reason: 'role' | 'profile' };

export interface RouteInput {
  authLoading: boolean;
  hasSession: boolean;
  // False for an e-mail/password account whose address is not confirmed yet.
  emailVerified: boolean;
  role: UserRole | null;
  roleStatus: RoleStatus;
  // Customer-only: state of the nutrition profile for the active user.
  profileStatus: ProfileStatus;
  onboardingComplete: boolean;
  // Customer-only: notification/location introduction on this device.
  setupStatus: SetupStatus;
  // First route segment, e.g. '(app)', '(auth)', 'onboarding'; undefined for '/'.
  group: string | undefined;
  // Second route segment, e.g. 'login' in /(auth)/login.
  screen?: string;
}

export const SIGNED_OUT_HOME = '/(auth)/welcome';
export const VERIFY_EMAIL = '/(auth)/verify-email';

// Handles OAuth and e-mail-link redirects; it navigates on its own.
const CALLBACK_GROUP = 'auth-callback';

const ROLE_HOME: Record<Exclude<UserRole, 'customer'>, { group: string; href: string }> = {
  admin: { group: '(admin)', href: '/(admin)' },
  driver: { group: '(driver)', href: '/(driver)' },
  collaborator: { group: '(collaborator)', href: '/(collaborator)' },
};

export function decideRoute(input: RouteInput): RouteDecision {
  const { group } = input;

  if (group === CALLBACK_GROUP) return { kind: 'allow' };
  if (input.authLoading) return { kind: 'wait' };

  if (!input.hasSession) {
    return group === '(auth)' ? { kind: 'allow' } : { kind: 'redirect', href: SIGNED_OUT_HOME };
  }

  // An unverified e-mail account is never treated as a full account.
  if (!input.emailVerified) {
    return group === '(auth)' && input.screen === 'verify-email'
      ? { kind: 'allow' }
      : { kind: 'redirect', href: VERIFY_EMAIL };
  }

  if (input.roleStatus === 'error') return { kind: 'error', reason: 'role' };
  if (input.roleStatus !== 'resolved' || !input.role) return { kind: 'wait' };

  if (input.role !== 'customer') {
    const home = ROLE_HOME[input.role];
    return group === home.group ? { kind: 'allow' } : { kind: 'redirect', href: home.href };
  }

  if (input.profileStatus === 'error') return { kind: 'error', reason: 'profile' };
  if (input.profileStatus !== 'loaded') return { kind: 'wait' };

  if (!input.onboardingComplete) {
    return group === 'onboarding' ? { kind: 'allow' } : { kind: 'redirect', href: '/onboarding' };
  }

  if (input.setupStatus === 'unknown') return { kind: 'wait' };
  if (input.setupStatus === 'pending') {
    return group === 'setup' ? { kind: 'allow' } : { kind: 'redirect', href: '/setup' };
  }
  return group === '(app)' ? { kind: 'allow' } : { kind: 'redirect', href: '/(app)' };
}

export function isOnboardingComplete(
  profile: {
    onboarding_completed_at?: string | null;
    weight?: number | null;
    height?: number | null;
    age?: number | null;
  } | null
): boolean {
  if (!profile) return false;
  // Server with the V1 onboarding migration: explicit, server-stamped flag.
  if ('onboarding_completed_at' in profile) return !!profile.onboarding_completed_at;
  // Older schema (migration not applied): the previous rule.
  return !!(profile.weight && profile.height && profile.age);
}

// E-mail/password accounts must confirm their address. OAuth identities
// (Google, Apple) are verified by the provider.
export function isEmailVerified(
  user: {
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
    app_metadata?: { provider?: string; providers?: string[] };
  } | null
): boolean {
  if (!user) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;
  const providers = user.app_metadata?.providers ?? [user.app_metadata?.provider ?? 'email'];
  return !providers.includes('email');
}
