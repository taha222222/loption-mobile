import { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { Linking, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/stores/authStore';
import { useUserStore } from '../src/stores/userStore';
import { useSubscriptionStore } from '../src/stores/subscriptionStore';
import { useRouteDecision } from '../src/navigation/useRouteDecision';
import { isOnboardingComplete } from '../src/navigation/routeDecision';
import { useSetupStore } from '../src/stores/setupStore';
import '../src/i18n';
import { notificationService } from '../src/services/notificationService';

// Performs the redirects decided by the routing policy. Group layouts render
// <RouteGate>, so screens never mount before this has settled.
function useProtectedRoute() {
  const segments = useSegments();
  const group = segments[0] as string | undefined;
  const screen = (segments as string[])[1];
  const decision = useRouteDecision(group, screen);

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const role = useAuthStore((s) => s.role);
  const roleStatus = useAuthStore((s) => s.roleStatus);
  const loadedUserId = useUserStore((s) => s.loadedUserId);
  const loadProfile = useUserStore((s) => s.loadProfile);
  const onboarded = useUserStore((s) => s.loadedUserId === userId && isOnboardingComplete(s.profile));
  const setupUserId = useSetupStore((s) => s.loadedUserId);
  const loadSetup = useSetupStore((s) => s.load);

  // Customers need their nutrition profile to decide onboarding vs. app.
  useEffect(() => {
    if (userId && roleStatus === 'resolved' && role === 'customer' && loadedUserId !== userId) {
      loadProfile(userId);
    }
  }, [userId, role, roleStatus, loadedUserId, loadProfile]);

  // After onboarding: has this device shown the notification/location introduction?
  useEffect(() => {
    if (userId && role === 'customer' && onboarded && setupUserId !== userId) loadSetup(userId);
  }, [userId, role, onboarded, setupUserId, loadSetup]);

  // Keep the push token current for every sign-in method, without ever
  // prompting here (the prompt is shown only after the explanation screen).
  useEffect(() => {
    if (userId && role && roleStatus === 'resolved') {
      notificationService.registerPushTokenIfPermitted(userId, role);
    }
  }, [userId, role, roleStatus]);

  const redirectTo = decision.kind === 'redirect' ? decision.href : null;
  useEffect(() => {
    if (redirectTo) router.replace(redirectTo as any);
  }, [redirectTo, group, screen]);
}

export default function RootLayout() {
  const initializeAuth = useAuthStore((s) => s.initialize);
  const { fetchSubscription } = useSubscriptionStore();

  // Setup notification listeners
  useEffect(() => {
    const { subscription, responseSubscription } = notificationService.setupNotificationListeners();
    
    return () => {
      subscription?.remove();
      responseSubscription?.remove();
    };
  }, []);

  // Handle deep linking for subscription activation
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const { url } = event;
      if (url.includes('subscription/active')) {
        const planMatch = url.match(/plan=([^&]+)/);
        const plan = planMatch ? planMatch[1] : 'unknown';
        
        const { session } = useAuthStore.getState();
        if (session?.user?.id) {
          await fetchSubscription(session.user.id);
          Alert.alert(
            '🎉 Subscription Activated!',
            `Your ${plan} plan is now active. Enjoy premium features!`,
            [{ text: 'Great!' }]
          );
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => initializeAuth(), [initializeAuth]);

  useProtectedRoute();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(driver)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="(collaborator)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="auth-callback" />
      </Stack>
    </SafeAreaProvider>
  );
}