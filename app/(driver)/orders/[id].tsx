import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../../src/theme';
import { Button } from '../../../src/components/ui/Button';
import { useAuthStore } from '../../../src/stores/authStore';
import { supabase } from '../../../src/lib/supabase';

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  total: number;
  delivery_fee: number;
  platform_service_fee: number;
  delivery_address: string;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  created_at: string;
  items: any[];
  cash_collected: boolean;
}

export default function DriverOrderDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchOrderDetails();
    // Return the unsubscribe so the channel is removed on unmount / id change.
    return subscribeToOrderUpdates();
  }, [id]);

  const fetchOrderDetails = async () => {
    // Get the order
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('id', id)
      .maybeSingle();
    
    if (!orderError && orderData) {
      // Get customer profile
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('full_name, phone')
        .eq('user_id', orderData.user_id)
        .maybeSingle();
      
      // Check if cash was already collected
      const { data: cashData } = await supabase
        .from('cash_collections')
        .select('id')
        .eq('order_id', orderData.id)
        .eq('driver_id', user?.id)
        .maybeSingle();
      
      setOrder({
        id: orderData.id,
        order_number: orderData.order_number,
        status: orderData.status,
        total: orderData.total,
        delivery_fee: orderData.delivery_fee || 15,
        platform_service_fee: orderData.platform_service_fee || 19,
        delivery_address: orderData.delivery_address,
        payment_method: orderData.payment_method || 'cash',
        customer_name: profileData?.full_name || 'Customer',
        customer_phone: profileData?.phone || '',
        customer_email: '',
        created_at: orderData.created_at,
        items: orderData.order_items || [],
        cash_collected: !!cashData,
      });
    }
    setLoading(false);
  };

  const subscribeToOrderUpdates = () => {
    const subscription = supabase
      .channel(`driver-order-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          if (payload.new) {
            setOrder(prev => prev ? { ...prev, status: payload.new.status } : prev);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const updateOrderStatus = async (newStatus: string) => {
    if (!order || !user) return;
    
    setUpdating(true);
    
    const updateData: any = { status: newStatus };
    if (newStatus === 'picked_up') {
      updateData.picked_up_at = new Date().toISOString();
    } else if (newStatus === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    }
    
    const { error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id);
    
    if (!error) {
      setOrder({ ...order, status: newStatus });
      Alert.alert('Success', `Order status updated to ${newStatus}`);
    } else {
      Alert.alert('Error', 'Failed to update order status');
    }
    
    setUpdating(false);
  };

  const handleCashCollected = async () => {
    if (!order || !user) return;
    
    const deliveryAmount = order.delivery_fee;
    
    Alert.alert(
      'Collect Cash',
      `Confirm you have collected ${deliveryAmount} MAD (delivery fee) from the customer?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Collected',
          onPress: async () => {
            setUpdating(true);
            
            // Record cash collection
            const { error } = await supabase
              .from('cash_collections')
              .insert({
                driver_id: user.id,
                order_id: order.id,
                amount: deliveryAmount,
                order_number: order.order_number,
                collected_at: new Date().toISOString(),
              });
            
            if (!error) {
              setOrder({ ...order, cash_collected: true });
              Alert.alert(
                'Cash Collected', 
                `You have collected ${deliveryAmount} MAD.\n\nThis amount will be recorded and you will receive your 15% commission (${Math.round(deliveryAmount * 0.15)} MAD) in your weekly payout.`
              );
              
              // Auto-mark as delivered if not already
              if (order.status !== 'delivered') {
                await updateOrderStatus('delivered');
              }
            } else {
              Alert.alert('Error', 'Failed to record cash collection');
            }
            
            setUpdating(false);
          },
        },
      ]
    );
  };

  const openNavigation = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order?.delivery_address || '')}`;
    Linking.openURL(url);
  };

  const callCustomer = () => {
    if (order?.customer_phone) {
      Linking.openURL(`tel:${order.customer_phone}`);
    } else {
      Alert.alert('No phone number', 'Customer phone number not available');
    }
  };

  const getStatusSteps = () => {
    const steps = [
      { key: 'accepted', label: 'Accepted', icon: 'checkmark-circle' },
      { key: 'picked_up', label: 'Picked Up', icon: 'restaurant' },
      { key: 'on_the_way', label: 'On The Way', icon: 'bicycle' },
      { key: 'delivered', label: 'Delivered', icon: 'home' },
    ];
    
    const currentIndex = steps.findIndex(s => s.key === order?.status);
    
    return steps.map((step, index) => ({
      ...step,
      completed: index <= currentIndex,
      current: index === currentIndex,
    }));
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.gold} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color={theme.colors.error} />
        <Text style={styles.errorText}>Order not found</Text>
        <Button title="Go Back" onPress={() => router.back()} />
      </View>
    );
  }

  const statusSteps = getStatusSteps();
  const isCashPayment = order.payment_method === 'cash';
  const needsCashCollection = isCashPayment && !order.cash_collected && order.status === 'delivered';
  const commissionAmount = Math.round(order.delivery_fee * 0.15);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Order #{order.order_number}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Status Timeline */}
        <View style={styles.timelineContainer}>
          {statusSteps.map((step, index) => (
            <View key={step.key} style={styles.timelineStep}>
              <View style={[
                styles.timelineIcon,
                step.completed && styles.timelineIconCompleted,
                step.current && styles.timelineIconCurrent,
              ]}>
                <Ionicons
                  name={step.icon as any}
                  size={20}
                  color={step.completed ? theme.colors.gold : theme.colors.textLight}
                />
              </View>
              {index < statusSteps.length - 1 && (
                <View style={[
                  styles.timelineLine,
                  step.completed && styles.timelineLineCompleted,
                ]} />
              )}
              <Text style={[
                styles.timelineLabel,
                step.completed && styles.timelineLabelCompleted,
              ]}>
                {step.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Payment Method Card */}
        <View style={[styles.paymentCard, { backgroundColor: isCashPayment ? '#f59e0b20' : '#10b98120' }]}>
          <Ionicons 
            name={isCashPayment ? "cash-outline" : "card-outline"} 
            size={24} 
            color={isCashPayment ? '#f59e0b' : '#10b981'} 
          />
          <Text style={styles.paymentText}>
            Payment: <Text style={[styles.paymentValue, { color: isCashPayment ? '#f59e0b' : '#10b981' }]}>
              {isCashPayment ? 'Cash on Delivery' : 'Card Payment'}
            </Text>
          </Text>
        </View>

        {/* Cash Collection Status */}
        {isCashPayment && (
          <View style={[styles.cashStatusCard, { backgroundColor: order.cash_collected ? '#10b98120' : '#f59e0b20' }]}>
            <Ionicons 
              name={order.cash_collected ? "checkmark-circle" : "alert-circle"} 
              size={20} 
              color={order.cash_collected ? '#10b981' : '#f59e0b'} 
            />
            <Text style={[styles.cashStatusText, { color: order.cash_collected ? '#10b981' : '#f59e0b' }]}>
              {order.cash_collected ? 'Cash collected ✓' : 'Awaiting cash collection'}
            </Text>
          </View>
        )}

        {/* Customer Info Card */}
        <View style={styles.contactCard}>
          <Text style={styles.contactTitle}>Customer Information</Text>
          <View style={styles.customerRow}>
            <Ionicons name="person-outline" size={18} color={theme.colors.textLight} />
            <Text style={styles.customerText}>{order.customer_name}</Text>
          </View>
          <View style={styles.customerRow}>
            <Ionicons name="call-outline" size={18} color={theme.colors.textLight} />
            <Text style={styles.customerText}>{order.customer_phone || 'No phone provided'}</Text>
          </View>
        </View>

        {/* Map Preview */}
        <View style={styles.mapContainer}>
          <View style={styles.mapFallback}>
            <Ionicons name="map-outline" size={48} color={theme.colors.textLight} />
            <Text style={styles.mapFallbackTitle}>Delivery Location</Text>
            <Text style={styles.mapFallbackAddress} numberOfLines={2}>
              {order.delivery_address}
            </Text>
          </View>
          <TouchableOpacity style={styles.navigateButton} onPress={openNavigation}>
            <Ionicons name="navigate" size={20} color={theme.colors.textWhite} />
            <Text style={styles.navigateText}>Open in Google Maps</Text>
          </TouchableOpacity>
        </View>

        {/* Order Items */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Order Items</Text>
          {order.items.map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.quantity}x {item.meal_name}</Text>
              <Text style={styles.itemPrice}>{item.price} MAD</Text>
            </View>
          ))}
          
          <View style={styles.infoDivider} />
          
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{order.total - order.delivery_fee} MAD</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Delivery Fee</Text>
            <Text style={styles.totalValue}>+{order.delivery_fee} MAD</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Service Fee</Text>
            <Text style={styles.totalValue}>+{order.platform_service_fee} MAD</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total to Collect (if cash)</Text>
            <Text style={styles.totalValueGold}>{order.total + order.platform_service_fee} MAD</Text>
          </View>
          
          <View style={styles.commissionRow}>
            <Text style={styles.commissionLabel}>Your Commission (15%)</Text>
            <Text style={styles.commissionValue}>+{commissionAmount} MAD</Text>
          </View>
          <Text style={styles.commissionNote}>
            *Commission added to your weekly earnings
          </Text>
        </View>

        {/* Contact Customer Button */}
        <View style={styles.contactSection}>
          <TouchableOpacity style={styles.callButton} onPress={callCustomer}>
            <Ionicons name="call" size={20} color={theme.colors.textWhite} />
            <Text style={styles.callButtonText}>Contact Customer</Text>
          </TouchableOpacity>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionContainer}>
          {order.status === 'accepted' && (
            <Button
              title="Picked Up Order"
              variant="primary"
              onPress={() => updateOrderStatus('picked_up')}
              loading={updating}
              style={styles.actionButton}
            />
          )}
          {order.status === 'picked_up' && (
            <Button
              title="Start Delivery"
              variant="primary"
              onPress={() => updateOrderStatus('on_the_way')}
              loading={updating}
              style={styles.actionButton}
            />
          )}
          {order.status === 'on_the_way' && (
            <Button
              title="Mark as Delivered"
              variant="success"
              onPress={() => updateOrderStatus('delivered')}
              loading={updating}
              style={styles.actionButton}
            />
          )}
          {order.status === 'delivered' && isCashPayment && !order.cash_collected && (
            <Button
              title="Collect Cash"
              variant="gold"
              onPress={handleCashCollected}
              loading={updating}
              style={styles.actionButton}
            />
          )}
          {order.status === 'delivered' && (
            <View style={styles.deliveredBadge}>
              <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />
              <Text style={styles.deliveredText}>Order Completed</Text>
              {isCashPayment && order.cash_collected && (
                <Text style={styles.cashConfirmText}>✓ Cash collected</Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  errorText: {
    fontSize: theme.typography.sizes.lg,
    color: theme.colors.textDark,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
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
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  timelineContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl,
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    borderRadius: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
  },
  timelineIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  timelineIconCompleted: {
    backgroundColor: theme.colors.gold + '20',
  },
  timelineIconCurrent: {
    borderWidth: 2,
    borderColor: theme.colors.gold,
  },
  timelineLine: {
    position: 'absolute',
    top: 20,
    left: '50%',
    right: '-50%',
    height: 2,
    backgroundColor: theme.colors.border,
    zIndex: -1,
  },
  timelineLineCompleted: {
    backgroundColor: theme.colors.gold,
  },
  timelineLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    textAlign: 'center',
  },
  timelineLabelCompleted: {
    color: theme.colors.gold,
    fontWeight: theme.typography.weights.medium,
  },
  paymentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  paymentText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
  },
  paymentValue: {
    fontWeight: theme.typography.weights.semibold,
  },
  cashStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cashStatusText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
  contactCard: {
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  contactTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.sm,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  customerText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
  },
  mapContainer: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  mapFallback: {
    width: '100%',
    height: 200,
    backgroundColor: theme.colors.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  mapFallbackTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginTop: theme.spacing.sm,
  },
  mapFallbackAddress: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    textAlign: 'center',
  },
  navigateButton: {
    position: 'absolute',
    bottom: theme.spacing.md,
    right: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  navigateText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textWhite,
    fontWeight: theme.typography.weights.medium,
  },
  infoCard: {
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  infoTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.sm,
  },
  infoDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  itemName: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
  },
  itemPrice: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  totalLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  totalValue: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  totalValueGold: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  commissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  commissionLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
  },
  commissionValue: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.success,
  },
  commissionNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  contactSection: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.success,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  callButtonText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textWhite,
  },
  actionContainer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  actionButton: {
    marginBottom: theme.spacing.md,
  },
  deliveredBadge: {
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: '#10b98120',
    borderRadius: theme.spacing.lg,
  },
  deliveredText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.success,
    marginTop: theme.spacing.sm,
  },
  cashConfirmText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.success,
    marginTop: 4,
  },
});