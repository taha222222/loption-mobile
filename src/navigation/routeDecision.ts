// src/navigation/routeDecision.ts
// Pure routing policy shared by the root redirect effect and the per-group
// layout gates. Keeping it pure makes it unit-testable without React Native.
//
// This controls what the UI renders; it is NOT authorization. Data access
// must be enforced server-side (RLS / RPCs).
import type { RoleStatus, UserRole } from '../stores/authStore';
import type { ProfileStatus } from '../stores/userStore';

export type RouteDecision =
  | { kind: 'allow' }
  | { kind: 'wait' }
  | { kind: 'redirect'; href: string }
  | { kind: 'error'; reason: 'role' | 'profile' };

export interface RouteInput {
  authLoading: boolean;
  hasSession: boolean;
  role: UserRole | null;
  roleStatus: RoleStatus;
  // Customer-only: state of the nutrition profile for the active user.
  profileStatus: ProfileStatus;
  onboardingComplete: boolean;
  // First route segment, e.g. '(app)', '(auth)', 'onboarding'; undefined for '/'.
  group: string | undefined;
}

const ROLE_HOME: Record<Exclude<UserRole, 'customer'>, { group: string; href: string }> = {
  admin: { group: '(admin)', href: '/(admin)' },
  driver: { group: '(driver)', href: '/(driver)' },
  collaborator: { group: '(collaborator)', href: '/(collaborator)' },
};

export function decideRoute(input: RouteInput): RouteDecision {
  const { group } = input;

  if (input.authLoading) return { kind: 'wait' };

  if (!input.hasSession) {
    return group === '(auth)' ? { kind: 'allow' } : { kind: 'redirect', href: '/(auth)/login' };
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
  return group === '(app)' ? { kind: 'allow' } : { kind: 'redirect', href: '/(app)' };
}

export function isOnboardingComplete(
  profile: { weight?: number | null; height?: number | null; age?: number | null } | null
): boolean {
  return !!(profile?.weight && profile?.height && profile?.age);
}
