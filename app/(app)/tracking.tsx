import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { theme } from '../../src/theme';
import {
  ActivityIcon,
  Chip,
  FormMessage,
  IconButton,
  Screen,
  ScreenHeader,
  SectionHeader,
  SurfaceCard,
  formatNumber,
} from '../../src/components/v2';
import { ActivityOverview } from '../../src/components/tracking/ActivityOverview';
import { EnergyPlate } from '../../src/components/tracking/EnergyPlate';
import { NutritionOverview } from '../../src/components/tracking/NutritionOverview';
import { TrendChart, type TrendMetric } from '../../src/components/tracking/TrendChart';
import { movementState } from '../../src/activity/dailyBalance';
import { formatDistance, formatDuration } from '../../src/activity/gps';
import { energyLabel, KIND_GLYPH, KIND_LABEL, KIND_SHORT, WORKOUT_SOURCE_LABEL } from '../../src/activity/labels';
import type { WorkoutKind } from '../../src/activity/types';
import { dayLabel } from '../../src/nutrition/dates';
import { useActivityStore } from '../../src/stores/activityStore';
import { useTrackingStore } from '../../src/stores/trackingStore';
import { useWorkoutStore } from '../../src/stores/workoutStore';
import { SERVER_UPDATE_PENDING } from '../../src/lib/serverFeatures';

