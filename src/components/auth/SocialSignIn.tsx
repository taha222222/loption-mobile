import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FormMessage, ProviderButton } from '../v2';
import { fetchAuthProviderSettings, OAuthProvider } from '../../services/authProviders';
import { AuthOutcome, describeOutcome, signInWithApple, signInWithGoogle } from '../../services/authFlows';
import { theme } from '../../theme';

type Availability = 'unknown' | 'enabled' | 'disabled';

// Google and Apple buttons. A provider the Supabase project has not enabled
// stays visible with a "not configured yet" note and explains itself when
// pressed; nothing crashes and e-mail sign-in keeps working.
export function SocialSignIn() {
  const [availability, setAvailability] = useState<Record<OAuthProvider, Availability>>({
    google: 'unknown',
    apple: 'unknown',
  });
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthProviderSettings().then((result) => {
      if (!active || result.status !== 'loaded') return;
      setAvailability({
        google: result.settings.google ? 'enabled' : 'disabled',
        apple: result.settings.apple ? 'enabled' : 'disabled',
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const handleOutcome = (outcome: AuthOutcome) => {
    if (outcome.kind === 'signed_in') {
      // The root layout routes to onboarding or home once the account is ready.
      router.replace('/');
      return;
    }
    if (outcome.kind === 'not_configured' && outcome.provider !== 'email') {
      setAvailability((a) => ({ ...a, [outcome.provider]: 'disabled' }));
    }
    setNotice(describeOutcome(outcome));
  };

  const run = async (provider: OAuthProvider) => {
    if (availability[provider] === 'disabled') {
      handleOutcome({ kind: 'not_configured', provider });
      return;
    }
    setBusy(provider);
    setNotice(null);
    const outcome = provider === 'google' ? await signInWithGoogle() : await signInWithApple();
    setBusy(null);
    handleOutcome(outcome);
  };

  const note = (provider: OAuthProvider) =>
    availability[provider] === 'disabled' ? 'Pas encore configuré' : undefined;

  return (
    <View style={styles.wrap}>
      <ProviderButton
        provider="apple"
        onPress={() => run('apple')}
        loading={busy === 'apple'}
        disabled={busy !== null && busy !== 'apple'}
        note={note('apple')}
      />
      <ProviderButton
        provider="google"
        onPress={() => run('google')}
        loading={busy === 'google'}
        disabled={busy !== null && busy !== 'google'}
        note={note('google')}
      />
      {notice ? <FormMessage title={notice.title} message={notice.message} tone="info" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: theme.spacing.md,
  },
});
