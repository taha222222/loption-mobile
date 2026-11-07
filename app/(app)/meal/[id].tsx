// Product page: the meal, its configured choices, a note for the kitchen,
// the quantity, and "Ajouter au panier". Prices shown here are the menu's
// (display only); the server prices the order from the database. With
// `?line=<cart line id>` the page edits that cart line.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { BasketButton, BrandButton, EmptyState, IconButton, TextField } from '../../../src/components/v2';
import {
  chosenOptions,
  formatMad,
  groupHint,
  isRequired,
  isSingleChoice,
  missingChoices,
  popularityLabel,
  toggleOption,
  unitPrice,
  type OptionGroup,
} from '../../../src/menu/customization';
import { fetchMealDetail, fetchMealPopularity, type MealDetail } from '../../../src/services/menuApi';
import { useCartStore } from '../../../src/stores/cartStore';
import { theme } from '../../../src/theme';

type Load = { state: 'loading' } | { state: 'error'; notFound: boolean } | { state: 'ready'; meal: MealDetail; groups: OptionGroup[] };

export default function MealScreen() {
  const { id, line } = useLocalSearchParams<{ id: string; line?: string }>();
  const insets = useSafeAreaInsets();
  const editing = useCartStore((s) => (line ? s.items.find((i) => i.id === line) : undefined));
  const addItem = useCartStore((s) => s.addItem);
  const replaceItem = useCartStore((s) => s.replaceItem);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [selected, setSelected] = useState<string[]>(() => editing?.options.map((o) => o.id) ?? []);
  const [quantity, setQuantity] = useState(editing?.quantity ?? 1);
  const [note, setNote] = useState(editing?.notes ?? '');
  const [showMissing, setShowMissing] = useState(false);
  const [added, setAdded] = useState(false);
  const [customers, setCustomers] = useState<number | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const fetchAll = useCallback(async () => {
    const r = await fetchMealDetail(String(id));
    if (!r.ok) {
      setLoad({ state: 'error', notFound: r.reason === 'not_found' });
      return;
    }
    // Choices that no longer exist are dropped from an edited line.
    const known = new Set(r.groups.flatMap((g) => g.options.map((o) => o.id)));
    setSelected((s) => s.filter((x) => known.has(x)));
    setLoad({ state: 'ready', meal: r.meal, groups: r.groups });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    // State is set when the server answers.
    void Promise.resolve().then(fetchAll);
    void fetchMealPopularity(String(id)).then((n) => !cancelled && setCustomers(n));
    return () => {
      cancelled = true;
    };
  }, [fetchAll, id]);

  const groups = useMemo(() => (load.state === 'ready' ? load.groups : []), [load]);
  const options = useMemo(() => chosenOptions(groups, selected), [groups, selected]);
  const missing = missingChoices(groups, selected);

  if (load.state === 'loading') {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </SafeAreaView>
    );
  }
  if (load.state === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <IconButton icon="arrow-back" label="Retour" onPress={() => router.back()} />
        </View>
        <EmptyState
          icon="restaurant-outline"
          title={load.notFound ? 'Plat introuvable' : 'Impossible de charger ce plat'}
          message={load.notFound ? 'Ce plat n’est plus au menu.' : 'Vérifiez votre connexion et réessayez.'}
          actionLabel={load.notFound ? undefined : 'Réessayer'}
          onAction={
            load.notFound
              ? undefined
              : () => {
                  setLoad({ state: 'loading' });
                  void fetchAll();
                }
          }
        />
      </SafeAreaView>
    );
  }

  const { meal } = load;
  const unit = unitPrice(meal.price, options);
  const total = Math.round(unit * 100 * quantity) / 100;
  const popularity = popularityLabel(customers);

  const submit = () => {
    if (missing.length) {
      setShowMissing(true);
      return;
    }
    const input = { id: meal.id, name: meal.name, price: meal.price, calories: meal.calories, protein: meal.protein, image: meal.imageUrl ?? undefined, options, notes: note };
    if (editing) {
      replaceItem(editing.id, input, quantity);
      router.back();
      return;
    }
    addItem(input, quantity);
    setAdded(true);
  };

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing['2xl'] }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {meal.imageUrl && !imageFailed ? (
            <Image source={{ uri: meal.imageUrl }} style={styles.heroImage} resizeMode="cover" onError={() => setImageFailed(true)} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.heroImage, styles.heroEmpty]}>
              <Ionicons name="restaurant-outline" size={56} color={theme.colors.brand} />
            </View>
          )}
          <View style={[styles.heroBar, { top: insets.top + theme.spacing.sm }]}>
            <IconButton icon="arrow-back" label="Retour" onPress={() => router.back()} />
            <BasketButton />
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.name} accessibilityRole="header">
            {meal.name}
          </Text>
          <Text style={styles.price}>{formatMad(meal.price)}</Text>
          {popularity ? (
            <View style={styles.popularity} testID="meal-popularity">
              <Ionicons name="heart" size={14} color={theme.colors.coral} />
              <Text style={styles.popularityText}>{popularity}</Text>
            </View>
          ) : null}
          {meal.description ? <Text style={styles.description}>{meal.description}</Text> : null}
          <Text style={styles.macros}>
            {[`${meal.calories} kcal`, `${meal.protein} g protéines`, meal.carbs != null ? `${meal.carbs} g glucides` : null, meal.fat != null ? `${meal.fat} g lipides` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {!meal.available ? <Text style={styles.unavailable}>Ce plat n’est pas disponible pour le moment.</Text> : null}
        </View>

        {groups.map((g) => {
          const lacking = showMissing && missing.includes(g.name);
          return (
            <View key={g.id} style={styles.group} testID={`group-${g.name}`}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{g.name}</Text>
                <Text style={[styles.groupHint, isRequired(g) && styles.groupHintRequired, lacking && styles.groupHintMissing]}>
                  {lacking ? 'À choisir' : groupHint(g)}
                </Text>
              </View>
              {g.options.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={styles.option}
                    onPress={() => {
                      setSelected((s) => toggleOption(groups, s, g.id, o.id));
                      setAdded(false);
                    }}
                    accessibilityRole={isSingleChoice(g) ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={o.priceDelta > 0 ? `${o.name}, plus ${formatMad(o.priceDelta)}` : o.name}
                  >
                    <Ionicons
                      name={isSingleChoice(g) ? (on ? 'radio-button-on' : 'radio-button-off') : on ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={on ? theme.colors.brand : theme.colors.inkFaint}
                    />
                    <Text style={styles.optionName}>{o.name}</Text>
                    {o.priceDelta > 0 ? <Text style={styles.optionPrice}>+{formatMad(o.priceDelta)}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}

        <View style={styles.group}>
          <TextField
            label="Instructions pour la cuisine (facultatif)"
            value={note}
            onChangeText={(t) => setNote(t.slice(0, 200))}
            placeholder="Ex. bien cuit, sauce à part"
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.lg) }]}>
        {added ? (
          <View style={styles.added} accessibilityLiveRegion="polite" testID="meal-added">
            <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
            <Text style={styles.addedText}>Ajouté au panier</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/cart')} accessibilityRole="button">
              <Text style={styles.addedLink}>Voir le panier</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {showMissing && missing.length ? (
          <Text style={styles.missing} accessibilityLiveRegion="polite">
            {`Choisissez : ${missing.join(', ')}`}
          </Text>
        ) : null}
        <View style={styles.footerRow}>
          <View style={styles.qty}>
            <TouchableOpacity
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              style={styles.qtyButton}
              accessibilityRole="button"
              accessibilityLabel="Diminuer la quantité"
            >
              <Ionicons name="remove" size={20} color={quantity <= 1 ? theme.colors.inkFaint : theme.colors.ink} />
            </TouchableOpacity>
            <Text style={styles.qtyValue} accessibilityLabel={`Quantité ${quantity}`}>
              {quantity}
            </Text>
            <TouchableOpacity
              onPress={() => setQuantity((q) => Math.min(20, q + 1))}
              disabled={quantity >= 20}
              style={styles.qtyButton}
              accessibilityRole="button"
              accessibilityLabel="Augmenter la quantité"
            >
              <Ionicons name="add" size={20} color={theme.colors.ink} />
            </TouchableOpacity>
          </View>
          <BrandButton
            title={`${editing ? 'Mettre à jour' : 'Ajouter'} · ${formatMad(total)}`}
            onPress={submit}
            disabled={!meal.available}
            style={styles.cta}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  topBar: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  hero: { width: '100%', aspectRatio: 4 / 3, backgroundColor: theme.colors.canvas },
  heroImage: { width: '100%', height: '100%' },
  heroEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.brandSoft },
  heroBar: { position: 'absolute', left: theme.spacing.xl, right: theme.spacing.xl, flexDirection: 'row', justifyContent: 'space-between' },
  body: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl, gap: theme.spacing.sm },
  name: {
    fontSize: theme.typography.sizes['3xl'],
    lineHeight: theme.typography.lineHeights['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.5,
  },
  price: { fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  popularity: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  popularityText: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, fontWeight: theme.typography.weights.semibold },
  description: { fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.ink, marginTop: theme.spacing.xs },
  macros: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  unavailable: { fontSize: theme.typography.sizes.sm, color: theme.colors.error, fontWeight: theme.typography.weights.semibold },
  group: {
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.spacing.xs },
  groupTitle: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  groupHint: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, fontWeight: theme.typography.weights.semibold },
  groupHintRequired: { color: theme.colors.brand },
  groupHintMissing: { color: theme.colors.error },
  option: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 48, paddingVertical: theme.spacing.sm },
  optionName: { flex: 1, fontSize: theme.typography.sizes.md, color: theme.colors.ink },
  optionPrice: { fontSize: theme.typography.sizes.md, color: theme.colors.inkMuted, fontWeight: theme.typography.weights.semibold },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  qty: { flexDirection: 'row', alignItems: 'center', borderRadius: theme.radii.pill, backgroundColor: theme.colors.canvas, height: 56 },
  qtyButton: { width: 48, height: 56, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 24, textAlign: 'center', fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  cta: { flex: 1 },
  added: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  addedText: { flex: 1, fontSize: theme.typography.sizes.sm, color: theme.colors.ink, fontWeight: theme.typography.weights.semibold },
  addedLink: { fontSize: theme.typography.sizes.sm, color: theme.colors.brand, fontWeight: theme.typography.weights.bold },
  missing: { fontSize: theme.typography.sizes.sm, color: theme.colors.error, fontWeight: theme.typography.weights.semibold },
});
