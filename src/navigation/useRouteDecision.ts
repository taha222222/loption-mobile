// src/navigation/useRouteDecision.ts
import { useAuthStore } from '../stores/authStore';
import { useUserStore } from '../stores/userStore';
import { decideRoute, isOnboardingComplete, RouteDecision } from './routeDecision';

export function useRouteDecision(group: string | undefined): RouteDecision {
  const authLoading = useAuthStore((s) => s.isLoading);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const hasSession = useAuthStore((s) => !!s.session);
  const role = useAuthStore((s) => s.role);
  const roleStatus = useAuthStore((s) => s.roleStatus);
  const profile = useUserStore((s) => s.profile);
  const loadedUserId = useUserStore((s) => s.loadedUserId);
  const rawProfileStatus = useUserStore((s) => s.profileStatus);

  // A profile loaded for a different user is treated as not loaded.
  const profileStatus = loadedUserId === userId ? rawProfileStatus : 'unloaded';

  return decideRoute({
    authLoading,
    hasSession,
    role,
    roleStatus,
    profileStatus,
    onboardingComplete: isOnboardingComplete(profileStatus === 'loaded' ? profile : null),
    group,
  });
}
