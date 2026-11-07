import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { QuantitySelector } from '../../src/components/ui/QuantitySelector';
import { BrandButton, EmptyState, Screen, SurfaceCard, formatNumber } from '../../src/components/v2';
import { useCartStore } from '../../src/stores/cartStore';
import { describeOptions, formatMad } from '../../src/menu/customization';

export default function CartScreen() {
  const {
    items,
    updateQuantity,
    removeItem,
    updateNotes,
    getTotalPrice,
    getTotalCalories,
    getTotalProtein,
    getItemCount,
  } = useCartStore();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const handleUpdateNotes = (id: string, text: string) => {
    setNotes((prev) => ({ ...prev, [id]: text }));
    updateNotes(id, text);
  };

  const handleCheckout = () => {
    if (items.length === 0) {
      Alert.alert('Panier vide', 'Ajoutez des repas à votre panier');
      return;
    }
    router.push('/(app)/checkout');
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Retour">
        <Ionicons name="arrow-back" size={22} color={theme.colors.ink} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {items.length === 0 ? 'Panier' : `Panier (${getItemCount()})`}
      </Text>
      {items.length === 0 ? (
        <View style={styles.iconButtonSpacer} />
      ) : (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={() => Alert.alert(
            'Vider le panier',
            'Voulez-vous vraiment vider votre panier ?',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Vider', style: 'destructive', onPress: () => useCartStore.getState().clearCart() },
            ]
          )}
        >
          <Text style={styles.clearText}>Vider</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (items.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="cart-outline"
          title="Votre panier est vide"
          message="Ajoutez des repas sains pour commencer"
          actionLabel="Voir le menu"
          onAction={() => router.push('/(app)/menu')}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.content}
        contentContainerStyle={styles.contentInner}
      >
        {items.map((item) => (
          <SurfaceCard key={item.id} style={styles.cartItem}>
            <View style={styles.itemTop}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                {item.options.length ? (
                  <Text style={styles.itemOptions} testID={`cart-options-${item.id}`}>
                    {describeOptions(item.options)}
                  </Text>
                ) : null}
                <Text style={styles.itemMacros}>
                  {`${formatNumber(item.calories)}\u00A0kcal · ${item.protein}\u00A0g protéines`}
                </Text>
              </View>
              <Text style={styles.itemPrice}>{formatMad(Math.round(item.price * 100 * item.quantity) / 100)}</Text>
            </View>

            <View style={styles.itemActions}>
              <QuantitySelector
                quantity={item.quantity}
                onIncrease={() => updateQuantity(item.id, item.quantity + 1)}
                onDecrease={() => updateQuantity(item.id, item.quantity - 1)}
              />
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/(app)/meal/[id]', params: { id: item.mealId, line: item.id } })}
                style={styles.editButton}
                accessibilityRole="button"
                accessibilityLabel={`Modifier ${item.name}`}
              >
                <Text style={styles.editText}>Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeItem(item.id)}
                style={styles.removeButton}
                accessibilityLabel="Retirer"
              >
                <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.notesInput}
              placeholder="Instructions spéciales..."
              placeholderTextColor={theme.colors.inkFaint}
              value={notes[item.id] ?? item.notes ?? ''}
              onChangeText={(text) => handleUpdateNotes(item.id, text)}
            />
          </SurfaceCard>
        ))}

        <SurfaceCard style={styles.summary}>
          <Text style={styles.summaryTitle}>Récapitulatif</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Sous-total</Text>
            <Text style={styles.summaryValue}>{formatMad(getTotalPrice())}</Text>
          </View>
          {/* Service and delivery fees come from the server at checkout (road
              distance quote); the cart shows no fee of its own. */}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Frais de service et livraison</Text>
            <Text style={styles.summaryValue}>Calculés au paiement</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Calories totales</Text>
            <Text style={styles.summaryValue}>{`${formatNumber(getTotalCalories())}\u00A0kcal`}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Protéines totales</Text>
            <Text style={styles.summaryValue}>{`${getTotalProtein()}\u00A0g`}</Text>
          </View>
          <View style={[styles.summaryRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total produits</Text>
            <Text style={styles.totalValue}>{formatMad(getTotalPrice())}</Text>
          </View>
        </SurfaceCard>
      </ScrollView>

      <View style={styles.footer}>
        <BrandButton
          title="Continuer vers le paiement"
          onPress={handleCheckout}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonSpacer: {
    width: 44,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  clearButton: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  clearText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.error,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cartItem: {
    gap: theme.spacing.md,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  itemMacros: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
    marginTop: 4,
  },
  itemOptions: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.ink,
    marginTop: 2,
  },
  editButton: {
    marginLeft: 'auto',
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    justifyContent: 'center',
  },
  editText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brand,
  },
  itemPrice: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  removeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesInput: {
    backgroundColor: theme.colors.canvas,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.ink,
  },
  summary: {
    marginTop: theme.spacing.xs,
  },
  summaryTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    marginBottom: theme.spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  summaryLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  summaryValue: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  totalLabel: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  totalValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
});
