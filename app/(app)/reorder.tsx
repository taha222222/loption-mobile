import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient'; 
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { useCartStore } from '../../src/stores/cartStore';

// Mock last order data
const lastOrder = {
  id: 'last_order_1',
  date: 'Yesterday, 7:30 PM',
  total: 189,
  items: [
    { id: '1', name: 'Grilled Chicken Bowl', quantity: 1, price: 69, calories: 450, protein: 35 },
    { id: '2', name: 'Protein Smoothie', quantity: 1, price: 39, calories: 320, protein: 28 },
    { id: '3', name: 'Avocado Toast', quantity: 1, price: 55, calories: 380, protein: 12 },
  ],
};

export default function ReorderScreen() {
  const [loading, setLoading] = useState(false);
  const { addItem, getTotalPrice } = useCartStore();

  const handleOneTapReorder = () => {
    setLoading(true);
    
    // Add all items from last order to cart
    lastOrder.items.forEach(item => {
      addItem({
        id: item.id,
        name: item.name,
        price: item.price,
        calories: item.calories,
        protein: item.protein,
      });
    });
    
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Order Added!',
        `${lastOrder.items.length} items added to your cart. Proceed to checkout?`,
        [
          { text: 'Keep Shopping', style: 'cancel' },
          { text: 'Checkout', onPress: () => router.push('/(app)/cart') },
        ]
      );
    }, 500);
  };

  const handleCustomize = () => {
    // Add items to cart for customization
    lastOrder.items.forEach(item => {
      addItem({
        id: item.id,
        name: item.name,
        price: item.price,
        calories: item.calories,
        protein: item.protein,
      });
    });
    router.push('/(app)/cart');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Quick Reorder</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
        {/* One-Tap Reorder Button - Primary CTA */}
      <TouchableOpacity 
  style={styles.oneTapCard}
  onPress={handleOneTapReorder}
  disabled={loading}
>
  <LinearGradient
    colors={['#e11d48', '#be123c']}  
    style={styles.oneTapGradient}
  >
    <Ionicons name="flash" size={36} color="#fff" />
    <View style={styles.oneTapContent}>
      <Text style={styles.oneTapTitle}>⚡ 1-TAP REORDER ⚡</Text>
      <Text style={styles.oneTapSubtitle}>Reorder in 1 second • Free delivery</Text>
    </View>
    <Ionicons name="arrow-forward" size={28} color="#fff" />
  </LinearGradient>
       </TouchableOpacity>

        {/* Last Order Summary */}
        <View style={styles.orderCard}>
          <Text style={styles.sectionTitle}>Last Order</Text>
          <Text style={styles.orderDate}>{lastOrder.date}</Text>
          
          {lastOrder.items.map((item, index) => (
            <View key={index} style={styles.orderItem}>
              <View style={styles.orderItemInfo}>
                <Text style={styles.orderItemName}>{item.name}</Text>
                <Text style={styles.orderItemMeta}>
                  {item.calories} cal • {item.protein}g protein
                </Text>
              </View>
              <Text style={styles.orderItemPrice}>{item.price} MAD</Text>
            </View>
          ))}
          
          <View style={styles.orderTotal}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{lastOrder.total} MAD</Text>
          </View>
        </View>

        {/* Customize Button */}
        <TouchableOpacity 
          style={styles.customizeButton}
          onPress={handleCustomize}
        >
          <Ionicons name="create-outline" size={20} color={theme.colors.accent} />
          <Text style={styles.customizeText}>Customize this order</Text>
        </TouchableOpacity>

        {/* Suggested Add-ons */}
        <View style={styles.addonsSection}>
          <Text style={styles.sectionTitle}>Frequently Bought Together</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.addonsScroll}>
            <TouchableOpacity style={styles.suggestedAddon}>
              <Text style={styles.addonEmoji}>🥤</Text>
              <Text style={styles.addonName}>Protein Shake</Text>
              <Text style={styles.addonPrice}>+39 MAD</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.suggestedAddon}>
              <Text style={styles.addonEmoji}>🍪</Text>
              <Text style={styles.addonName}>Protein Cookie</Text>
              <Text style={styles.addonPrice}>+19 MAD</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.suggestedAddon}>
              <Text style={styles.addonEmoji}>🥗</Text>
              <Text style={styles.addonName}>Extra Chicken</Text>
              <Text style={styles.addonPrice}>+25 MAD</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="REORDER NOW - ONE TAP"
          variant="gold"
          onPress={handleOneTapReorder}
          loading={loading}
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
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing.xl,
  },
  oneTapCard: {
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
    marginBottom: theme.spacing.xl,
  },
  oneTapGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  oneTapContent: {
    flex: 1,
  },
  oneTapTitle: {
  fontSize: theme.typography.sizes.lg,
  fontWeight: theme.typography.weights.bold,
  color: '#fff',  // White text on red
  letterSpacing: 1,
  },
  oneTapSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textWhite,
    opacity: 0.8,
    marginTop: 2,
  },
  orderCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.xs,
  },
  orderDate: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.md,
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  orderItemInfo: {
    flex: 1,
  },
  orderItemName: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textDark,
  },
  orderItemMeta: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  orderItemPrice: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  orderTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
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
  customizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: theme.spacing.lg,
  },
  customizeText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.accent,
    fontWeight: theme.typography.weights.medium,
  },
  addonsSection: {
    marginBottom: theme.spacing.xl,
  },
  addonsScroll: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  suggestedAddon: {
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    marginRight: theme.spacing.md,
    minWidth: 100,
    ...theme.shadows.sm,
  },
  addonEmoji: {
    fontSize: 32,
    marginBottom: theme.spacing.sm,
  },
  addonName: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textDark,
  },
  addonPrice: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
    marginTop: 4,
  },
  footer: {
    padding: theme.spacing.xl,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
});