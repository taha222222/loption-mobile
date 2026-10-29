import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import {
  BrandButton,
  CalorieHistoryChart,
  CalorieTodayCard,
  Chip,
  FormMessage,
  Screen,
  ScreenHeader,
  SectionHeader,
  StreakCard,
  SurfaceCard,
  formatNumber,
} from '../../src/components/v2';
import { useNutritionStore } from '../../src/stores/nutritionStore';
import { useUserStore } from '../../src/stores/userStore';
import { LogEntry } from '../../src/services/nutritionApi';
import { formatServings } from '../../src/nutrition/tracking';

// Daily nutrition tracking: today's target and intake, logged meals, streak
// and history. All values come from the server (RLS-protected).
export default function NutritionScreen() {
  const { today, range, history, entries, streak, status, error, refresh, setRange, removeEntry } = useNutritionStore();
  const profile = useUserStore((s) => s.profile);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const todaySummary = history.find((d) => d.date === today) ?? null;
  const target = todaySummary?.targetKcal ?? null;
  const bmr = typeof profile?.bmr_kcal === 'number' ? profile.bmr_kcal : null;
  const tdee = typeof profile?.tdee_kcal === 'number' ? profile.tdee_kcal : null;

  const confirmRemove = (entry: LogEntry) => {
    const doRemove = async () => {
      setRemoving(entry.id);
      setNotice(null);
      const result = await removeEntry(entry.id);
      setRemoving(null);
      if (!result.ok) setNotice(result.message);
    };
    const question = `Retirer « ${entry.mealName} » (${entry.kcal} kcal) du journal d’aujourd’hui ?`;
    if (Platform.OS === 'web') {
      // React Native Web has no Alert dialog.
      if (typeof window !== 'undefined' && window.confirm(question)) doRemove();
      return;
    }
    Alert.alert('Retirer ce repas ?', question, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: doRemove },
    ]);
  };

  if (status === 'idle' || (status === 'loading' && history.length === 0)) {
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
        subtitle="Nutrition"
        right={
          <TouchableOpacity
            onPress={() => router.push('/(app)/nutrition-reminders')}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Rappels"
          >
            <Ionicons name="notifications-outline" size={22} color={theme.colors.ink} />
          </TouchableOpacity>
        }
      />

      {status === 'error' ? (
        <View style={styles.block}>
          <FormMessage title="Suivi indisponible" message={error ?? ''} actionLabel="Réessayer" onAction={refresh} />
        </View>
      ) : null}

      <CalorieTodayCard
        targetKcal={target}
        consumedKcal={todaySummary?.consumedKcal ?? null}
        streak={streak?.current ?? null}
      />

      <View style={styles.block}>
        <BrandButton title="Ajouter un repas consommé" onPress={() => router.push('/(app)/log-meal')} />
      </View>

      {/* Estimates */}
      <View style={styles.section}>
        <SectionHeader inset={false} title="Vos estimations" actionLabel="Modifier" onAction={() => router.push('/(app)/nutrition-profile')} />
        <SurfaceCard style={styles.estimates}>
          {tdee !== null && bmr !== null ? (
            <>
              <EstimateRow label="Métabolisme de base (BMR)" value={bmr} hint="Énergie utilisée au repos." />
              <EstimateRow label="Dépense quotidienne (TDEE)" value={tdee} hint="BMR × niveau d’activité." />
              <EstimateRow
                label="Objectif du jour"
                value={target ?? tdee}
                hint="Égal à votre TDEE : aucun ajustement de perte ou de prise de poids n’est appliqué."
              />
              <Text style={styles.disclaimer}>
                Estimations (formule de Mifflin–St Jeor), pas un avis médical.
              </Text>
            </>
          ) : (
            <View style={styles.missing}>
              <Text style={styles.missingTitle}>Estimation personnalisée indisponible</Text>
              <Text style={styles.missingText}>
                {profile?.gender === 'unspecified'
                  ? 'Sans le sexe utilisé par la formule, nous ne calculons pas d’estimation. Vous pouvez quand même enregistrer vos repas.'
                  : 'Complétez votre âge, poids, taille et niveau d’activité pour obtenir une estimation.'}
              </Text>
              <BrandButton title="Compléter mon profil" variant="soft" onPress={() => router.push('/(app)/nutrition-profile')} />
            </View>
          )}
        </SurfaceCard>
      </View>

      {/* Today's entries */}
      <View style={styles.section}>
        <SectionHeader inset={false} title="Aujourd’hui" />
        {notice ? <FormMessage title="Action impossible" message={notice} /> : null}
        <SurfaceCard style={styles.entries}>
          {entries.length === 0 ? (
            <Text style={styles.empty}>Aucun repas enregistré aujourd’hui.</Text>
          ) : (
            entries.map((e, i) => (
              <View key={e.id} style={[styles.entry, i > 0 && styles.entryBorder]}>
                <View style={styles.entryText}>
                  <Text style={styles.entryName} numberOfLines={1}>
                    {e.mealName}
                  </Text>
                  <Text style={styles.entryMeta}>
                    {`${formatServings(e.servings)} · ${formatNumber(e.kcal)} kcal`}
                    {e.orderItemId ? ' · commande' : ''}
                  </Text>
                </View>
                {removing === e.id ? (
                  <ActivityIndicator color={theme.colors.brand} />
                ) : (
                  <TouchableOpacity
                    onPress={() => confirmRemove(e)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retirer ${e.mealName}`}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={20} color={theme.colors.inkMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </SurfaceCard>
      </View>

      {streak ? (
        <View style={styles.section}>
          <SectionHeader inset={false} title="Régularité" />
          <StreakCard streak={streak} />
        </View>
      ) : null}

      {/* History */}
      <View style={styles.section}>
        <SectionHeader inset={false} title="Historique" />
        <SurfaceCard>
          <View style={styles.rangeRow}>
            <Chip label="7 jours" active={range === 7} onPress={() => setRange(7)} />
            <Chip label="30 jours" active={range === 30} onPress={() => setRange(30)} />
          </View>
          {history.some((d) => d.hasLog) ? (
            <CalorieHistoryChart days={history} today={today} />
          ) : (
            <Text style={styles.empty}>Aucun repas enregistré sur cette période. Vos journées apparaîtront ici.</Text>
          )}
        </SurfaceCard>
      </View>
    </Screen>
  );
}

function EstimateRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <View style={styles.estimateRow}>
      <View style={styles.estimateText}>
        <Text style={styles.estimateLabel}>{label}</Text>
        <Text style={styles.estimateHint}>{hint}</Text>
      </View>
      <Text style={styles.estimateValue}>{`${formatNumber(value)} kcal`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  block: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  estimates: {
    gap: theme.spacing.md,
  },
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  estimateText: {
    flex: 1,
  },
  estimateLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  estimateHint: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  estimateValue: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
  disclaimer: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
  },
  missing: {
    gap: theme.spacing.sm,
  },
  missingTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  missingText: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  entries: {
    paddingVertical: theme.spacing.sm,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  entryBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  entryText: {
    flex: 1,
    minWidth: 0,
  },
  entryName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  entryMeta: {
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
});
