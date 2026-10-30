import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { ProgressRing } from './ProgressRing';
import { formatNumber } from './format';
import { progressShare, remainingKcal } from '../../nutrition/tracking';

interface CalorieTodayCardProps {
  targetKcal: number | null;
  targetName?: 'objectif' | 'budget'; // 'budget' when it follows measured activity
  consumedKcal: number | null; // null = nothing logged today
  streak?: number | null;
  loading?: boolean;
  unavailable?: boolean; // the server does not have calorie tracking yet
  onPress?: () => void;
}

// Today at a glance: remaining calories, progress toward the target, and
// what was logged. Every value is real (server data); unknown values are
// shown as unknown, never as placeholders.
export const CalorieTodayCard: React.FC<CalorieTodayCardProps> = ({
  targetKcal,
  targetName = 'objectif',
  consumedKcal,
  streak,
  loading,
  unavailable,
  onPress,
}) => {
  const name = targetName;
  const consumed = consumedKcal ?? 0;
  const remaining = remainingKcal(targetKcal, consumedKcal);
  const share = progressShare(targetKcal, consumedKcal);
  const over = remaining !== null && remaining < 0;
  const label =
    targetKcal === null
      ? 'Consommé aujourd’hui'
      : over
        ? `Au-delà ${name === 'budget' ? 'du budget' : 'de l’objectif'}`
        : 'Calories restantes';
  const big = targetKcal === null ? consumed : Math.abs(remaining ?? 0);
  const a11y =
    targetKcal === null
      ? `${consumed} kilocalories consommées aujourd’hui. Objectif indisponible.`
      : `${consumed} kilocalories consommées sur un ${name} de ${targetKcal}. ${
          over ? `Objectif dépassé de ${Math.abs(remaining!)}` : `${remaining} restantes`
        }.`;

  if (unavailable) {
    return (
      <View style={styles.card} accessible accessibilityLabel="Suivi des calories pas encore disponible." testID="calorie-today-card">
        <View style={styles.glow} />
        <Text style={styles.label}>Suivi des calories</Text>
        <Text style={styles.value}>—</Text>
        <Text style={styles.meta}>Pas encore disponible : la mise à jour du serveur L’OPTION est en attente.</Text>
      </View>
    );
  }

  const content = (
    <View style={styles.card} accessible accessibilityLabel={a11y} testID="calorie-today-card">
      <View style={styles.glow} />
      <View style={styles.top}>
        <View style={styles.text}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {loading ? '…' : formatNumber(big)}
          </Text>
          <Text style={styles.unit}>kcal</Text>
        </View>
        {targetKcal !== null ? (
          <ProgressRing progress={share} size={108} stroke={11}>
            <Text style={styles.ringValue}>{`${Math.round((consumed / targetKcal) * 100)} %`}</Text>
            <Text style={styles.ringLabel}>{name === 'budget' ? 'DU BUDGET' : 'DE L’OBJECTIF'}</Text>
          </ProgressRing>
        ) : null}
      </View>
      <Text style={styles.meta} numberOfLines={2}>
        {targetKcal === null
          ? consumedKcal === null
            ? 'Aucun repas enregistré aujourd’hui · objectif indisponible'
            : 'Objectif indisponible : complétez votre profil nutritionnel'
          : consumedKcal === null
            ? `Aucun repas enregistré aujourd’hui · ${name} ${formatNumber(targetKcal)} kcal`
            : `${formatNumber(consumed)} consommées · ${name} ${formatNumber(targetKcal)} kcal`}
      </Text>
      {streak !== undefined && streak !== null ? (
        <View style={styles.footer}>
          <Ionicons name="flame" size={16} color={theme.colors.highlight} />
          <Text style={styles.footerText}>
            {streak > 0 ? `${streak} jour${streak > 1 ? 's' : ''} de suivi d’affilée` : 'Enregistrez un repas pour démarrer votre série'}
          </Text>
          {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.colors.brandOnDark} /> : null}
        </View>
      ) : null}
    </View>
  );

  return onPress ? (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} accessibilityRole="button" accessibilityHint="Ouvre votre suivi quotidien">
      {content}
    </TouchableOpacity>
  ) : (
    content
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.brand,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -90,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandOnDark,
  },
  value: {
    fontSize: theme.typography.sizes.display,
    lineHeight: theme.typography.lineHeights.display,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
    letterSpacing: -1.5,
    marginTop: theme.spacing.xs,
  },
  unit: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandOnDark,
  },
  ringValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  ringLabel: {
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandOnDark,
    letterSpacing: 0.6,
    marginTop: 2,
  },
  meta: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.brandOnDark,
    marginTop: theme.spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },
  footerText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textWhite,
  },
});
