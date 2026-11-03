// Movement of the day in four large tiles: steps, distance, active minutes,
// active calories. A value the phone did not measure is "—", never 0, and
// every state without data says what to do in one short line.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { ActivityIcon, BrandButton, SurfaceCard, formatNumber, type ActivityIconName } from '../v2';
import { formatDistance } from '../../activity/gps';
import type { DailyBalance, MovementState } from '../../activity/dailyBalance';

const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const STATE_TEXT: Partial<Record<MovementState, string>> = {
  unsupported: 'Cet appareil ne compte pas les pas. Enregistrez vos marches avec une séance.',
  needs_build: 'Le compteur de pas fonctionne dans l’application L’OPTION installée (pas dans Expo Go).',
  needs_install: 'Installez ou mettez à jour Health Connect, ou utilisez le compteur du téléphone.',
  not_connected: 'Comptez vos pas automatiquement avec votre téléphone, sans autre application.',
  denied: 'L’accès au mouvement est refusé. Autorisez-le dans les réglages du téléphone, ou enregistrez une séance.',
  not_synced: 'Pas encore de mesure pour ce jour.',
  no_data: 'Aucun pas mesuré ce jour-là.',
};

interface Props {
  day: DailyBalance | null;
  state: MovementState;
  isToday: boolean;
  connected: boolean; // a source is connected on this device
  lastSuccessAt: string | null;
  syncing: boolean;
  onConnect: () => void;
  onSync: () => void;
  onStartWalk: () => void;
}

export function ActivityOverview({ day, state, isToday, connected, lastSuccessAt, syncing, onConnect, onSync, onStartWalk }: Props) {
  const hasData = state === 'partial' || state === 'complete' || state === 'stale';
  const steps = hasData ? (day?.steps ?? null) : null;
  const distance = hasData ? (day?.walkDistanceM ?? null) : null;
  const minutes = day?.activeMinutes ?? 0;
  const activeKcal = day?.activityKcal ?? null;

  return (
    <SurfaceCard style={styles.card}>
      <View style={styles.grid}>
        <Tile icon="steps" label="Pas" value={steps === null ? '—' : formatNumber(steps)} hint="Combien vous avez marché" />
        <Tile
          icon="distance"
          label="Distance"
          value={distance === null ? '—' : (formatDistance(distance) ?? '—')}
          hint={day?.walkDistanceEstimated ? 'Estimée d’après vos pas' : 'Distance parcourue'}
        />
        <Tile icon="time" label="Minutes actives" value={`${minutes} min`} hint="Pendant vos séances" />
        <Tile
          icon="calories"
          label="Calories actives"
          value={activeKcal === null ? '—' : `${formatNumber(activeKcal)} kcal`}
          hint="Estimées pendant le mouvement"
        />
      </View>

      {STATE_TEXT[state] ? <Text style={styles.state}>{STATE_TEXT[state]}</Text> : null}
      {state === 'not_connected' || state === 'needs_install' ? <BrandButton title="Activer le compteur de pas" onPress={onConnect} /> : null}
      {state === 'unsupported' || state === 'denied' ? <BrandButton title="Démarrer une marche" variant="soft" onPress={onStartWalk} /> : null}
      {isToday && connected && (hasData || state === 'not_synced') ? (
        <View style={styles.syncRow}>
          <Text style={styles.sync}>
            {lastSuccessAt ? `Dernière mise à jour : ${timeOf(lastSuccessAt)}` : 'Pas encore synchronisé'}
            {state === 'stale' ? ' · données anciennes' : ''}
          </Text>
          <BrandButton title={syncing ? 'Mise à jour…' : 'Actualiser'} variant="soft" onPress={onSync} loading={syncing} style={styles.syncButton} />
        </View>
      ) : null}
    </SurfaceCard>
  );
}

function Tile({ icon, label, value, hint }: { icon: ActivityIconName; label: string; value: string; hint: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label} : ${value}. ${hint}`}>
      <ActivityIcon name={icon} size={52} />
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: theme.spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.spacing.lg },
  tile: { width: '50%', alignItems: 'flex-start', gap: 2, paddingRight: theme.spacing.sm },
  value: {
    marginTop: theme.spacing.sm,
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
  },
  label: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  hint: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted },
  state: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.ink },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  sync: { flex: 1, fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted },
  syncButton: { paddingHorizontal: theme.spacing.lg },
});
