import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { activityShareOfBudget, DailyBalance, intakeShare, METHOD_LABEL } from '../../activity/dailyBalance';
import { BrandButton } from './BrandButton';
import { formatNumber } from './format';

interface DailyBalanceCardProps {
  day: DailyBalance | null;
  title: string; // "Aujourd’hui", "Hier", a date
  loading?: boolean;
  onCompleteProfile?: () => void;
}

// "L’OPTION Daily Balance": one energy path per day. The path is the day's
// budget; its far end, in a lighter gold, is the part earned by measured
// movement; the solid gold fill is what was eaten. Over budget, the path is
// full and an overflow tab says by how much. Every value is real or shown
// as unavailable.
export const DailyBalanceCard: React.FC<DailyBalanceCardProps> = ({ day, title, loading, onCompleteProfile }) => {
  const budget = day?.budgetKcal ?? null;
  const consumed = day?.consumedKcal ?? null;
  const remaining = day?.remainingKcal ?? null;
  const over = remaining !== null && remaining < 0;
  const share = day ? intakeShare(day) : 0;
  const earned = day ? activityShareOfBudget(day) : 0;

  const headline =
    budget === null ? 'Consommées' : over ? 'Au-delà du budget' : 'Restantes';
  const big = budget === null ? (consumed ?? 0) : Math.abs(remaining ?? budget);
  const a11y =
    budget === null
      ? `${title}. ${consumed ?? 0} kilocalories consommées. Budget indisponible.`
      : `${title}. Budget ${budget} kilocalories, ${consumed ?? 0} consommées, ${
          over ? `dépassé de ${Math.abs(remaining!)}` : `${remaining} restantes`
        }. Méthode : ${day?.method ? METHOD_LABEL[day.method] : 'inconnue'}.`;

  return (
    <View style={styles.card} accessible accessibilityLabel={a11y} testID="daily-balance-card">
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {day?.method ? (
          <View style={styles.method}>
            <Text style={styles.methodText} numberOfLines={1}>
              {METHOD_LABEL[day.method]}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.headline}>{headline}</Text>
      <View style={styles.bigRow}>
        <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {loading && !day ? '…' : formatNumber(big)}
        </Text>
        <Text style={styles.unit}>kcal</Text>
      </View>

      {budget !== null ? (
        <View style={styles.pathWrap} testID="energy-path">
          <View style={styles.path}>
            {earned > 0 ? <View style={[styles.earned, { width: `${earned * 100}%` }]} testID="energy-path-earned" /> : null}
            <View style={[styles.eaten, { width: `${share * 100}%` }]} testID="energy-path-eaten" />
          </View>
          {over ? (
            <View style={styles.overflow}>
              <Text style={styles.overflowText}>{`+${formatNumber(Math.abs(remaining!))}`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.stats}>
        <Stat label="Consommées" value={consumed === null ? '—' : formatNumber(consumed)} />
        <Stat label="Activité" value={day?.activeKcal === null || day?.activeKcal === undefined ? '—' : formatNumber(day.activeKcal)} />
        <Stat label="Budget" value={budget === null ? '—' : formatNumber(budget)} />
      </View>

      {budget === null ? (
        <View style={styles.missing}>
          <Text style={styles.note}>
            Budget personnalisé indisponible : complétez votre profil nutritionnel. Vos repas et votre activité restent visibles.
          </Text>
          {onCompleteProfile ? <BrandButton title="Compléter mon profil" variant="soft" onPress={onCompleteProfile} /> : null}
        </View>
      ) : (
        <Text style={styles.note}>
          {consumed === null ? 'Aucun repas enregistré. ' : ''}
          Estimations, pas un avis médical.
        </Text>
      )}
    </View>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    padding: theme.spacing.xl,
    borderRadius: theme.radii.xl,
    backgroundColor: theme.colors.brand,
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
    textTransform: 'capitalize',
  },
  method: {
    flexShrink: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brandTrack,
  },
  methodText: {
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textWhite,
  },
  headline: {
    marginTop: theme.spacing.sm,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.brandOnDark,
  },
  bigRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
  },
  big: {
    fontSize: theme.typography.sizes['5xl'],
    lineHeight: theme.typography.lineHeights['5xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    marginBottom: 10,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandOnDark,
  },
  pathWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  path: {
    flex: 1,
    height: 16,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brandTrack,
    overflow: 'hidden',
  },
  earned: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.highlight,
    opacity: 0.35,
  },
  eaten: {
    height: '100%',
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.highlight,
  },
  overflow: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.coral,
  },
  overflowText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  stats: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.brandOnDark,
  },
  missing: {
    gap: theme.spacing.sm,
  },
  note: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.brandOnDark,
  },
});
