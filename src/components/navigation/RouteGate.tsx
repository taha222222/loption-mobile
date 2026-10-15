import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../../theme';
import { useRouteDecision } from '../../navigation/useRouteDecision';
import { useAuthStore } from '../../stores/authStore';
import { useUserStore } from '../../stores/userStore';

interface RouteGateProps {
  // Route group this subtree belongs to, e.g. '(app)' or 'onboarding'.
  group: string;
  children: React.ReactNode;
}

// Renders children only once the routing policy allows this group for the
// current user. Redirects are performed by the root layout; until then this
// shows a neutral loading/error screen, so no role's screens (or their data
// fetches) mount for the wrong or not-yet-resolved user.
export function RouteGate({ group, children }: RouteGateProps) {
  const decision = useRouteDecision(group);
  if (decision.kind === 'allow') return <>{children}</>;
  if (decision.kind === 'error') return <AuthErrorScreen reason={decision.reason} />;
  return <AuthLoadingScreen />;
}

export function AuthLoadingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.colors.gold} />
    </View>
  );
}

function AuthErrorScreen({ reason }: { reason: 'role' | 'profile' }) {
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    const userId = useAuthStore.getState().user?.id;
    if (reason === 'role') {
      await useAuthStore.getState().retryRoleResolution();
    } else if (userId) {
      await useUserStore.getState().loadProfile(userId);
    }
    setBusy(false);
  };

  const signOut = async () => {
    setBusy(true);
    const { error } = await useAuthStore.getState().signOut();
    setBusy(false);
    if (error) Alert.alert('Sign out failed', 'Check your connection and try again.');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>We couldn&apos;t load your account</Text>
      <Text style={styles.body}>Check your connection and try again.</Text>
      {busy ? (
        <ActivityIndicator color={theme.colors.gold} />
      ) : (
        <>
          <TouchableOpacity style={styles.button} onPress={retry}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.link}>Sign out</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.background,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textDark,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  button: {
    backgroundColor: theme.colors.gold,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginBottom: theme.spacing.md,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  link: {
    color: theme.colors.textLight,
    fontSize: 14,
  },
});
