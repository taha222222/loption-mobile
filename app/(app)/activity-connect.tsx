import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { BrandButton, confirmAction, FormMessage, IconButton, Screen, ScreenHeader, SectionHeader, SurfaceCard } from '../../src/components/v2';
import { PROVIDER_LABEL, PROVIDER_SCOPE, providerById } from '../../src/activity/providers';
import type { ActivitySource, ProviderAvailability } from '../../src/activity/types';
import { useActivityStore } from '../../src/stores/activityStore';

const AVAILABILITY_TEXT: Record<ProviderAvailability, string | null> = {
  available: null,
  unsupported: 'Non disponible sur cet appareil.',
  needs_native_build: 'Nécessite l’application L’OPTION installée (pas Expo Go).',
  needs_install: 'Health Connect n’est pas installé.',
  needs_update: 'Health Connect doit être mis à jour.',
};

const at = (iso: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

// Where steps come from. The phone's own step sensor is the default (no
// health app needed); Apple Health / Health Connect are optional. Read-only,
// minimum data, the app stays usable without any of them, and disconnecting
// can delete everything that was imported.
export default function ActivityConnectScreen() {
  const { source, providers, permission, lastSync, syncing, inspect, connect, disconnect, sync } = useActivityStore();
  const [busy, setBusy] = useState<ActivitySource | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ title: string; text: string; tone: 'error' | 'info' } | null>(null);

  useEffect(() => {
    inspect();
  }, [inspect, source]);

  const onConnect = async (id: ActivitySource) => {
    setBusy(id);
    setMessage(null);
    const result = await connect(id);
    setBusy(null);
    if (result === 'denied' || result === 'not_requested') {
      setMessage({
        title: 'Accès non accordé',
        text: 'L’application reste utilisable sans ces données. Vous pouvez autoriser l’accès plus tard dans les réglages.',
        tone: 'info',
      });
    } else if (result === 'requested') {
      setMessage({
        title: 'Accès demandé',
        text: 'Apple ne dit pas aux applications ce que vous avez autorisé. Si aucune donnée n’apparaît, ouvrez Santé › Partage › Apps › L’OPTION.',
        tone: 'info',
      });
    } else if (result === 'partial') {
      setMessage({ title: 'Accès partiel', text: 'Certaines données ne sont pas autorisées : elles seront affichées comme indisponibles.', tone: 'info' });
    }
  };

  const onDisconnect = (deleteImported: boolean) => {
    const run = async () => {
      setBusy('disconnect');
      const r = await disconnect({ deleteImported });
      setBusy(null);
      setMessage(
        r.ok
          ? { title: 'Déconnecté', text: deleteImported ? 'Les données importées ont été supprimées de votre compte.' : 'La synchronisation est arrêtée.', tone: 'info' }
          : { title: 'Action impossible', text: 'Vérifiez votre connexion et réessayez.', tone: 'error' }
      );
    };
    if (deleteImported) {
      confirmAction(
        'Supprimer les données importées ?',
        'Les pas, distances, énergies et séances importés de cette source seront supprimés de votre compte L’OPTION. Vos séances enregistrées dans l’application sont conservées.',
        'Supprimer',
        run
      );
    } else run();
  };

  const openSettings = () => {
    const p = providerById(source);
    if (p?.openSettings) p.openSettings();
    else Linking.openSettings().catch(() => {});
  };

  return (
    <Screen scroll>
      <ScreenHeader title="Compter mes pas" subtitle="Sources d’activité" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />

      <View style={styles.section}>
        <SurfaceCard style={styles.card}>
          <Text style={styles.lead}>Pourquoi ?</Text>
          <Text style={styles.text}>
            Pour voir vos pas et votre distance, et adapter votre objectif du jour à ce que vous bougez vraiment. Facultatif : sans accès, vous
            pouvez toujours enregistrer vos marches et séances à la main.
          </Text>
          <Text style={styles.lead}>Application fermée ?</Text>
          <Text style={styles.text}>iPhone : le téléphone compte vos pas en permanence ; L’OPTION lit les 7 derniers jours quand vous l’ouvrez.</Text>
          <Text style={styles.text}>
            Android : le capteur compte vos pas en permanence ; L’OPTION note le compteur environ toutes les 15 minutes (Android peut retarder
            cette lecture en économie d’énergie). Après un redémarrage, les pas faits depuis la dernière lecture ne sont pas connus.
          </Text>
          <Text style={styles.text}>Vos données restent privées : elles ne sont ni partagées ni publiées.</Text>
        </SurfaceCard>
      </View>

      {source ? (
        <View style={styles.section}>
          <SectionHeader inset={false} title="Connecté" />
          <SurfaceCard style={styles.card}>
            <Text style={styles.provider}>{PROVIDER_LABEL[source]}</Text>
            <Text style={styles.text}>{PROVIDER_SCOPE[source]}</Text>
            <Text style={styles.meta}>
              {lastSync
                ? lastSync.status === 'ok'
                  ? `Dernière synchronisation : ${at(lastSync.at)}${lastSync.withData === 0 ? ' — aucune donnée reçue' : ''}`
                  : `Dernière tentative (${at(lastSync.at)}) : ${
                      lastSync.status === 'network_error' ? 'pas de connexion' : lastSync.status === 'provider_error' ? 'lecture impossible' : 'refusée par le serveur'
                    }`
                : 'Pas encore synchronisé.'}
            </Text>
            {permission === 'denied' || permission === 'partial' || (lastSync?.status === 'ok' && lastSync.withData === 0) ? (
              <BrandButton title="Ouvrir les réglages d’accès" variant="soft" onPress={openSettings} />
            ) : null}
            <BrandButton title="Synchroniser maintenant" variant="soft" onPress={() => sync()} loading={syncing} />
            <BrandButton title="Déconnecter" variant="soft" onPress={() => onDisconnect(false)} loading={busy === 'disconnect'} />
            <BrandButton title="Déconnecter et supprimer les données importées" variant="soft" onPress={() => onDisconnect(true)} />
          </SurfaceCard>
        </View>
      ) : (
        <View style={styles.section}>
          <SectionHeader inset={false} title="Sources disponibles" />
          {providers.length === 0 ? (
            <FormMessage
              title="Aucune source sur cet appareil"
              message="Le compteur de pas fonctionne dans l’application mobile L’OPTION (iPhone et Android). Vous pouvez enregistrer vos séances à la main."
              tone="info"
            />
          ) : (
            providers.map((p) => (
              <SurfaceCard key={p.id} style={styles.card}>
                <Text style={styles.provider}>{PROVIDER_LABEL[p.id]}</Text>
                <Text style={styles.text}>{PROVIDER_SCOPE[p.id]}</Text>
                {AVAILABILITY_TEXT[p.availability] ? <Text style={styles.meta}>{AVAILABILITY_TEXT[p.availability]}</Text> : null}
                {p.availability === 'available' ? (
                  <BrandButton
                    title={p.id === 'device_motion' ? 'Activer le compteur de pas' : `Connecter ${PROVIDER_LABEL[p.id]}`}
                    variant={p.id === 'device_motion' ? 'solid' : 'soft'}
                    onPress={() => onConnect(p.id)}
                    loading={busy === p.id}
                  />
                ) : p.availability === 'needs_install' || p.availability === 'needs_update' ? (
                  <BrandButton
                    title="Ouvrir Google Play"
                    variant="soft"
                    onPress={() => Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() => {})}
                  />
                ) : null}
              </SurfaceCard>
            ))
          )}
        </View>
      )}

      {message ? (
        <View style={styles.section}>
          <FormMessage title={message.title} message={message.text} tone={message.tone} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  card: {
    gap: theme.spacing.sm,
  },
  lead: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  provider: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  text: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  meta: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
});
