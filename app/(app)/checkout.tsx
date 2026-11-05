import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { useCartStore } from '../../src/stores/cartStore';
import { useUserStore } from '../../src/stores/userStore';
import { CHECKOUT_CLOSED_MESSAGE, CHECKOUT_CLOSED_TITLE, CHECKOUT_OPEN } from '../../src/checkout/checkoutAvailability';
import { createOrder, fetchActivePricing, type ActivePricing } from '../../src/services/checkoutApi';
import { fetchServedCities, notServedMessage } from '../../src/delivery/cities';
import { randomUUID } from 'expo-crypto';

// Checkout is locked (owner decision 2026-11-05) until create_order() is on
// the server with approved pricing; then CHECKOUT_OPEN is switched in a
// reviewed change. Even open, this screen never writes an order: it sends the
// meal ids and quantities to create_order(), which prices, validates and
// creates the order. Fees are shown only from the approved pricing.
export default function CheckoutScreen() {
  // Pre-filled with the delivery address the customer confirmed, if any.
  const [address, setAddress] = useState(() => useUserStore.getState().profile?.delivery_address ?? '');
  const { items, getTotalPrice, clearCart } = useCartStore();
  const subtotal = getTotalPrice();
  const [pricing, setPricing] = useState<ActivePricing | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderMessage, setOrderMessage] = useState<string | null>(null);
  // One request id per checkout attempt: a retry after a lost answer returns
  // the same order instead of creating a second one.
  const requestId = useRef<string | null>(null);
  // Delivery zones (Casablanca first): a customer whose city is not served is
  // told here too. The server refuses the order anyway (create_order).
  const deliveryCity = useUserStore((s) => s.profile?.delivery_city ?? null);
  const [served, setServed] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchServedCities().then((list) => !cancelled && setServed(list));
    return () => {
      cancelled = true;
    };
  }, []);
  const outOfZone = !!deliveryCity && !!served && !served.includes(deliveryCity);

  useEffect(() => {
    if (!CHECKOUT_OPEN) return;
    let cancelled = false;
    void fetchActivePricing().then((p) => {
      if (!cancelled) setPricing(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const placeOrder = async () => {
    if (!CHECKOUT_OPEN || !pricing || items.length === 0) return;
    requestId.current ??= randomUUID();
    setPlacing(true);
    setOrderMessage(null);
    const result = await createOrder({
      kitchenId: pricing.kitchenId,
      items: items.map((i) => ({ mealId: i.id, quantity: i.quantity, notes: i.notes ?? null })),
      requestId: requestId.current,
    });
    setPlacing(false);
    if (result.ok) {
      requestId.current = null;
      clearCart();
      router.replace(`/(app)/order-tracking/${result.orderId}`);
    } else {
      setOrderMessage(result.message);
    }
  };
  const canOrder = CHECKOUT_OPEN && !outOfZone && !!pricing && items.length > 0 && address.trim().length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>
          <TextInput
            style={styles.addressInput}
            placeholder="Enter your full address"
            placeholderTextColor={theme.colors.textLight}
            value={address}
            onChangeText={setAddress}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          {items.map((item) => (
            <View key={item.id} style={styles.orderItem}>
              <View style={styles.orderItemInfo}>
                <Text style={styles.orderItemName}>
                  {item.quantity}x {item.name}
                </Text>
                {item.notes && (
                  <Text style={styles.orderItemNotes}>Note: {item.notes}</Text>
                )}
              </View>
              <Text style={styles.orderItemPrice}>
                {item.price * item.quantity} MAD
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <View
            style={[styles.paymentOption, styles.paymentOptionSelected]}
            testID="payment-method-cod"
          >
            <Ionicons name="cash-outline" size={24} color={theme.colors.gold} />
            <Text style={[styles.paymentText, styles.paymentTextSelected]}>
              Cash on Delivery
            </Text>
            <Ionicons name="checkmark-circle" size={24} color={theme.colors.gold} />
          </View>
          <Text style={styles.paymentNote}>
            Pay in cash when your order is delivered. Card payment is not available yet.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{subtotal} MAD</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Delivery Fee</Text>
            <Text style={styles.summaryValue}>{pricing ? `${pricing.deliveryFee} MAD` : 'À confirmer'}</Text>
          </View>
          {pricing ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Service Fee</Text>
              <Text style={styles.summaryValue}>{`${pricing.serviceFee} MAD`}</Text>
            </View>
          ) : null}
          <View style={[styles.summaryRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {pricing ? `${subtotal + pricing.deliveryFee + pricing.serviceFee} MAD (avant offre éventuelle)` : 'Calculé à la commande'}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {outOfZone ? (
          <View style={styles.closedNotice} testID="checkout-out-of-zone">
            <Text style={styles.closedTitle}>Pas encore dans votre ville</Text>
            <Text style={styles.closedText}>{notServedMessage(deliveryCity)}</Text>
          </View>
        ) : null}
        {!CHECKOUT_OPEN ? (
          <View style={styles.closedNotice} testID="checkout-closed" accessibilityLiveRegion="polite">
            <Text style={styles.closedTitle}>{CHECKOUT_CLOSED_TITLE}</Text>
            <Text style={styles.closedText}>{CHECKOUT_CLOSED_MESSAGE}</Text>
          </View>
        ) : null}
        {orderMessage ? <Text style={styles.closedText}>{orderMessage}</Text> : null}
        {/* Disabled until create_order() is on the server with approved pricing
            (CHECKOUT_OPEN): there is no client-side order creation. */}
        <Button title="Place Order" variant="gold" onPress={() => void placeOrder()} disabled={!canOrder} loading={placing} size="lg" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  closedNotice: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  closedTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  closedText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
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
  content: {
    flex: 1,
  },
  section: {
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.md,
  },
  addressInput: {
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.md,
    padding: theme.spacing.md,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.textDark,
    minHeight: 80,
    textAlignVertical: 'top',
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
  orderItemNotes: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  orderItemPrice: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  paymentOptionSelected: {
    backgroundColor: theme.colors.gold + '20',
    borderWidth: 1,
    borderColor: theme.colors.gold,
  },
  paymentText: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.textDark,
  },
  paymentNote: {
    fontSize: 13,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  paymentTextSelected: {
    color: theme.colors.gold,
    fontWeight: theme.typography.weights.medium,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
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