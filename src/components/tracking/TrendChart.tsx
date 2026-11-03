// Bar chart for one metric over the chosen period (7 or 30 days). Tap a bar
// for the day's details. A day without data is an empty outlined slot with
// "—", never a bar of 0; a measured zero is a flat line at the bottom.
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../../theme';
import { formatNumber } from '../v2';
import { balanceChartMax, minutesChartMax, stepsChartMax, type DailyBalance } from '../../activity/dailyBalance';
import { weekdayShort } from '../../nutrition/dates';

export type TrendMetric = 'calories' | 'steps' | 'minutes';

const HEIGHT = 150;
const META: Record<TrendMetric, { title: string; unit: string; color: string; soft: string }> = {
  calories: { title: 'Calories mangées et objectif', unit: 'kcal', color: theme.colors.nutrition, soft: theme.colors.nutritionSoft },
  steps: { title: 'Pas par jour', unit: 'pas', color: theme.colors.movement, soft: theme.colors.movementSoft },
  minutes: { title: 'Minutes de séance', unit: 'min', color: theme.colors.workout, soft: theme.colors.workoutSoft },
};

function valueOf(d: DailyBalance, metric: TrendMetric): number | null {
  if (metric === 'calories') return d.consumedKcal;
  if (metric === 'steps') return d.steps;
  return d.activeMinutes; // recorded sessions: none is a real 0
}

export function describeDay(d: DailyBalance, metric: TrendMetric): string {
  if (metric === 'calories') {
    const eaten = d.consumedKcal === null ? 'aucun repas enregistré' : `${formatNumber(d.consumedKcal)} kcal mangées`;
    const target = d.budgetKcal !== null ? ` · objectif ${formatNumber(d.budgetKcal)} kcal` : '';
    return `${eaten}${target}`;
  }
  if (metric === 'steps') return d.steps === null ? 'pas non mesurés' : `${formatNumber(d.steps)} pas`;
  return d.workoutCount > 0 ? `${d.activeMinutes} min · ${d.workoutCount} séance${d.workoutCount > 1 ? 's' : ''}` : 'aucune séance';
}

export function trendSummary(days: DailyBalance[], metric: TrendMetric): string {
  if (metric === 'calories') {
    const withMeals = days.filter((d) => d.consumedKcal !== null);
    if (!withMeals.length) return 'Aucun repas enregistré sur la période.';
    const avg = Math.round(withMeals.reduce((s, d) => s + (d.consumedKcal ?? 0), 0) / withMeals.length);
    return `Moyenne : ${formatNumber(avg)} kcal par jour enregistré (${withMeals.length} jour${withMeals.length > 1 ? 's' : ''}).`;
  }
  if (metric === 'steps') {
    const measured = days.filter((d) => d.steps !== null);
    if (!measured.length) return 'Aucun pas mesuré sur la période.';
    const total = measured.reduce((s, d) => s + (d.steps ?? 0), 0);
    return `${formatNumber(total)} pas · moyenne ${formatNumber(Math.round(total / measured.length))} par jour mesuré.`;
  }
  const n = days.reduce((s, d) => s + d.workoutCount, 0);
  const min = days.reduce((s, d) => s + d.activeMinutes, 0);
  return n ? `${n} séance${n > 1 ? 's' : ''} · ${min} min au total.` : 'Aucune séance sur la période.';
}

interface Props {
  days: DailyBalance[];
  metric: TrendMetric;
  today: string;
  onSelect?: (date: string) => void; // also shows that day in the dashboard
}

export function TrendChart({ days, metric, today, onSelect }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const meta = META[metric];
  const max = metric === 'calories' ? balanceChartMax(days) : metric === 'steps' ? stepsChartMax(days) : minutesChartMax(days);
  const dense = days.length > 10;
  const pickedDay = days.find((d) => d.date === picked) ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.legendRow}>
        <Text style={styles.title}>{meta.title}</Text>
        <Text style={styles.max}>{`${formatNumber(max)} ${meta.unit}`}</Text>
      </View>
      <View style={styles.chart} accessibilityRole="summary" accessibilityLabel={`${meta.title}. ${trendSummary(days, metric)}`}>
        {days.map((d, i) => {
          const v = valueOf(d, metric);
          const h = v === null ? 0 : Math.max(3, (Math.min(v, max) / max) * HEIGHT);
          const target = metric === 'calories' && d.budgetKcal !== null ? (Math.min(d.budgetKcal, max) / max) * HEIGHT : null;
          const isPicked = picked === d.date;
          const label = dense ? (i % 5 === 0 || d.date === today ? String(Number(d.date.slice(8))) : '') : weekdayShort(d.date);
          return (
            <TouchableOpacity
              key={d.date}
              style={styles.col}
              onPress={() => {
                setPicked(isPicked ? null : d.date);
                if (!isPicked) onSelect?.(d.date);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${d.date === today ? 'Aujourd’hui' : d.date} : ${describeDay(d, metric)}`}
            >
              <View style={styles.barArea}>
                {v === null ? (
                  <View style={[styles.missing, dense && styles.missingDense]} />
                ) : (
                  <View style={[styles.bar, { height: h, backgroundColor: isPicked ? meta.color : v === 0 ? meta.soft : meta.color }, !isPicked && styles.barIdle]} />
                )}
                {target !== null ? <View style={[styles.target, { bottom: target }]} /> : null}
              </View>
              <Text style={[styles.dayLabel, d.date === today && styles.today]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: meta.color }]} />
          <Text style={styles.legend}>{metric === 'calories' ? 'Mangé' : metric === 'steps' ? 'Pas mesurés' : 'Séances'}</Text>
        </View>
        {metric === 'calories' ? (
          <View style={styles.legendItem}>
            <View style={styles.targetSwatch} />
            <Text style={styles.legend}>Objectif</Text>
          </View>
        ) : null}
        <View style={styles.legendItem}>
          <View style={styles.missingSwatch} />
          <Text style={styles.legend}>Pas de données</Text>
        </View>
      </View>
      <Text style={styles.detail}>
        {pickedDay
          ? `${pickedDay.date === today ? 'Aujourd’hui' : pickedDay.date.split('-').reverse().join('/')} : ${describeDay(pickedDay, metric)}`
          : trendSummary(days, metric)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing.md },
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: theme.spacing.sm },
  title: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  max: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT + 24, gap: 2 },
  col: { flex: 1, alignItems: 'center' },
  barArea: { height: HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '70%', borderTopLeftRadius: 6, borderTopRightRadius: 6, minWidth: 3 },
  barIdle: { opacity: 0.85 },
  missing: {
    width: '70%',
    height: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.inkFaint,
    borderRadius: 4,
  },
  missingDense: { height: 10 },
  target: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: theme.colors.ink, opacity: 0.6 },
  dayLabel: { marginTop: 6, fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, height: 16 },
  today: { color: theme.colors.ink, fontWeight: theme.typography.weights.bold },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  targetSwatch: { width: 14, height: 2, backgroundColor: theme.colors.ink },
  missingSwatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.inkFaint },
  legend: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  detail: { fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.ink },
});
