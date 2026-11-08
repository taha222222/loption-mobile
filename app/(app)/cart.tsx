// Mon panier: what is in the basket (one line per meal and set of choices),
// the products subtotal (menu prices, TVA included) and the fees that are
// calculated at checkout. The subtotal is never presented as the amount to
// pay: service and delivery fees are computed by the server once the
// delivery details are known.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { BrandButton, EmptyState, IconButton, confirmAction, formatNumber } from '../../src/components/v2';
import { Divider, PriceRow, SectionTitle, Thumbnail } from '../../src/components/checkout/OrderPieces';
import { useCartStore, type CartItem } from '../../src/stores/cartStore';
import { describeOptions, formatMad } from '../../src/menu/customization';
import { cartTotals, FEE_PENDING_DELIVERY, FEE_PENDING_SERVICE, TVA_INCLUDED_NOTE } from '../../src/checkout/checkoutSummary';

export default function CartScreen() {
  const items = useCartStore((s) => s.items);
  const count = useCartStore((s) => s.getItemCount());
  const totals = cartTotals(items);

  const clear = () =>
    confirmAction('Vider le panier', 'Retirer tous les plats de votre panier ?', 'Vider', () => useCartStore.getState().clearCart());

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="arrow-back" label="Retour" onPress={() => router.back()} />
        <Text style={styles.headerTitle} accessibilityRole="header">
          {items.length ? `Mon panier (${count})` : 'Mon panier'}
        </Text>
        {items.length ? (
          <TouchableOpacity onPress={clear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Vider le panier">
            <Text style={styles.clearText}>Vider</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.clear} />
        )}
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon="bag-handle-outline"
          title="Votre panier est vide"
          message="Choisissez vos repas dans le menu."
          actionLabel="Voir le menu"
          onAction={() => router.push('/(app)/menu')}
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              {items.map((item, i) => (
                <React.Fragment key={item.id}>
                  {i > 0 ? <Divider /> : null}
                  <CartLine item={item} />
                </React.Fragment>
              ))}
              <TouchableOpacity onPress={() => router.push('/(app)/menu')} style={styles.addMore} accessibilityRole="button">
                <Ionicons name="add" size={18} color={theme.colors.brand} />
                <Text style={styles.addMoreText}>Ajouter d’autres plats</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <SectionTitle>Récapitulatif</SectionTitle>
              <PriceRow label="Sous-total produits" value={formatMad(totals.productsSubtotal)} testID="cart-subtotal" />
              {totals.optionsTotal > 0 ? <PriceRow label="dont options" value={formatMad(totals.optionsTotal)} /> : null}
              <PriceRow label="Frais de service" value={FEE_PENDING_SERVICE} pending />
              <PriceRow label="Frais de livraison" value={FEE_PENDING_DELIVERY} pending />
              <Text style={styles.note}>{TVA_INCLUDED_NOTE}</Text>
              {totals.calories > 0 ? (
                <Text style={styles.nutrition} testID="cart-nutrition">
                  {`Apport estimé : ${formatNumber(totals.calories)} kcal · ${formatNumber(totals.protein)} g de protéines`}
                </Text>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerTotal}>
              <Text style={styles.footerLabel}>Sous-total</Text>
              <Text style={styles.footerAmount}>{formatMad(totals.productsSubtotal)}</Text>
            </View>
            <BrandButton title="Continuer" onPress={() => router.push('/(app)/checkout')} style={styles.cta} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function CartLine({ item }: { item: CartItem }) {
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const options = describeOptions(item.options);
  const lineTotal = Math.round(item.price * 100 * item.quantity) / 100;
  return (
    <View style={styles.line} testID={`cart-line-${item.id}`}>
      <View style={styles.lineTop}>
        <Thumbnail uri={item.image} />
        <View style={styles.lineText}>
          <Text style={styles.lineName} numberOfLines={2}>
            {item.name}
          </Text>
          {options ? <Text style={styles.lineMeta}>{options}</Text> : null}
          {item.notes ? <Text style={styles.lineMeta}>{`Note : ${item.notes}`}</Text> : null}
          {item.calories ? (
            <Text style={styles.lineNutrition}>{`${formatNumber(item.calories)} kcal · ${item.protein} g protéines`}</Text>
          ) : null}
        </View>
        <Text style={styles.lineTotal} testID={`cart-line-total-${item.id}`}>
          {formatMad(lineTotal)}
        </Text>
      </View>
      <View style={styles.lineActions}>
        <View style={styles.qty}>
          <TouchableOpacity
            onPress={() => updateQuantity(item.id, item.quantity - 1)}
            disabled={item.quantity <= 1}
            style={styles.qtyButton}
            accessibilityRole="button"
            accessibilityLabel={`Diminuer la quantité de ${item.name}`}
          >
            <Ionicons name="remove" size={18} color={item.quantity <= 1 ? theme.colors.inkFaint : theme.colors.ink} />
          </TouchableOpacity>
          <Text style={styles.qtyValue}>{item.quantity}</Text>
          <TouchableOpacity
            onPress={() => updateQuantity(item.id, item.quantity + 1)}
            disabled={item.quantity >= 20}
            style={styles.qtyButton}
            accessibilityRole="button"
            accessibilityLabel={`Augmenter la quantité de ${item.name}`}
          >
            <Ionicons name="add" size={18} color={item.quantity >= 20 ? theme.colors.inkFaint : theme.colors.ink} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/(app)/meal/[id]', params: { id: item.mealId, line: item.id } })}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={`Modifier ${item.name}`}
        >
          <Text style={styles.actionText}>Modifier</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => removeItem(item.id)}
          style={styles.remove}
          accessibilityRole="button"
          accessibilityLabel={`Retirer ${item.name}`}
        >
          <Ionicons name="trash-outline" size={18} color={theme.colors.inkMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  clearText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.error },
  scroll: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl, gap: theme.spacing.lg },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing.lg },
  line: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  lineTop: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  lineText: { flex: 1, gap: 2 },
  lineName: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  lineMeta: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.ink },
  lineNutrition: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, marginTop: 2 },
  lineTotal: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  lineActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingLeft: 64 + theme.spacing.md },
  qty: { flexDirection: 'row', alignItems: 'center', borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.colors.hairline },
  qtyButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 20, textAlign: 'center', fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  action: { minHeight: 44, paddingHorizontal: theme.spacing.sm, justifyContent: 'center', marginLeft: 'auto' },
  actionText: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.brand },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, marginTop: theme.spacing.sm, minHeight: 44 },
  addMoreText: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.brand },
  note: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, marginTop: theme.spacing.sm },
  nutrition: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, marginTop: theme.spacing.xs },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
  },
  footerTotal: { gap: 2 },
  footerLabel: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted },
  footerAmount: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.extrabold, color: theme.colors.ink },
  cta: { flex: 1 },
});
