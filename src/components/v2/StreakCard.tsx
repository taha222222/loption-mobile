import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { SurfaceCard } from './SurfaceCard';
import { daysToMilestone, StreakInfo } from '../../nutrition/tracking';

// Consecutive local days with at least one logged meal (computed by the
// server from stored entries). No points or rewards.
export const StreakCard: React.FC<{ streak: StreakInfo }> = ({ streak }) => {
  const toGo = daysToMilestone(streak);
  const progress = streak.nextMilestone > 0 ? Math.min(1, streak.current / streak.nextMilestone) : 0;
  return (
    <SurfaceCard style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="flame" size={22} color={theme.colors.highlight} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} accessibilityRole="header">
            {streak.current > 0 ? `${streak.current} jour${streak.current > 1 ? 's' : ''} d’affilée` : 'Pas de série en cours'}
          </Text>
          <Text style={styles.sub}>
            {streak.current > 0 && !streak.todayLogged
              ? 'Enregistrez un repas aujourd’hui pour la prolonger.'
              : `Record : ${streak.longest} jour${streak.longest > 1 ? 's' : ''}`}
          </Text>
        </View>
      </View>
      <View style={styles.track} accessibilityLabel={`Prochain palier : ${streak.nextMilestone} jours`}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.next}>
        {toGo === 0
          ? `Palier de ${streak.current} jours atteint !`
          : `Prochain palier : ${streak.nextMilestone} jours (encore ${toGo} jour${toGo > 1 ? 's' : ''})`}
      </Text>
    </SurfaceCard>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.ink,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  sub: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  track: {
    height: 8,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.hairline,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.highlight,
  },
  next: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
  },
});
