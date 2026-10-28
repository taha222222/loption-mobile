// src/navigation/useRouteDecision.ts
import { useAuthStore } from '../stores/authStore';
import { useSetupStore } from '../stores/setupStore';
import { useUserStore } from '../stores/userStore';
import { decideRoute, isEmailVerified, isOnboardingComplete, RouteDecision } from './routeDecision';

export function useRouteDecision(group: string | undefined, screen?: string): RouteDecision {
  const authLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const hasSession = useAuthStore((s) => !!s.session);
  const role = useAuthStore((s) => s.role);
  const roleStatus = useAuthStore((s) => s.roleStatus);
  const profile = useUserStore((s) => s.profile);
  const loadedUserId = useUserStore((s) => s.loadedUserId);
  const rawProfileStatus = useUserStore((s) => s.profileStatus);
  const setupUserId = useSetupStore((s) => s.loadedUserId);
  const rawSetupStatus = useSetupStore((s) => s.status);

  const userId = user?.id ?? null;
  // State loaded for a different user is treated as not loaded.
  const profileStatus = loadedUserId === userId ? rawProfileStatus : 'unloaded';
  const setupStatus = setupUserId === userId ? rawSetupStatus : 'unknown';

  return decideRoute({
    authLoading,
    hasSession,
    emailVerified: isEmailVerified(user as any),
    role,
    roleStatus,
    profileStatus,
    onboardingComplete: isOnboardingComplete(profileStatus === 'loaded' ? profile : null),
    setupStatus,
    group,
    screen,
  });
}
