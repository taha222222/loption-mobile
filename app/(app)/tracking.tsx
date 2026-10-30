import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import {
  BrandButton,
  Chip,
  DailyBalanceCard,
  FormMessage,
  IconButton,
  MovementCard,
  Screen,
  ScreenHeader,
  SectionHeader,
  SurfaceCard,
  WeeklyBalanceChart,
  formatNumber,
} from '../../src/components/v2';
import { METHOD_EXPLAINED, movementState, weekTotals } from '../../src/activity/dailyBalance';
import { formatDuration } from '../../src/activity/gps';
import { energyLabel, KIND_ICON, KIND_LABEL, WORKOUT_SOURCE_LABEL } from '../../src/activity/labels';
import type { WorkoutKind } from '../../src/activity/types';
import { dayLabel } from '../../src/nutrition/dates';
import { formatServings } from '../../src/nutrition/tracking';
import { useActivityStore } from '../../src/stores/activityStore';
import { useTrackingStore } from '../../src/stores/trackingStore';
import { useWorkoutStore } from '../../src/stores/workoutStore';

const KINDS: WorkoutKind[] = ['walk', 'run', 'cycle', 'gym'];
const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// Daily Tracking tab ("L’OPTION Daily Balance"): today's (or a chosen
// day's) energy budget, meals eaten, movement and workouts, and the trend
// over 7 or 30 days. All values come from the server; nothing is invented.
export default function TrackingScreen() {
  const { today, range, selected, days, meals, workouts, status, dayStatus, refresh, setRange, select } = useTrackingStore();
  const activity = useActivityStore();
  const activeWorkout = useWorkoutStore((s) => s.active);

  useEffect(() => {
    activity.inspect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.source]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const day = days.find((d) => d.date === selected) ?? null;
  const preferred = activity.providers.find((p) => p.availability === 'available') ?? activity.providers[0] ?? null;
  const state = movementState(day, {
    today,
    now: new Date(),
    connected: activity.source,
    availability: activity.source ? 'available' : (preferred?.availability ?? null),
    permission: activity.permission,
  });
  const totals = weekTotals(days.slice(-7));

  const timeline = [
    ...meals.map((m) => ({ key: `m-${m.id}`, at: m.loggedAt, kind: 'meal' as const, meal: m })),
    ...workouts.map((w) => ({ key: `w-${w.id}`, at: w.startedAt, kind: 'workout' as const, workout: w })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));

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
        title="Mon bilan"
        subtitle="Suivi quotidien"
        right={
          <View style={styles.headerButtons}>
            <IconButton icon="heart-outline" label="Connexion santé" onPress={() => router.push('/(app)/activity-connect')} />
            <IconButton icon="notifications-outline" label="Rappels" onPress={() => router.push('/(app)/nutrition-reminders')} />
          </View>
        }
      />

      {status === 'error' ? (
        <View style={styles.section}>
          <FormMessage
            title="Bilan indisponible"
            message="Impossible de charger votre suivi. Vérifiez votre connexion et réessayez."
            actionLabel="Réessayer"
            onAction={() => refresh()}
          />
        </View>
      ) : null}

      {selected !== today ? (
        <View style={styles.backToday}>
          <Chip label="Revenir à aujourd’hui" active={false} onPress={() => select(today)} />
        </View>
      ) : null}

      {/* 1-3. Daily balance: budget, consumed, remaining, activity energy */}
      <DailyBalanceCard
        day={day}
        title={dayLabel(selected, today)}
        loading={status === 'loading'}
        onCompleteProfile={() => router.push('/(app)/nutrition-profile')}
      />
      {day?.method ? (
        <View style={styles.section}>
          <Text style={styles.explain}>{METHOD_EXPLAINED[day.method]}</Text>
        </View>
      ) : null}

      <View style={[styles.section, styles.row]}>
        <BrandButton title="Ajouter un repas" onPress={() => router.push('/(app)/log-meal')} style={styles.flex} />
        <BrandButton title="Détails nutrition" variant="soft" onPress={() => router.push('/(app)/nutrition')} style={styles.flex} />
      </View>

      {/* 4. Steps and distance */}
      <View style={styles.section}>
        <MovementCard
          day={day}
          state={state}
          syncing={activity.syncing}
          onConnect={() => router.push('/(app)/activity-connect')}
          onSync={() => refresh()}
        />
      </View>

      {/* 5. Workout start actions */}
      <View style={styles.section}>
        <SectionHeader inset={false} title="Bouger" actionLabel="Historique" onAction={() => router.push('/(app)/workout-history')} />
        {activeWorkout ? (
          <SurfaceCard onPress={() => router.push('/(app)/workout')} style={styles.activeWorkout}>
            <Ionicons name={KIND_ICON[activeWorkout.kind] as any} size={22} color={theme.colors.brand} />
            <Text style={styles.activeText}>
              {`${KIND_LABEL[activeWorkout.kind]} ${activeWorkout.status === 'running' ? 'en cours' : 'en pause'} — reprendre`}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.inkMuted} />
          </SurfaceCard>
        ) : (
          <View style={styles.kinds}>
            {KINDS.map((k) => (
              <TouchableOpacity
                key={k}
                style={styles.kind}
                onPress={() => router.push({ pathname: '/(app)/workout', params: { kind: k } })}
                accessibilityRole="button"
                accessibilityLabel={`Démarrer : ${KIND_LABEL[k]}`}
              >
                <View style={styles.kindIcon}>
                  <Ionicons name={KIND_ICON[k] as any} size={22} color={theme.colors.brand} />
                </View>
                <Text style={styles.kindLabel} numberOfLines={1}>
                  {KIND_LABEL[k]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* 6. Timeline: meals and workouts of the selected day */}
      <View style={styles.section}>
        <SectionHeader inset={false} title={`Journal · ${dayLabel(selected, today)}`} />
        <SurfaceCard style={styles.timeline}>
          {dayStatus === 'loading' && timeline.length === 0 ? (
            <ActivityIndicator color={theme.colors.brand} />
          ) : dayStatus === 'error' ? (
            <Text style={styles.empty}>Journal indisponible pour le moment.</Text>
          ) : timeline.length === 0 ? (
            <Text style={styles.empty}>Aucun repas ni séance enregistré ce jour-là.</Text>
          ) : (
            timeline.map((item, i) => (
              <View key={item.key} style={[styles.event, i > 0 && styles.eventBorder]}>
                <Text style={styles.eventTime}>{timeOf(item.at)}</Text>
                <View style={[styles.eventIcon, item.kind === 'meal' ? styles.mealIcon : styles.workoutIcon]}>
                  <Ionicons
                    name={(item.kind === 'meal' ? 'restaurant-outline' : KIND_ICON[item.workout.kind]) as any}
                    size={16}
                    color={item.kind === 'meal' ? theme.colors.ink : theme.colors.brand}
                  />
                </View>
                {item.kind === 'meal' ? (
                  <View style={styles.eventText}>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                      {item.meal.mealName}
                    </Text>
                    <Text style={styles.eventMeta}>{`${formatServings(item.meal.servings)} · ${formatNumber(item.meal.kcal)} kcal`}</Text>
                  </View>
                ) : (
                  <View style={styles.eventText}>
                    <Text style={styles.eventTitle}>{`${KIND_LABEL[item.workout.kind]} · ${formatDuration(item.workout.activeSeconds)}`}</Text>
                    <Text style={styles.eventMeta}>
                      {item.workout.duplicateOf
                        ? 'Doublon d’une autre source : non compté'
                        : item.workout.energyKcal !== null
                          ? `${formatNumber(item.workout.energyKcal)} kcal — ${energyLabel(item.workout.energySource, item.workout.source)}`
                          : `Calories indisponibles · ${WORKOUT_SOURCE_LABEL[item.workout.source]}`}
                    </Text>
                  </View>
                )}
              </View>
            ))
          )}
        </SurfaceCard>
        <Text style={styles.explain}>
          Les calories des séances sont affichées pour information : elles ne s’ajoutent pas à votre budget, qui contient déjà votre activité.
        </Text>
      </View>

      {/* 7. Weekly trends */}
      <View style={styles.section}>
        <SectionHeader inset={false} title="Tendances" />
        <SurfaceCard>
          <View style={styles.rangeRow}>
            <Chip label="7 jours" active={range === 7} onPress={() => setRange(7)} />
            <Chip label="30 jours" active={range === 30} onPress={() => setRange(30)} />
          </View>
          <WeeklyBalanceChart days={days} today={today} selected={selected} onSelect={select} />
          <Text style={styles.weekSummary} testID="week-summary">
            {`7 derniers jours : ${totals.daysWithMeals} jour${totals.daysWithMeals > 1 ? 's' : ''} avec repas, ${totals.daysWithActivity} avec activité`}
            {totals.steps !== null ? `, ${formatNumber(totals.steps)} pas` : ''}
            {totals.workoutCount > 0 ? `, ${totals.workoutCount} séance${totals.workoutCount > 1 ? 's' : ''} (${formatDuration(totals.workoutSeconds)})` : ''}.
          </Text>
        </SurfaceCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  backToday: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    flexDirection: 'row',
  },
  row: {
    flexDirection: 'row',
  },
  flex: {
    flex: 1,
  },
  explain: {
    marginTop: -theme.spacing.sm,
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  activeWorkout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  activeText: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  kinds: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
  },
  kindIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandSoft,
  },
  kindLabel: {
    fontSize: 12,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  timeline: {
    paddingVertical: theme.spacing.sm,
  },
  event: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  eventBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  eventTime: {
    width: 44,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  eventIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealIcon: {
    backgroundColor: theme.colors.highlight,
  },
  workoutIcon: {
    backgroundColor: theme.colors.brandSoft,
  },
  eventText: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  eventMeta: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  empty: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
    paddingVertical: theme.spacing.md,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  weekSummary: {
    marginTop: theme.spacing.md,
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.ink,
  },
});
