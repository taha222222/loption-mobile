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
import { useCartStore } from '../../src/stores/cartStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useUserStore } from '../../src/stores/userStore';
import { supabase } from '../../src/lib/supabase';
import { notificationService } from '../../src/services/notificationService';
import { buildOrderInsert, COD_PAYMENT_METHOD } from '../../src/checkout/orderPayload';

export default function CheckoutScreen() {
  // Pre-filled with the delivery address the customer confirmed, if any.
  const [address, setAddress] = useState(() => useUserStore.getState().profile?.delivery_address ?? '');
  const [loading, setLoading] = useState(false);
  const { items, getTotalPrice, clearCart } = useCartStore();
  const { user } = useAuthStore();

  const deliveryFee = 15;
  const subtotal = getTotalPrice();
  const total = subtotal + deliveryFee;

  const generateOrderNumber = () => {
    return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  };

  const handlePlaceOrder = async () => {
    if (!address) {
      Alert.alert('Error', 'Please enter your delivery address');
      return;
    }

    if (items.length === 0) {
      Alert.alert('Error', 'Your cart is empty');
      return;
    }

    setLoading(true);

    if (!user) {
      Alert.alert('Error', 'Please sign in again to place your order');
      setLoading(false);
      return;
    }

    const orderNumber = generateOrderNumber();

    // V1 is Cash on Delivery only; buildOrderInsert rejects any other method.
    let orderInsert: ReturnType<typeof buildOrderInsert>;
    try {
      orderInsert = buildOrderInsert({
        userId: user.id,
        orderNumber,
        subtotal,
        deliveryFee,
        deliveryAddress: address,
        paymentMethod: COD_PAYMENT_METHOD,
      });
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'This payment method is not available');
      setLoading(false);
      return;
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert(orderInsert)
      .select()
      .single();

    if (orderError) {
      console.error('Order error:', orderError);
      Alert.alert('Error', 'Failed to place order');
      setLoading(false);
      return;
    }

    const orderItems = items.map((item) => ({
      order_id: order.id,
      meal_id: item.id,
      meal_name: item.name,
      quantity: item.quantity,
      price: item.price,
      notes: item.notes || null,
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Order items error:', itemsError);
      Alert.alert('Error', 'Failed to save order items');
      setLoading(false);
      return;
    }

    clearCart();
    try {
  // Send notification to all online drivers
  await notificationService.sendToAllOnlineDrivers(
    'New Order Available',
    `Order #${orderNumber} - ${total} MAD`,
    { orderId: order.id, type: 'new_order' }
  );
} catch (error) {
  console.log('Notification error:', error);
}

    Alert.alert(
      'Order Placed!',
      `Your order #${orderNumber} has been placed successfully.`,
      [
        {
          text: 'Track Order',
          onPress: () => router.push(`/(app)/order-tracking/${order.id}`),
        },
        {
          text: 'Back to Home',
          onPress: () => router.push('/(app)'),
        },
      ]
    );
  };

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
            <Text style={styles.summaryValue}>{deliveryFee} MAD</Text>
          </View>
          <View style={[styles.summaryRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{total} MAD</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Place Order • ${total} MAD`}
          variant="gold"
          onPress={handlePlaceOrder}
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