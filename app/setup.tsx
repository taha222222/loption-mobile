import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteGate } from '../src/components/navigation/RouteGate';
import { BrandButton, IconBadge, StepProgress, SurfaceCard } from '../src/components/v2';
import { DeliveryAddressForm } from '../src/components/checkout/DeliveryAddressForm';
import { fetchServedCities, notServedMessage } from '../src/delivery/cities';
import { notificationService } from '../src/services/notificationService';
import {
  getLocationPermission,
  getNotificationPermission,
  openAppSettings,
  PermissionState,
  requestNotificationPermission,
} from '../src/services/permissions';
import { useAuthStore } from '../src/stores/authStore';
import { useSetupStore } from '../src/stores/setupStore';
import { useUserStore } from '../src/stores/userStore';
import { theme } from '../src/theme';

export default function SetupRoute() {
  return (
    <RouteGate group="setup">
      <SetupScreen />
    </RouteGate>
  );
}

// After onboarding: explain, then ask for notifications and location. Both
// are optional; declining never blocks access to the app.
function SetupScreen() {
  const [step, setStep] = useState<'notifications' | 'location'>('notifications');
  const user = useAuthStore((s) => s.user);
  const markDone = useSetupStore((s) => s.markDone);

  const toLocation = useCallback(() => setStep('location'), []);
  const finish = useCallback(() => {
    if (user) markDone(user.id); // the routing policy then opens the home screen
  }, [user, markDone]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <StepProgress step={step === 'notifications' ? 1 : 2} total={2} />
      </View>
      {step === 'notifications' ? (
        <NotificationsStep onDone={toLocation} />
      ) : (
        <LocationStep onDone={finish} />
      )}
    </SafeAreaView>
  );
}

function NotificationsStep({ onDone }: { onDone: () => void }) {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<PermissionState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getNotificationPermission().then((current) => {
      // Already allowed on this device: nothing to explain or ask.
      if (current === 'granted') onDone();
      else setState(current);
    });
  }, [onDone]);

  const enable = async () => {
    setBusy(true);
    const result = await requestNotificationPermission();
    setState(result);
    if (result === 'granted' && user) {
      const token = await notificationService.registerForPushNotificationsAsync();
      if (token) await notificationService.savePushToken(user.id, token, 'customer');
    }
    setBusy(false);
    if (result === 'granted') onDone();
  };

  return (
    <StepLayout
      icon="notifications-outline"
      title="Restez informé de vos commandes"
      intro="Activez les notifications pour savoir où en est votre repas."
      points={[
        'Confirmation et préparation de votre commande',
        'Départ du livreur et livraison',
        'Messages importants concernant votre compte',
      ]}
      footer={
        state === 'granted' ? (
          <BrandButton title="Continuer" onPress={onDone} />
        ) : state === 'blocked' || state === 'denied' ? (
          <>
            <BlockedNote kind="notifications" blocked={state === 'blocked'} />
            {state === 'denied' ? <BrandButton title="Réessayer" onPress={enable} loading={busy} /> : null}
            <BrandButton title="Ouvrir les réglages" variant="soft" onPress={openAppSettings} />
            <SkipButton label="Continuer sans notifications" onPress={onDone} />
          </>
        ) : (
          <>
            <BrandButton title="Activer les notifications" onPress={enable} loading={busy} disabled={state === null} />
            <SkipButton label="Plus tard" onPress={onDone} />
          </>
        )
      }
    />
  );
}

