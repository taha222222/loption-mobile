import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../../theme';
import { weekdayShort } from '../../nutrition/dates';
import { balanceChartMax, DailyBalance, describeBalanceDay, stepsChartMax } from '../../activity/dailyBalance';
import { formatNumber } from './format';

interface WeeklyBalanceChartProps {
  days: DailyBalance[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
  height?: number;
}

// Two rows per day from persisted records only. Top: calories eaten (bar)
// against that day's budget (tick); a dashed slot = no meal logged, never
// zero. Bottom: steps (bar) — a dash means no activity data, distinct from
// a measured 0. A dot marks a day with a workout. Tap a day to inspect it.
export const WeeklyBalanceChart: React.FC<WeeklyBalanceChartProps> = ({ days, today, selected, onSelect, height = 120 }) => {
  const kcalMax = balanceChartMax(days);
  const stepMax = stepsChartMax(days);
  const dense = days.length > 10;
  const stepsH = 36;
  return (
    <View>
      <Text style={styles.scale}>{`${formatNumber(kcalMax)} kcal`}</Text>
      <View style={styles.columns}>
        {days.map((d, i) => {
          const isSel = d.date === selected;
          const kcalH = d.consumedKcal !== null ? Math.max(3, (d.consumedKcal / kcalMax) * height) : 0;
          const budgetY = d.budgetKcal !== null ? (d.budgetKcal / kcalMax) * height : null;
          const over = d.budgetKcal !== null && d.consumedKcal !== null && d.consumedKcal > d.budgetKcal;
          const stepH = d.steps !== null ? Math.max(d.steps > 0 ? 3 : 1, (d.steps / stepMax) * stepsH) : 0;
          return (
            <TouchableOpacity
              key={d.date}
              style={[styles.column, isSel && styles.columnSelected]}
              onPress={() => onSelect(d.date)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={`${weekdayShort(d.date)} ${d.date.slice(8)} : ${describeBalanceDay(d)}`}
              testID={`balance-day-${d.date}`}
            >
              <View style={[styles.kcalArea, { height }]}>
                {d.hasMealLog ? (
                  <View style={[styles.kcalBar, { height: kcalH }, over && styles.kcalOver, dense && styles.dense]} />
                ) : (
                  <View style={[styles.empty, dense && styles.dense]} testID={`balance-nolog-${d.date}`} />
                )}
                {budgetY !== null ? <View style={[styles.budget, { bottom: budgetY }]} /> : null}
              </View>
              <View style={[styles.stepArea, { height: stepsH }]}>
                {d.steps !== null ? (
                  <View style={[styles.stepBar, { height: stepH }, dense && styles.dense]} />
                ) : (
                  <Text style={styles.noData} testID={`balance-nosteps-${d.date}`}>
                    –
                  </Text>
                )}
              </View>
              <View style={[styles.dot, d.workoutCount > 0 && styles.dotOn]} />
              <Text style={[styles.label, d.date === today && styles.labelToday]} numberOfLines={1}>
                {!dense ? weekdayShort(d.date) : i % 5 === 0 || d.date === today ? d.date.slice(8) : ' '}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.legend}>
        <Legend swatch={styles.lgKcal} label="Consommé" />
        <Legend swatch={styles.lgBudget} label="Budget du jour" />
        <Legend swatch={styles.lgEmpty} label="Aucun repas" />
        <Legend swatch={styles.lgSteps} label="Pas" />
        <Legend swatch={styles.lgDot} label="Séance" />
      </View>
      <Text style={styles.legendNote}>« – » : aucune donnée d’activité (différent de 0 pas).</Text>
    </View>
  );
};

function Legend({ swatch, label }: { swatch: object; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={swatch} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scale: {
    fontSize: 10,
    color: theme.colors.inkFaint,
    marginBottom: theme.spacing.xs,
  },
  columns: {
    flexDirection: 'row',
    gap: 3,
  },
  column: {
    flex: 1,
    alignItems: 'center',
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing.xs,
  },
  columnSelected: {
    backgroundColor: theme.colors.brandSoft,
  },
  kcalArea: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  kcalBar: {
    width: '60%',
    maxWidth: 22,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: theme.colors.brand,
  },
  kcalOver: {
    backgroundColor: theme.colors.coral,
  },
  dense: {
    width: '80%',
  },
  empty: {
    width: '60%',
    maxWidth: 22,
    height: 26,
    borderRadius: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.inkFaint,
  },
  budget: {
    position: 'absolute',
    width: '84%',
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.highlight,
  },
  stepArea: {
    width: '100%',
    marginTop: theme.spacing.xs,
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  stepBar: {
    width: '40%',
    maxWidth: 14,
    borderRadius: 4,
    backgroundColor: theme.colors.inkMuted,
  },
  noData: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkFaint,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: theme.spacing.xs,
  },
  dotOn: {
    backgroundColor: theme.colors.highlight,
  },
  label: {
    marginTop: 2,
    fontSize: 11,
    color: theme.colors.inkMuted,
  },
  labelToday: {
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
  },
  lgKcal: { width: 10, height: 10, borderRadius: 3, backgroundColor: theme.colors.brand },
  lgBudget: { width: 12, height: 2, backgroundColor: theme.colors.highlight },
  lgEmpty: { width: 10, height: 10, borderRadius: 3, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.inkFaint },
  lgSteps: { width: 6, height: 10, borderRadius: 2, backgroundColor: theme.colors.inkMuted },
  lgDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.highlight },
  legendNote: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkFaint,
  },
});
