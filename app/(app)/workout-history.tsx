import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { confirmAction, EmptyState, FormMessage, IconButton, Screen, ScreenHeader, SurfaceCard, formatNumber } from '../../src/components/v2';
import { formatDistance, formatDuration, formatPace, paceSecondsPerKm, speedKmh } from '../../src/activity/gps';
import { energyLabel, KIND_ICON, KIND_LABEL, WORKOUT_SOURCE_LABEL } from '../../src/activity/labels';
import { dayLabel, deviceTimeZone, localDate } from '../../src/nutrition/dates';
import type { WorkoutRecord } from '../../src/services/workoutApi';
import { useWorkoutStore } from '../../src/stores/workoutStore';

const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// Sessions of the last 30 days, recorded here or imported from the health
// platform. A session recorded twice (here and by a watch) is shown once as
// counted and once as a duplicate.
export default function WorkoutHistoryScreen() {
  const { history, historyStatus, loadHistory, remove, pending, flush } = useWorkoutStore();

  useFocusEffect(
    useCallback(() => {
      flush().then(() => loadHistory(30));
    }, [flush, loadHistory])
  );

  const today = localDate(deviceTimeZone());
  const byDay = new Map<string, WorkoutRecord[]>();
  for (const w of history) byDay.set(w.localDate, [...(byDay.get(w.localDate) ?? []), w]);

  const askRemove = (w: WorkoutRecord) =>
    confirmAction('Supprimer cette séance ?', `${KIND_LABEL[w.kind]} du ${dayLabel(w.localDate, today).toLowerCase()}`, 'Supprimer', () => {
      remove(w.id);
    });

  return (
    <Screen scroll>
      <ScreenHeader title="Séances" subtitle="30 derniers jours" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />

      {pending.length > 0 ? (
        <View style={styles.section}>
          <FormMessage
            title={`${pending.length} séance${pending.length > 1 ? 's' : ''} en attente d’envoi`}
            message="Gardée(s) sur l’appareil ; l’envoi reprend automatiquement."
            tone="info"
            actionLabel="Réessayer"
            onAction={() => flush().then(() => loadHistory(30))}
          />
        </View>
      ) : null}

      {historyStatus === 'loading' ? (
        <ActivityIndicator style={styles.loading} color={theme.colors.brand} />
      ) : historyStatus === 'error' ? (
        <View style={styles.section}>
          <FormMessage title="Historique indisponible" message="Vérifiez votre connexion." actionLabel="Réessayer" onAction={() => loadHistory(30)} />
        </View>
      ) : history.length === 0 ? (
        <EmptyState
          icon="walk-outline"
          title="Aucune séance"
          message="Vos marches, courses, sorties à vélo et séances de sport apparaîtront ici."
          actionLabel="Démarrer une séance"
          onAction={() => router.push('/(app)/workout')}
        />
      ) : (
        [...byDay.entries()].map(([day, sessions]) => (
          <View key={day} style={styles.section}>
            <Text style={styles.day}>{dayLabel(day, today)}</Text>
            <SurfaceCard style={styles.list}>
              {sessions.map((w, i) => (
                <WorkoutRow key={w.id} w={w} first={i === 0} onRemove={w.source === 'app' ? () => askRemove(w) : undefined} />
              ))}
            </SurfaceCard>
          </View>
        ))
      )}
    </Screen>
  );
}

function WorkoutRow({ w, first, onRemove }: { w: WorkoutRecord; first: boolean; onRemove?: () => void }) {
  const pace = w.kind === 'walk' || w.kind === 'run' ? formatPace(paceSecondsPerKm(w.distanceM, w.activeSeconds)) : null;
  const speed = w.kind === 'cycle' ? speedKmh(w.distanceM, w.activeSeconds) : null;
  const parts = [
    `${timeOf(w.startedAt)} · ${formatDuration(w.activeSeconds)}`,
    formatDistance(w.distanceM),
    pace,
    speed !== null ? `${String(speed).replace('.', ',')} km/h` : null,
  ].filter(Boolean);
  return (
    <View style={[styles.row, !first && styles.rowBorder, w.duplicateOf && styles.duplicate]}>
      <View style={styles.icon}>
        <Ionicons name={KIND_ICON[w.kind] as any} size={20} color={theme.colors.brand} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{`${KIND_LABEL[w.kind]} · ${WORKOUT_SOURCE_LABEL[w.source]}`}</Text>
        <Text style={styles.rowMeta}>{parts.join(' · ')}</Text>
        <Text style={styles.rowMeta}>
          {w.energyKcal !== null ? `${formatNumber(w.energyKcal)} kcal — ${energyLabel(w.energySource, w.source)}` : 'Calories indisponibles'}
        </Text>
        {w.duplicateOf ? <Text style={styles.dupNote}>Même séance enregistrée par une autre source : comptée une seule fois.</Text> : null}
      </View>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Supprimer ${KIND_LABEL[w.kind]}`} hitSlop={8}>
          <Ionicons name="trash-outline" size={20} color={theme.colors.inkMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  loading: {
    marginTop: theme.spacing['3xl'],
  },
  day: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.inkMuted,
    textTransform: 'capitalize',
  },
  list: {
    paddingVertical: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  duplicate: {
    opacity: 0.6,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandSoft,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  rowMeta: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  dupNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
    fontStyle: 'italic',
  },
});
