import { useEffect, useRef } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { Linking, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';  // <-- ADD THIS LINE
import { useAuthStore } from '../src/stores/authStore';
import { useUserStore } from '../src/stores/userStore';
import { useSubscriptionStore } from '../src/stores/subscriptionStore';
import '../src/i18n';
import { notificationService } from '../src/services/notificationService';

function useProtectedRoute() {
  const segments = useSegments();
  const { session, isLoading, role } = useAuthStore();
  const { profile, loadProfile } = useUserStore();
  const isChecking = useRef(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (isLoading || isChecking.current) {
        console.log('Auth check skipped - loading or already checking');
        return;
      }
      isChecking.current = true;

      const inAuthGroup = segments[0] === '(auth)';
      const inOnboarding = segments[0] === 'onboarding';
      const inCustomerApp = segments[0] === '(app)';
      const inDriverApp = segments[0] === '(driver)';
      const inAdminApp = segments[0] === '(admin)';
      const inCollaboratorApp = segments[0] === '(collaborator)';

      console.log('🔐 Route check:', { 
        segments, 
        hasSession: !!session, 
        role,
        inAuthGroup,
        inOnboarding,
        inCustomerApp,
        inDriverApp,
        inAdminApp,
        inCollaboratorApp
      });

      // No session - redirect to login
      if (!session && !inAuthGroup && !inOnboarding) {
        console.log('🚫 No session, redirecting to login');
        router.replace('/(auth)/login');
        isChecking.current = false;
        return;
      }

      // Has session - handle role-based routing
      if (session) {
        // ADMIN ROUTING
        if (role === 'admin') {
          console.log('👑 Admin role confirmed - routing to admin dashboard');
          if (!inAdminApp) {
            console.log('➡️ Redirecting admin to /(admin)');
            router.replace('/(admin)');
          } else {
            console.log('✅ Admin already in admin app');
          }
          isChecking.current = false;
          return;
        }

        // COLLABORATOR ROUTING
        if (role === 'collaborator') {
          console.log('🏪 Collaborator role confirmed - routing to collaborator dashboard');
          if (!inCollaboratorApp) {
            console.log('➡️ Redirecting collaborator to /(collaborator)');
            router.replace('/(collaborator)');
          } else {
            console.log('✅ Collaborator already in collaborator app');
          }
          isChecking.current = false;
          return;
        }

        // DRIVER ROUTING - Skip onboarding completely
        if (role === 'driver') {
          console.log('🚗 Driver role confirmed - routing to driver app');
          if (!inDriverApp) {
            console.log('➡️ Redirecting driver to /(driver)');
            router.replace('/(driver)');
          } else {
            console.log('✅ Driver already in driver app');
          }
          isChecking.current = false;
          return;
        }

        // CUSTOMER ROUTING - Check onboarding
        if (role === 'customer') {
          console.log('👤 Customer role - checking onboarding status');
          
          // Load profile if not loaded
          if (!profile) {
            console.log('📥 Loading customer profile');
            await loadProfile(session.user.id);
          }
          
          const currentProfile = useUserStore.getState().profile;
          const hasCompletedOnboarding = currentProfile?.weight && 
                                         currentProfile?.height && 
                                         currentProfile?.age;
          
          console.log('📋 Onboarding status:', { hasCompletedOnboarding, profile: currentProfile });
          
          if (!hasCompletedOnboarding && !inOnboarding) {
            console.log('➡️ Redirecting to onboarding');
            router.replace('/onboarding');
          } else if (hasCompletedOnboarding && inOnboarding) {
            console.log('➡️ Onboarding complete, redirecting to customer app');
            router.replace('/(app)');
          } else if (hasCompletedOnboarding && !inCustomerApp && !inOnboarding) {
            console.log('➡️ Redirecting to customer app');
            router.replace('/(app)');
          }
        }
      }
      
      isChecking.current = false;
    };

    checkAuth();
  }, [session, isLoading, segments, profile, role]);

  return null;
}

export default function RootLayout() {
  const { loadSession } = useAuthStore();
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

  useEffect(() => {
    loadSession();
  }, []);

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
      </Stack>
    </SafeAreaProvider>
  );
}