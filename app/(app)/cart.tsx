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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { QuantitySelector } from '../../src/components/ui/QuantitySelector';
import { useCartStore } from '../../src/stores/cartStore';

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
      Alert.alert('Cart Empty', 'Please add items to your cart');
      return;
    }
    router.push('/(app)/checkout');
  };

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Cart</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="cart-outline" size={80} color={theme.colors.textLight} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Add healthy meals to get started</Text>
          <Button
            title="Browse Menu"
            variant="gold"
            onPress={() => router.push('/(app)/menu')}
            style={styles.browseButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cart ({getItemCount()})</Text>
        <TouchableOpacity onPress={() => Alert.alert(
          'Clear Cart',
          'Are you sure you want to clear your cart?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: () => useCartStore.getState().clearCart() },
          ]
        )}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
        {items.map((item) => (
          <View key={item.id} style={styles.cartItem}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMacros}>
                {item.calories} cal • {item.protein}g protein
              </Text>
              <Text style={styles.itemPrice}>{item.price} MAD</Text>
            </View>

            <View style={styles.itemActions}>
              <QuantitySelector
                quantity={item.quantity}
                onIncrease={() => updateQuantity(item.id, item.quantity + 1)}
                onDecrease={() => updateQuantity(item.id, item.quantity - 1)}
              />
              <TouchableOpacity
                onPress={() => removeItem(item.id)}
                style={styles.removeButton}
              >
                <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.notesInput}
              placeholder="Special instructions..."
              placeholderTextColor={theme.colors.textLight}
              value={notes[item.id] || ''}
              onChangeText={(text) => handleUpdateNotes(item.id, text)}
            />
          </View>
        ))}

        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Order Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{getTotalPrice()} MAD</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Delivery Fee</Text>
            <Text style={styles.summaryValue}>15 MAD</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Calories</Text>
            <Text style={styles.summaryValue}>{getTotalCalories()} cal</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Protein</Text>
            <Text style={styles.summaryValue}>{getTotalProtein()} g</Text>
          </View>
          <View style={[styles.summaryRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{getTotalPrice() + 15} MAD</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Checkout • ${getTotalPrice() + 15} MAD`}
          variant="gold"
          onPress={handleCheckout}
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  clearText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.error,
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginTop: theme.spacing.lg,
  },
  emptyText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
  browseButton: {
    marginTop: theme.spacing.xl,
  },
  cartItem: {
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  itemInfo: {
    flex: 1,
    marginBottom: theme.spacing.md,
  },
  itemName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  itemMacros: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
    marginTop: 4,
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  removeButton: {
    padding: theme.spacing.sm,
  },
  notesInput: {
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.md,
    padding: theme.spacing.sm,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
    marginTop: theme.spacing.sm,
  },
  summary: {
    backgroundColor: theme.colors.backgroundDark,
    margin: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  summaryTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  summaryLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  summaryValue: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  totalLabel: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  totalValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  footer: {
    padding: theme.spacing.xl,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
});