import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '../../../src/theme';
import { Button } from '../../../src/components/ui/Button';
import { supabase } from '../../../src/lib/supabase';
import { locationService } from '../../../src/services/locationService';
import { DriverMap } from '../../../src/components/maps/DriverMap';
import { RECEIVED_ORDER_STATUSES } from '../../../src/services/nutritionApi';

type OrderStatus = 'confirmed' | 'preparing' | 'accepted' | 'picked_up' | 'on_the_way' | 'delivered';

interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  total: number;
  delivery_address: string;
  created_at: string;
}

const statusSteps = [
  { key: 'confirmed', label: 'Confirmed', icon: 'checkmark-circle' },
  { key: 'preparing', label: 'Preparing', icon: 'restaurant' },
  { key: 'on_the_way', label: 'On The Way', icon: 'bicycle' },
  { key: 'delivered', label: 'Delivered', icon: 'home' },
];

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationSubscription, setLocationSubscription] = useState<any>(null);
  const [orderSubscription, setOrderSubscription] = useState<any>(null);

  useEffect(() => {
    fetchOrder();
    
    // Setup order subscription
    const subscription = supabase
      .channel(`order-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          setOrder(payload.new as Order);
        }
      )
      .subscribe();
    
    setOrderSubscription(subscription);
    
    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [id]);

  useEffect(() => {
    if (order && (order.status === 'accepted' || order.status === 'picked_up' || order.status === 'on_the_way')) {
      // Subscribe to driver location updates
      const subscription = locationService.subscribeToDriverLocation(order.id, (location) => {
        setDriverLocation({ latitude: location.latitude, longitude: location.longitude });
      });
      setLocationSubscription(subscription);
      
      // Get initial location
      locationService.getDriverLocation(order.id).then((loc) => {
        if (loc) {
          setDriverLocation({ latitude: loc.latitude, longitude: loc.longitude });
        }
      });
      
      return () => {
        if (subscription) {
          subscription.unsubscribe();
        }
      };
    }
  }, [order]);

  const fetchOrder = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (!error && data) {
      setOrder(data);
    }
    setLoading(false);
  };

  const getCurrentStepIndex = () => {
    if (!order) return 0;
    return statusSteps.findIndex((step) => step.key === order.status);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.gold} />
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color={theme.colors.error} />
          <Text style={styles.errorText}>Order not found</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentStep = getCurrentStepIndex();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Track Order</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.orderInfo}>
        <Text style={styles.orderNumber}>Order #{order.order_number}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {order.status === 'confirmed' && 'Confirmed'}
            {order.status === 'preparing' && 'Being Prepared'}
            {order.status === 'accepted' && 'Accepted'}
            {order.status === 'picked_up' && 'Picked Up'}
            {order.status === 'on_the_way' && 'On The Way'}
            {order.status === 'delivered' && 'Delivered'}
          </Text>
        </View>
      </View>

      {/* Status Timeline */}
      <View style={styles.timeline}>
        {statusSteps.map((step, index) => {
          const isCompleted = index <= currentStep;
          const isCurrent = index === currentStep;

          return (
            <View key={step.key} style={styles.timelineStep}>
              <View
                style={[
                  styles.timelineIcon,
                  isCompleted && styles.timelineIconCompleted,
                  isCurrent && styles.timelineIconCurrent,
                ]}
              >
                <Ionicons
                  name={step.icon as any}
                  size={24}
                  color={isCompleted ? theme.colors.gold : theme.colors.textLight}
                />
              </View>
              {index < statusSteps.length - 1 && (
                <View
                  style={[
                    styles.timelineLine,
                    isCompleted && styles.timelineLineCompleted,
                  ]}
                />
              )}
              <Text
                style={[
                  styles.timelineLabel,
                  isCompleted && styles.timelineLabelCompleted,
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Driver Map - Show when order is active */}
      {(order.status === 'accepted' || order.status === 'picked_up' || order.status === 'on_the_way') && (
        <View style={styles.mapSection}>
          <Text style={styles.mapTitle}>Driver Location</Text>
          <DriverMap 
            driverLocation={driverLocation} 
            orderStatus={order.status}
          />
        </View>
      )}

      {/* Delivery Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Delivery Address</Text>
        <Text style={styles.infoText}>{order.delivery_address}</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Estimated Delivery</Text>
        <Text style={styles.infoText}>
          {order.status === 'delivered'
            ? 'Delivered'
            : order.status === 'on_the_way'
            ? '15-25 minutes'
            : 'Processing your order'}
        </Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Total Amount</Text>
        <Text style={styles.infoText}>{order.total} MAD</Text>
      </View>

      {RECEIVED_ORDER_STATUSES.includes(order.status) ? (
        <Button
          title="J’ai mangé ce repas"
          onPress={() => router.push({ pathname: '/(app)/log-meal', params: { orderId: order.id } })}
          style={styles.backButton}
        />
      ) : null}

      <Button
        title="Back to Orders"
        variant="outline"
        onPress={() => router.push('/(app)/orders')}
        style={styles.backButton}
      />
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
  },
  backText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.gold,
    marginTop: theme.spacing.lg,
  },
  orderInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
  },
  orderNumber: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  statusBadge: {
    backgroundColor: theme.colors.gold + '20',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.spacing.md,
  },
  statusText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.gold,
  },
  timeline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing['3xl'],
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
  },
  timelineIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    top: 24,
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
  mapSection: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  mapTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.sm,
  },
  infoCard: {
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  infoTitle: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.xs,
  },
  infoText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textDark,
  },
  backButton: {
    margin: theme.spacing.xl,
  },
});