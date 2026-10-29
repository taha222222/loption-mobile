import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { weekdayShort } from '../../nutrition/dates';
import { chartMax, DaySummary, describeDay } from '../../nutrition/tracking';
import { formatNumber } from './format';

interface CalorieHistoryChartProps {
  days: DaySummary[];
  today: string;
  height?: number;
}

// Daily bars from real records: a filled bar = calories logged that day; a
// tick = the target that applied that day (when known); a dashed empty slot
// = no meal logged (NOT zero calories). No-SVG, accessible per day.
export const CalorieHistoryChart: React.FC<CalorieHistoryChartProps> = ({ days, today, height = 140 }) => {
  const max = chartMax(days);
  const dense = days.length > 10;
  return (
    <View>
      <View style={[styles.plot, { height }]} accessibilityRole="image" accessibilityLabel="Historique des calories">
        <Text style={styles.scale}>{formatNumber(max)}</Text>
        <View style={styles.bars}>
          {days.map((d, i) => {
            const consumedH = d.consumedKcal !== null ? Math.max(3, (d.consumedKcal / max) * height) : 0;
            const targetY = d.targetKcal !== null ? (d.targetKcal / max) * height : null;
            const isToday = d.date === today;
            const over = d.targetKcal !== null && d.consumedKcal !== null && d.consumedKcal > d.targetKcal;
            return (
              <View
                key={d.date}
                style={styles.column}
                accessible
                accessibilityLabel={`${weekdayShort(d.date)} ${d.date.slice(8)} : ${describeDay(d)}`}
                testID={`chart-day-${d.date}`}
              >
                {d.hasLog ? (
                  <View
                    style={[
                      styles.bar,
                      { height: consumedH },
                      over && styles.barOver,
                      isToday && styles.barToday,
                      dense && styles.barDense,
                    ]}
                  />
                ) : (
                  <View style={[styles.empty, dense && styles.barDense]} testID={`chart-nolog-${d.date}`} />
                )}
                {targetY !== null ? <View style={[styles.target, { bottom: targetY }]} /> : null}
                {!dense || i % 5 === 0 || isToday ? (
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]} numberOfLines={1}>
                    {dense ? d.date.slice(8) : weekdayShort(d.date)}
                  </Text>
                ) : (
                  <Text style={styles.dayLabel}> </Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.legend}>
        <LegendItem swatch={styles.legendBar} label="Consommé" />
        <LegendItem swatch={styles.legendTarget} label="Objectif du jour" />
        <LegendItem swatch={styles.legendEmpty} label="Aucun repas enregistré" />
      </View>
    </View>
  );
};

function LegendItem({ swatch, label }: { swatch: object; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={swatch} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: theme.spacing.md,
    marginBottom: 22,
  },
  scale: {
    position: 'absolute',
    top: -16,
    left: 0,
    fontSize: 10,
    color: theme.colors.inkFaint,
  },
  bars: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  column: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '70%',
    maxWidth: 26,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: theme.colors.brand,
  },
  barToday: {
    backgroundColor: theme.colors.brandDeep,
  },
  barOver: {
    backgroundColor: theme.colors.coral,
  },
  barDense: {
    width: '80%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  empty: {
    width: '70%',
    maxWidth: 26,
    height: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.inkFaint,
  },
  target: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.highlight,
  },
  dayLabel: {
    position: 'absolute',
    bottom: -20,
    fontSize: 11,
    color: theme.colors.inkMuted,
  },
  dayLabelToday: {
    color: theme.colors.ink,
    fontWeight: theme.typography.weights.bold,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
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
  legendBar: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: theme.colors.brand,
  },
  legendTarget: {
    width: 12,
    height: 2,
    backgroundColor: theme.colors.highlight,
  },
  legendEmpty: {
    width: 10,
    height: 10,
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.inkFaint,
  },
});
