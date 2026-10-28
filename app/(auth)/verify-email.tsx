import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AuthScreen } from '../../src/components/auth/AuthScreen';
import { BrandButton, SurfaceCard } from '../../src/components/v2';
import { supabase } from '../../src/lib/supabase';
import { isEmailVerified } from '../../src/navigation/routeDecision';
import { describeOutcome, resendVerificationEmail } from '../../src/services/authFlows';
import { useAuthStore } from '../../src/stores/authStore';
import { theme } from '../../src/theme';

const RESEND_COOLDOWN_S = 60;

// Shown after e-mail sign-up, when signing in with an unconfirmed address,
// and (through the routing policy) whenever a session belongs to an
// unconfirmed e-mail account. Nothing past this screen is reachable until
// Supabase reports the address confirmed.
export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string; sent?: string; expired?: string }>();
  const user = useAuthStore((s) => s.user);
  const email = (params.email ?? user?.email ?? '').toString();
  const [cooldown, setCooldown] = useState(params.sent === '1' ? RESEND_COOLDOWN_S : 0);
  const [status, setStatus] = useState<'sent' | 'pending' | 'expired'>(
    params.expired === '1' ? 'expired' : params.sent === '1' ? 'sent' : 'pending'
  );
  const [busy, setBusy] = useState<'resend' | 'check' | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!email) {
      router.replace('/(auth)/signup');
      return;
    }
    setBusy('resend');
    const outcome = await resendVerificationEmail(email);
    setBusy(null);
    if (outcome.kind === 'verification_sent') {
      setStatus('sent');
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    const text = describeOutcome(outcome);
    if (text) Alert.alert(text.title, text.message);
  };

  const checkVerified = async () => {
    if (!useAuthStore.getState().session) {
      // No session on this device (normal when confirmation is required):
      // the confirmed account signs in with its password.
      router.replace('/(auth)/login');
      return;
    }
    setBusy('check');
    const { data, error } = await supabase.auth.refreshSession();
    setBusy(null);
    if (!error && data.session && isEmailVerified(data.session.user as any)) {
      await useAuthStore.getState().adoptSession(data.session);
      router.replace('/');
      return;
    }
    Alert.alert('Adresse non confirmée', 'Ouvrez le lien reçu par e-mail, puis réessayez.');
  };

  const useAnotherAccount = async () => {
    if (useAuthStore.getState().session) await useAuthStore.getState().signOut();
    router.replace('/(auth)/welcome');
  };

  const message =
    status === 'expired'
      ? 'Ce lien de vérification a expiré ou a déjà été utilisé. Demandez-en un nouveau.'
      : status === 'sent'
        ? `Nous avons demandé l’envoi d’un lien de vérification à ${email}. Ouvrez-le sur ce téléphone pour continuer.`
        : `Votre adresse ${email} n’est pas encore confirmée. Ouvrez le lien reçu par e-mail pour continuer.`;

  return (
    <AuthScreen
      title="Vérifiez votre e-mail"
      subtitle="Vous devez confirmer votre adresse avant d’accéder à L’OPTION."
      footer={
        <TouchableOpacity onPress={useAnotherAccount} accessibilityRole="button">
          <Text style={styles.footerLink}>Utiliser un autre compte</Text>
        </TouchableOpacity>
      }
    >
      <SurfaceCard style={styles.card}>
        <View style={[styles.icon, status === 'expired' && styles.iconWarn]}>
          <Ionicons
            name={status === 'expired' ? 'time-outline' : 'mail-unread-outline'}
            size={28}
            color={status === 'expired' ? theme.colors.error : theme.colors.brand}
          />
        </View>
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
        <Text style={styles.hint}>Rien reçu ? Vérifiez vos courriers indésirables, puis renvoyez l’e-mail.</Text>
      </SurfaceCard>
      <BrandButton title="J’ai confirmé mon adresse" onPress={checkVerified} loading={busy === 'check'} />
      <BrandButton
        title={cooldown > 0 ? `Renvoyer l’e-mail (${cooldown} s)` : 'Renvoyer l’e-mail'}
        onPress={resend}
        variant="soft"
        loading={busy === 'resend'}
        disabled={cooldown > 0}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandSoft,
  },
  iconWarn: {
    backgroundColor: '#FDECEC',
  },
  message: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  hint: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
    textAlign: 'center',
  },
  footerLink: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.bold,
  },
});