const KINDS: WorkoutKind[] = ['walk', 'run', 'cycle', 'gym'];
type Period = 'day' | 'week' | 'month';
const REFRESH_MS = 60_000;
const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// Daily Tracking ("Mon suivi"): the day's calorie balance, movement,
// workouts and meals, then trends by week or month. All values come from
// the server or the phone's sensors; nothing is invented, and estimates
// are labelled. Technical terms live behind the info buttons.
export default function TrackingScreen() {
  const { today, range, selected, days, meals, workouts, status, dayStatus, refresh, setRange, select } = useTrackingStore();
  const activity = useActivityStore();
  const activeWorkout = useWorkoutStore((s) => s.active);
  const [period, setPeriod] = useState<Period>(range === 30 ? 'month' : 'week');
  const [metric, setMetric] = useState<TrendMetric>('calories');

  useEffect(() => {
    activity.inspect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.source]);

  // On focus, and every minute while visible (the upload itself is
  // throttled by the activity store; the sensor batches on its own).
  useFocusEffect(
    useCallback(() => {
      refresh();
      const t = setInterval(() => refresh(), REFRESH_MS);
      return () => clearInterval(t);
    }, [refresh])
  );

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    if (p === 'week' && range !== 7) setRange(7);
    if (p === 'month' && range !== 30) setRange(30);
  };

  const day = days.find((d) => d.date === selected) ?? null;
  const preferred = activity.providers.find((p) => p.availability === 'available') ?? activity.providers[0] ?? null;
  const state = movementState(day, {
    today,
    now: new Date(),
    connected: activity.source,
    availability: activity.source ? 'available' : (preferred?.availability ?? null),
    permission: activity.permission,
  });
  const chartDays = period === 'month' ? days.slice(-30) : days.slice(-7);

  if (status === 'idle' || (status === 'loading' && days.length === 0)) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <ScreenHeader
        title="Mon suivi"
        subtitle={dayLabel(selected, today)}
        right={
          <View style={styles.headerButtons}>
            <IconButton icon="pulse-outline" label="Sources d’activité" onPress={() => router.push('/(app)/activity-connect')} />
            <IconButton icon="notifications-outline" label="Rappels" onPress={() => router.push('/(app)/nutrition-reminders')} />
          </View>
        }
      />

      {status === 'unavailable' ? (
        <View style={styles.section}>
          <FormMessage title="Suivi quotidien pas encore disponible" message={SERVER_UPDATE_PENDING} tone="info" actionLabel="Réessayer" onAction={() => refresh()} />
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.section}>
          {days.length > 0 ? (
            <FormMessage
              title="Hors connexion"
              message="Les dernières données reçues sont affichées. Vos séances et repas sont gardés sur le téléphone et envoyés au retour de la connexion."
              tone="info"
              actionLabel="Réessayer"
              onAction={() => refresh()}
            />
          ) : (
            <FormMessage
              title="Bilan indisponible"
              message="Impossible de charger votre suivi. Vérifiez votre connexion et réessayez."
              actionLabel="Réessayer"
              onAction={() => refresh()}
            />
          )}
        </View>
      ) : null}

      {days.length > 0 ? (
        <>
          <View style={styles.periods}>
            <Chip label="Jour" active={period === 'day'} onPress={() => choosePeriod('day')} />
            <Chip label="Semaine" active={period === 'week'} onPress={() => choosePeriod('week')} />
            <Chip label="Mois" active={period === 'month'} onPress={() => choosePeriod('month')} />
            {selected !== today ? <Chip label="Aujourd’hui" active={false} onPress={() => select(today)} /> : null}
          </View>

          {/* 1. Daily calorie balance */}
          <View style={styles.section}>
            <EnergyPlate
              day={day}
              title={selected === today ? 'Mes calories du jour' : `Calories · ${dayLabel(selected, today)}`}
              loading={status === 'loading'}
              onCompleteProfile={() => router.push('/(app)/nutrition-profile')}
            />
          </View>

          {/* 2. Active workout, prominent */}
          {activeWorkout ? (
            <View style={styles.section}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reprendre la séance en cours" onPress={() => router.push('/(app)/workout')}>
                <SurfaceCard style={styles.activeWorkout}>
                  <ActivityIcon name={KIND_GLYPH[activeWorkout.kind]} size={56} />
                  <View style={styles.activeText}>
                    <Text style={styles.activeTitle}>{`${KIND_LABEL[activeWorkout.kind]} ${activeWorkout.status === 'running' ? 'en cours' : 'en pause'}`}</Text>
                    <Text style={styles.hint}>
                      {activeWorkout.interrupted ? 'Séance interrompue : reprenez-la ou terminez-la' : 'Touchez pour voir le minuteur'}
                    </Text>
                  </View>
                </SurfaceCard>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 3. Activity overview */}
          <View style={styles.section}>
            <SectionHeader inset={false} title="Mouvement" />
            <ActivityOverview
              day={day}
              state={state}
              isToday={selected === today}
              connected={!!activity.source}
              permissionDenied={activity.permission === 'denied'}
              diagnostics={activity.diagnostics}
              lastSuccessAt={activity.lastSuccessAt}
              syncing={activity.syncing}
              onConnect={() => router.push('/(app)/activity-connect')}
              onSync={() => {
                void activity.sync({ force: true }).then(() => refresh({ sync: false }));
              }}
              onStartWalk={() => router.push({ pathname: '/(app)/workout', params: { kind: 'walk' } })}
            />
          </View>

          {/* 4. Workout shortcuts */}
          {!activeWorkout ? (
            <View style={styles.section}>
              <SectionHeader inset={false} title="Démarrer une séance" actionLabel="Historique" onAction={() => router.push('/(app)/workout-history')} />
              <View style={styles.kinds}>
                {KINDS.map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={styles.kind}
                    onPress={() => router.push({ pathname: '/(app)/workout', params: { kind: k } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Démarrer : ${KIND_LABEL[k]}`}
                  >
                    <ActivityIcon name={KIND_GLYPH[k]} size={60} />
                    <Text style={styles.kindLabel} numberOfLines={1}>
                      {KIND_SHORT[k]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {/* 5. Nutrition overview */}
          <View style={styles.section}>
            <SectionHeader inset={false} title="Repas" actionLabel="Détails" onAction={() => router.push('/(app)/nutrition')} />
            <NutritionOverview meals={meals} status={dayStatus} isToday={selected === today} onAddMeal={() => router.push('/(app)/log-meal')} />
          </View>

          {/* 6. The day's workouts */}
          {workouts.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader inset={false} title="Séances du jour" />
              <SurfaceCard style={styles.list}>
                {workouts.map((w, i) => (
                  <View key={w.id} style={[styles.workout, i > 0 && styles.border]}>
                    <ActivityIcon name={KIND_GLYPH[w.kind]} size={44} />
                    <View style={styles.activeText}>
                      <Text style={styles.workoutTitle}>
                        {`${KIND_LABEL[w.kind]} · ${formatDuration(w.activeSeconds)}${w.distanceM !== null ? ` · ${formatDistance(w.distanceM)}` : ''}`}
                      </Text>
                      <Text style={styles.hint}>
                        {w.duplicateOf
                          ? 'Même séance qu’une autre source : comptée une fois'
                          : w.energyKcal !== null
                            ? `${timeOf(w.startedAt)} · ${formatNumber(w.energyKcal)} kcal, ${energyLabel(w.energySource, w.source)}`
                            : `${timeOf(w.startedAt)} · ${WORKOUT_SOURCE_LABEL[w.source]}`}
                      </Text>
                    </View>
                  </View>
                ))}
              </SurfaceCard>
            </View>
          ) : null}

          {/* 7. Trends */}
          {period !== 'day' ? (
            <View style={styles.section}>
              <SectionHeader inset={false} title={period === 'month' ? '30 derniers jours' : '7 derniers jours'} />
              <SurfaceCard style={styles.trends}>
                <View style={styles.metrics}>
                  <Chip label="Calories" active={metric === 'calories'} onPress={() => setMetric('calories')} />
                  <Chip label="Pas" active={metric === 'steps'} onPress={() => setMetric('steps')} />
                  <Chip label="Séances" active={metric === 'minutes'} onPress={() => setMetric('minutes')} />
                </View>
                <TrendChart days={chartDays} metric={metric} today={today} onSelect={select} />
              </SurfaceCard>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  headerButtons: { flexDirection: 'row', gap: theme.spacing.sm },
  section: { paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.xl, gap: theme.spacing.md },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.lg },
  activeWorkout: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, borderWidth: 2, borderColor: theme.colors.workout },
  activeText: { flex: 1, minWidth: 0, gap: 2 },
  activeTitle: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  hint: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  kinds: { flexDirection: 'row', gap: theme.spacing.sm },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  kindLabel: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  list: { paddingVertical: theme.spacing.sm },
  workout: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.md },
  border: { borderTopWidth: 1, borderTopColor: theme.colors.hairline },
  workoutTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  trends: { gap: theme.spacing.md },
  metrics: { flexDirection: 'row', gap: theme.spacing.sm },
});
