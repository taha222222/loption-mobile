import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { BrandButton } from '../src/components/v2';
import { completeAuthFromUrl, describeOutcome } from '../src/services/authFlows';
import { useAuthStore } from '../src/stores/authStore';
import { theme } from '../src/theme';

// Web: lets the OAuth popup hand its result back to the opener.
WebBrowser.maybeCompleteAuthSession();

// Target of OAuth redirects and e-mail verification links
// (loption://auth-callback?code=...). Exchanges the one-time code, then hands
// over to the routing policy.
export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const [message, setMessage] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    if (!url) return;
    let active = true;
    completeAuthFromUrl(url).then((outcome) => {
      if (!active) return;
      if (outcome.kind === 'signed_in') {
        router.replace('/');
        return;
      }
      // The same redirect can already have been handled by the auth session.
      if (useAuthStore.getState().session && outcome.kind !== 'link_expired') {
        router.replace('/');
        return;
      }
      if (outcome.kind === 'link_expired') {
        router.replace({ pathname: '/(auth)/verify-email', params: { expired: '1' } });
        return;
      }
      setMessage(describeOutcome(outcome) ?? { title: 'Connexion annulée', message: 'Vous pouvez réessayer.' });
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (!message) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
        <Text style={styles.body}>Connexion en cours…</Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{message.title}</Text>
      <Text style={styles.body}>{message.message}</Text>
      <BrandButton title="Continuer" onPress={() => router.replace('/(auth)/welcome')} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.canvas,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  body: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.inkMuted,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: theme.spacing.lg,
  },
});