function LocationStep({ onDone }: { onDone: () => void }) {
  const profile = useUserStore((s) => s.profile);
  const [state, setState] = useState<PermissionState | null>(null);
  const [phase, setPhase] = useState<'explain' | 'address'>('explain');
  const [start, setStart] = useState<'locate' | 'manual'>('manual');
  const [served, setServed] = useState<string[] | null>(null);
  const [notServed, setNotServed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchServedCities().then((list) => !cancelled && setServed(list));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasAddress = !!profile?.delivery_address;
  useEffect(() => {
    // A confirmed delivery address already exists: this step has nothing to add.
    if (hasAddress) onDone();
    else getLocationPermission().then(setState);
  }, [hasAddress, onDone]);

  // Saved in any case; outside the served cities the customer is told now,
  // not at checkout. (No list from the server: nothing is promised.)
  const saved = (city: string) => {
    if (served && !served.includes(city)) {
      setNotServed(notServedMessage(city));
      return;
    }
    onDone();
  };

  if (notServed) {
    return (
      <StepLayout
        icon="location-outline"
        title="Pas encore dans votre ville"
        intro={notServed}
        points={[]}
        footer={<BrandButton title="Continuer" onPress={onDone} />}
      />
    );
  }

  if (phase === 'address') {
    return <DeliveryAddressForm start={start} onSaved={saved} footerExtra={<SkipButton label="Plus tard" onPress={onDone} />} />;
  }

  const open = (how: 'locate' | 'manual') => {
    setStart(how);
    setPhase('address');
  };

  return (
    <StepLayout
      icon="location-outline"
      title="Où livrer vos repas ?"
      intro="Votre position nous aide à préparer votre livraison. Elle n’est utilisée que lorsque vous l’autorisez."
      points={[
        'Proposer votre adresse de livraison',
        'Aider notre équipe à repérer votre zone de livraison',
        'Mieux estimer le délai de livraison, lorsque ce sera disponible',
      ]}
      footer={
        <>
          {state === 'granted' ? (
            <BrandButton title="Utiliser ma position" onPress={() => open('locate')} />
          ) : state === 'blocked' ? null : (
            <BrandButton title="Autoriser la localisation" onPress={() => open('locate')} disabled={state === null} />
          )}
          <BrandButton title="Saisir mon adresse" variant="soft" onPress={() => open('manual')} />
          {state === 'blocked' ? <BlockedNote kind="location" blocked /> : null}
          <SkipButton label="Plus tard" onPress={onDone} />
        </>
      }
    />
  );
}

function StepLayout({
  icon,
  title,
  intro,
  points,
  footer,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  intro: string;
  points: string[];
  footer: React.ReactNode;
}) {
  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconBadge icon={icon} size={56} />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.intro}>{intro}</Text>
        <SurfaceCard style={styles.points}>
          {points.map((p) => (
            <View key={p} style={styles.point}>
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
              <Text style={styles.pointText}>{p}</Text>
            </View>
          ))}
        </SurfaceCard>
      </ScrollView>
      <View style={styles.actions}>{footer}</View>
    </View>
  );
}

function BlockedNote({ kind, blocked }: { kind: 'notifications' | 'location'; blocked: boolean }) {
  const what = kind === 'notifications' ? 'les notifications' : 'la localisation';
  return (
    <SurfaceCard style={styles.blocked}>
      <Ionicons name="information-circle-outline" size={20} color={theme.colors.inkMuted} />
      <Text style={styles.blockedText}>
        {blocked
          ? `Vous avez refusé ${what}. Pour les activer plus tard : Réglages du téléphone › L’OPTION › ${
              kind === 'notifications' ? 'Notifications' : 'Position'
            }.`
          : `Vous avez refusé ${what}. Vous pouvez réessayer ou continuer sans.`}
      </Text>
    </SurfaceCard>
  );
}

function SkipButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" style={styles.skip}>
      <Text style={styles.skipText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
  },
  fill: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing['2xl'],
    paddingBottom: theme.spacing['2xl'],
    gap: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    lineHeight: theme.typography.lineHeights['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.5,
  },
  intro: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.inkMuted,
  },
  points: {
    gap: theme.spacing.md,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  pointText: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.ink,
  },
  blocked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  blockedText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  actions: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  skip: {
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
  },
  skipText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.inkMuted,
    fontWeight: theme.typography.weights.semibold,
  },
});
