import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import type { DailyBalance, MovementState } from '../../activity/dailyBalance';
import { formatDistance } from '../../activity/gps';
import { ACTIVITY_SOURCE_SHORT } from '../../activity/labels';
import { BrandButton } from './BrandButton';
import { SurfaceCard } from './SurfaceCard';
import { formatNumber } from './format';

interface MovementCardProps {
  day: DailyBalance | null;
  state: MovementState;
  syncing?: boolean;
  onConnect: () => void;
  onSync: () => void;
}

const MESSAGE: Record<MovementState, { title: string; text: string } | null> = {
  unsupported: { title: 'Activité non disponible ici', text: 'Les pas et l’énergie active se lisent depuis l’application mobile (Apple Santé ou Health Connect).' },
  needs_build: {
    title: 'Version de l’application requise',
    text: 'Cette version ne peut pas lire les données santé (par exemple Expo Go). Installez la version L’OPTION de l’App Store ou de Google Play.',
  },
  needs_install: { title: 'Health Connect requis', text: 'Installez ou mettez à jour Health Connect pour partager vos pas et votre activité.' },
  not_connected: { title: 'Connectez votre activité', text: 'Vos pas, votre distance et votre énergie active, depuis la plateforme santé de votre téléphone. Facultatif.' },
  denied: { title: 'Accès refusé', text: 'L’accès à vos données d’activité a été refusé. Vous pouvez l’autoriser dans les réglages.' },
  not_synced: { title: 'Pas encore synchronisé', text: 'Aucune donnée d’activité reçue pour ce jour.' },
  no_data: {
    title: 'Aucune donnée pour ce jour',
    text: 'Votre plateforme santé n’a rien transmis. Si vous avez refusé l’accès, autorisez L’OPTION dans ses réglages (Santé › Partage › Apps).',
  },
  stale: null,
  partial: null,
  complete: null,
};

// Steps, distance and active energy of one day, with their source and sync
// time. A measured zero is shown as 0; no data is said in words.
export const MovementCard: React.FC<MovementCardProps> = ({ day, state, syncing, onConnect, onSync }) => {
  const msg = MESSAGE[state];
  const hasValues = state === 'partial' || state === 'complete' || state === 'stale';
  return (
    <SurfaceCard style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="footsteps-outline" size={20} color={theme.colors.brand} />
        <Text style={styles.title}>Mouvement</Text>
        {day?.activitySource ? <Text style={styles.source}>{ACTIVITY_SOURCE_SHORT[day.activitySource]}</Text> : null}
      </View>

      {hasValues && day ? (
        <>
          <View style={styles.metrics}>
            <Metric value={day.steps === null ? '—' : formatNumber(day.steps)} label="pas" />
            <Metric value={formatDistance(day.distanceM) ?? '—'} label={day.activitySource === 'apple_health' ? 'marche et course' : 'distance'} />
            <Metric value={day.activeKcal === null ? '—' : formatNumber(day.activeKcal)} label="kcal actives" />
          </View>
          <Text style={styles.meta}>
            {state === 'stale'
              ? `Données du ${timeLabel(day.syncedAt)} : synchronisez pour les mettre à jour.`
              : state === 'partial'
                ? `En cours de journée · synchronisé à ${timeLabel(day.syncedAt)}`
                : 'Journée complète · valeurs mesurées par votre plateforme santé'}
          </Text>
          {state === 'stale' ? <BrandButton title="Synchroniser" variant="soft" onPress={onSync} loading={syncing} /> : null}
        </>
      ) : msg ? (
        <View style={styles.message}>
          <Text style={styles.msgTitle}>{msg.title}</Text>
          <Text style={styles.msgText}>{msg.text}</Text>
          {state === 'not_connected' || state === 'denied' || state === 'needs_install' || state === 'no_data' ? (
            <BrandButton title={state === 'not_connected' ? 'Connecter' : 'Gérer la connexion'} variant="soft" onPress={onConnect} />
          ) : state === 'not_synced' ? (
            <BrandButton title="Synchroniser" variant="soft" onPress={onSync} loading={syncing} />
          ) : null}
        </View>
      ) : null}
    </SurfaceCard>
  );
};

function timeLabel(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  source: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brand,
  },
  metrics: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  metric: {
    flex: 1,
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.canvas,
  },
  metricValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
  },
  meta: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  message: {
    gap: theme.spacing.sm,
  },
  msgTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  msgText: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
});
