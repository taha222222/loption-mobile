// The day's meals at a glance: each meal with its calories, a simple bar
// showing how the day's calories split between meals, and one clear action.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { ActivityIcon, BrandButton, SurfaceCard, formatNumber } from '../v2';
import { formatServings } from '../../nutrition/tracking';
import type { LogEntry } from '../../services/nutritionApi';

const SHADES = [theme.colors.nutrition, theme.colors.energy, theme.colors.workout, theme.colors.movement, theme.colors.coral, theme.colors.brandDeep];
const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

interface Props {
  meals: LogEntry[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  isToday: boolean;
  onAddMeal: () => void;
}

export function NutritionOverview({ meals, status, isToday, onAddMeal }: Props) {
  const total = meals.reduce((s, m) => s + m.kcal, 0);
  return (
    <SurfaceCard style={styles.card}>
      <View style={styles.header}>
        <ActivityIcon name="meal" size={48} />
        <View style={styles.headerText}>
          <Text style={styles.title}>{meals.length ? `${meals.length} repas · ${formatNumber(total)} kcal` : 'Aucun repas enregistré'}</Text>
          <Text style={styles.hint}>Seulement ce que vous avez réellement mangé.</Text>
        </View>
      </View>

      {status === 'error' ? <Text style={styles.hint}>Repas indisponibles pour le moment.</Text> : null}

      {meals.length > 0 && total > 0 ? (
        <View style={styles.split} accessibilityLabel="Répartition des calories entre les repas">
          {meals.map((m, i) => (
            <View key={m.id} style={{ flex: m.kcal / total, backgroundColor: SHADES[i % SHADES.length] }} />
          ))}
        </View>
      ) : null}

      {meals.map((m, i) => (
        <View key={m.id} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: SHADES[i % SHADES.length] }]} />
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {m.mealName}
            </Text>
            <Text style={styles.meta}>
              {`${timeOf(m.loggedAt)} · ${formatServings(m.servings)}${m.source === 'manual' ? ' · saisi par vous' : m.source === 'order' ? ' · commande' : ''}`}
            </Text>
          </View>
          <Text style={styles.kcal}>{`${formatNumber(m.kcal)} kcal`}</Text>
        </View>
      ))}

      {isToday ? <BrandButton title="Ajouter un repas" onPress={onAddMeal} /> : null}
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: theme.spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  hint: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  split: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  meta: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  kcal: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink, fontVariant: ['tabular-nums'] },
});
