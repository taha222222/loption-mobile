import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import {
  BrandButton,
  Chip,
  FormMessage,
  Screen,
  ScreenHeader,
  SectionHeader,
  Stepper,
  SurfaceCard,
  TextField,
  formatNumber,
} from '../../src/components/v2';
import { addDays } from '../../src/nutrition/dates';
import { formatServings, manualMealProblem, parseAmount } from '../../src/nutrition/tracking';
import { useNutritionStore } from '../../src/stores/nutritionStore';
import { useTrackingStore } from '../../src/stores/trackingStore';
import { fetchLoggableMeals, fetchOrderedMeals, LoggableMeal, OrderedMeal } from '../../src/services/nutritionApi';

type Choice = { meal: LoggableMeal; orderItem: OrderedMeal | null };

const STEP = 0.25;

function loadMeals(orderId?: string) {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  return Promise.all([fetchLoggableMeals(), fetchOrderedMeals(since, orderId)]).then(([meals, ordered]) => ({ meals, ordered }));
}
const MAX_SERVINGS = 10;

// Log a meal the customer actually ate. Calories come from the meal's
// nutrition data on the server; meals without a reliable calorie value are
// not offered. An ordered meal is only logged when the customer says so,
// and only once the order was received. With ?orderId= (from an order:
// "J’ai mangé ce repas") only that order's meals are listed. "Autre repas"
// logs food from outside L’OPTION with the calories the customer enters
// (labelled as entered by the customer). Logging the same meal twice in a
// day asks first.
export default function LogMealScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const { today, logMeal, logManual, entries } = useNutritionStore();
  const [mode, setMode] = useState<'menu' | 'manual'>('menu');
  const [manualName, setManualName] = useState('');
  const [manualKcal, setManualKcal] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [showMacros, setShowMacros] = useState(false);
  const [meals, setMeals] = useState<LoggableMeal[] | null>(null);
  const [ordered, setOrdered] = useState<OrderedMeal[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [servings, setServings] = useState(1);
  const [day, setDay] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (r: Awaited<ReturnType<typeof loadMeals>>) => {
    if (r.meals.error || r.ordered.error) {
      setLoadError('Impossible de charger les repas. Vérifiez votre connexion et réessayez.');
      return;
    }
    setLoadError(null);
    setMeals(r.meals.data);
    setOrdered(r.ordered.data);
  };
  const load = () => loadMeals(orderId).then(apply);

  useEffect(() => {
    let active = true;
    loadMeals(orderId).then((r) => active && apply(r));
    return () => {
      active = false;
    };
  }, [orderId]);

  const byId = useMemo(() => new Map((meals ?? []).map((m) => [m.id, m])), [meals]);
  const maxServings = choice?.orderItem ? Math.min(MAX_SERVINGS, choice.orderItem.quantity) : MAX_SERVINGS;

  const select = (c: Choice) => {
    setChoice(c);
    setServings(1);
    setError(null);
  };

  // Same meal already logged that day (only today's entries are loaded).
  const dayEntries = day === today ? entries : [];
  const alreadyLogged =
    mode === 'menu'
      ? choice
        ? dayEntries.filter((e) => (choice.orderItem ? e.orderItemId === choice.orderItem.orderItemId : e.mealId === choice.meal.id)).length
        : 0
      : dayEntries.filter((e) => e.source === 'manual' && e.mealName.trim().toLowerCase() === manualName.trim().toLowerCase()).length;

  const saveManual = async () => {
    const kcal = parseAmount(manualKcal);
    const problem = manualMealProblem(manualName, kcal);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const macro = (s: string) => {
      const n = parseAmount(s);
      return n === null ? null : Math.max(0, Math.min(300, n));
    };
    const result = await logManual({
      name: manualName,
      kcalPerServing: kcal as number,
      servings,
      localDate: day,
      proteinG: macro(manualProtein),
      carbsG: macro(manualCarbs),
      fatG: macro(manualFat),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    useTrackingStore.getState().refresh({ sync: false });
    router.back();
  };

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    setError(null);
    const result = await logMeal({
      mealId: choice.meal.id,
      servings,
      orderItemId: choice.orderItem?.orderItemId ?? null,
      localDate: day,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message); // a retry reuses the same request key: never a duplicate
      return;
    }
    // The Daily Tracking balance (consumed / remaining) follows immediately.
    useTrackingStore.getState().refresh({ sync: false });
    router.back();
  };

  if (!meals && !loadError) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <ScreenHeader
        title={orderId ? 'J’ai mangé ce repas' : 'Ajouter un repas'}
        subtitle="Ce que vous avez réellement mangé"
        right={
          <TouchableOpacity onPress={() => router.back()} style={styles.close} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={22} color={theme.colors.ink} />
          </TouchableOpacity>
        }
      />
      {loadError ? (
        <View style={styles.section}>
          <FormMessage title="Repas indisponibles" message={loadError} actionLabel="Réessayer" onAction={load} />
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader inset={false} title="Jour" />
        <View style={styles.row}>
          <Chip label="Aujourd’hui" active={day === today} onPress={() => setDay(today)} />
          <Chip label="Hier" active={day === addDays(today, -1)} onPress={() => setDay(addDays(today, -1))} />
        </View>
      </View>

      {!orderId ? (
        <View style={styles.section}>
          <View style={styles.row}>
            <Chip
              label="Repas L’OPTION"
              active={mode === 'menu'}
              onPress={() => {
                setMode('menu');
                setError(null);
              }}
            />
            <Chip
              label="Autre repas"
              active={mode === 'manual'}
              onPress={() => {
                setMode('manual');
                setServings(1);
                setError(null);
              }}
            />
          </View>
        </View>
      ) : null}

      {mode === 'manual' ? (
        <View style={styles.section}>
          <SurfaceCard style={styles.confirm}>
            <Text style={styles.confirmTitle}>Un repas hors L’OPTION</Text>
            <TextField
              label="Nom du repas"
              value={manualName}
              onChangeText={setManualName}
              maxLength={80}
              placeholder="ex. Tajine maison"
            />
            <TextField
              label="Calories par portion"
              value={manualKcal}
              onChangeText={setManualKcal}
              keyboardType="numeric"
              suffix="kcal"
              hint="Sur l’emballage ou une estimation : elle sera indiquée comme saisie par vous."
            />
            <Stepper
              label="Quantité"
              value={formatServings(servings)}
              canDecrease={servings - STEP >= STEP}
              canIncrease={servings + STEP <= MAX_SERVINGS}
              onDecrease={() => setServings((s) => Math.max(STEP, +(s - STEP).toFixed(2)))}
              onIncrease={() => setServings((s) => Math.min(MAX_SERVINGS, +(s + STEP).toFixed(2)))}
            />
            {showMacros ? (
              <>
                <TextField
                  label="Protéines (par portion)"
                  value={manualProtein}
                  onChangeText={setManualProtein}
                  keyboardType="numeric"
                  suffix="g"
                />
                <TextField
                  label="Glucides (par portion)"
                  value={manualCarbs}
                  onChangeText={setManualCarbs}
                  keyboardType="numeric"
                  suffix="g"
                />
                <TextField label="Lipides (par portion)" value={manualFat} onChangeText={setManualFat} keyboardType="numeric" suffix="g" />
              </>
            ) : (
              <TouchableOpacity accessibilityRole="button" onPress={() => setShowMacros(true)}>
                <Text style={styles.link}>Ajouter protéines, glucides, lipides (facultatif)</Text>
              </TouchableOpacity>
            )}
            {parseAmount(manualKcal) ? (
              <Text style={styles.preview}>{`≈ ${formatNumber(Math.round((parseAmount(manualKcal) as number) * servings))} kcal`}</Text>
            ) : null}
            {alreadyLogged > 0 ? <Text style={styles.note}>{`Déjà enregistré aujourd’hui (×${alreadyLogged}).`}</Text> : null}
            {error ? <FormMessage title="Repas non enregistré" message={error} /> : null}
            <BrandButton
              title={alreadyLogged > 0 ? 'Enregistrer encore' : 'Enregistrer'}
              onPress={saveManual}
              loading={saving}
            />
          </SurfaceCard>
        </View>
      ) : null}

      {mode === 'menu' && orderId && meals && ordered.length === 0 ? (
        <View style={styles.section}>
          <FormMessage
            title="Commande pas encore livrée"
            message="Un repas commandé peut être enregistré une fois la commande reçue."
            tone="info"
          />
        </View>
      ) : null}

      {mode === 'menu' && ordered.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader inset={false} title={orderId ? 'Cette commande' : 'Mes commandes reçues'} />
          <SurfaceCard style={styles.list}>
            {ordered.map((o) => {
              const meal = byId.get(o.mealId);
              const selected = choice?.orderItem?.orderItemId === o.orderItemId;
              return (
                <MealRow
                  key={o.orderItemId}
                  name={o.mealName}
                  detail={
                    meal
                      ? `${formatNumber(meal.calories)} kcal / portion · commandé ×${o.quantity}`
                      : 'Valeurs nutritionnelles indisponibles : ne peut pas être enregistré'
                  }
                  selected={selected}
                  disabled={!meal}
                  onPress={() => meal && select({ meal, orderItem: o })}
                />
              );
            })}
          </SurfaceCard>
        </View>
      ) : null}

      {mode === 'menu' ? (
        <View style={styles.section}>
          <SectionHeader inset={false} title="Menu L’OPTION" />
          <SurfaceCard style={styles.list}>
            {(meals ?? []).length === 0 ? (
              <Text style={styles.empty}>Aucun repas avec une valeur calorique fiable pour le moment.</Text>
            ) : (
              (meals ?? []).map((m) => (
                <MealRow
                  key={m.id}
                  name={m.name}
                  detail={`${formatNumber(m.calories)} kcal / portion`}
                  selected={!choice?.orderItem && choice?.meal.id === m.id}
                  onPress={() => select({ meal: m, orderItem: null })}
                />
              ))
            )}
          </SurfaceCard>
          <Text style={styles.note}>
            Les calories proviennent des fiches repas de L’OPTION. Les repas sans valeur fiable ne peuvent pas être enregistrés.
          </Text>
        </View>
      ) : null}

      {mode === 'menu' && choice ? (
        <View style={styles.section}>
          <SurfaceCard style={styles.confirm}>
            <Text style={styles.confirmTitle}>{choice.meal.name}</Text>
            <Stepper
              label="Quantité"
              value={formatServings(servings)}
              canDecrease={servings - STEP >= STEP}
              canIncrease={servings + STEP <= maxServings}
              onDecrease={() => setServings((s) => Math.max(STEP, +(s - STEP).toFixed(2)))}
              onIncrease={() => setServings((s) => Math.min(maxServings, +(s + STEP).toFixed(2)))}
            />
            <Text style={styles.preview}>{`≈ ${formatNumber(Math.round(choice.meal.calories * servings))} kcal`}</Text>
            {alreadyLogged > 0 ? <Text style={styles.note}>{`Déjà enregistré aujourd’hui (×${alreadyLogged}).`}</Text> : null}
            {error ? <FormMessage title="Repas non enregistré" message={error} /> : null}
            <BrandButton
              title={alreadyLogged > 0 ? 'Enregistrer encore' : error ? 'Réessayer' : 'Enregistrer'}
              onPress={save}
              loading={saving}
            />
          </SurfaceCard>
        </View>
      ) : null}
    </Screen>
  );
}

function MealRow({
  name,
  detail,
  selected,
  disabled,
  onPress,
}: {
  name: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.mealRow, selected && styles.mealRowSelected, disabled && styles.disabled]}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={`${name}. ${detail}`}
    >
      <View style={styles.mealText}>
        <Text style={styles.mealName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.mealDetail}>{detail}</Text>
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'add-circle-outline'}
        size={22}
        color={disabled ? theme.colors.inkFaint : theme.colors.brand}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  link: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brand,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  list: {
    paddingVertical: theme.spacing.xs,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.md,
  },
  mealRowSelected: {
    backgroundColor: theme.colors.brandSoft,
  },
  disabled: {
    opacity: 0.5,
  },
  mealText: {
    flex: 1,
    minWidth: 0,
  },
  mealName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  mealDetail: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  empty: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
    paddingVertical: theme.spacing.md,
  },
  note: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  confirm: {
    gap: theme.spacing.md,
  },
  confirmTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  preview: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brand,
  },
});
