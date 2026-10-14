import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { useAuthStore } from '../../src/stores/authStore';
import { supabase } from '../../src/lib/supabase';
import * as Location from 'expo-location';

interface Order {
  id: string;
  order_number: string;
  delivery_address: string;
  total: number;
  delivery_fee: number;
  created_at: string;
}

export default function DriverDashboard() {
  const { user } = useAuthStore();
  const [isOnline, setIsOnline] = useState(false);
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [earnings, setEarnings] = useState({ today: 0, week: 0, total: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<any>(null);

  useEffect(() => {
    if (user) {
      fetchDriverStatus();
      fetchAvailableOrders();
      fetchActiveOrder();
      fetchEarnings();
    }
  }, [user]);

  useEffect(() => {
    const subscription = supabase
      .channel('driver-orders')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'orders', filter: 'driver_id=is.null' },
        () => fetchAvailableOrders()
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Clean up location tracking on unmount
  useEffect(() => {
    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [locationSubscription]);

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Location permission is required to share your location with customers');
      return false;
    }
    return true;
  };

  const startLocationTracking = async (driverId: string) => {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) return;

    // Get initial location
    const location = await Location.getCurrentPositionAsync({});
    await updateDriverLocation(driverId, location.coords.latitude, location.coords.longitude);

    // Start watching position
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      async (newLocation) => {
        await updateDriverLocation(driverId, newLocation.coords.latitude, newLocation.coords.longitude);
      }
    );

    setLocationSubscription(subscription);
  };

  const updateDriverLocation = async (driverId: string, latitude: number, longitude: number) => {
    // Update drivers table
    await supabase
      .from('drivers')
      .update({
        current_latitude: latitude,
        current_longitude: longitude,
        last_location_update: new Date().toISOString(),
      })
      .eq('id', driverId);

    // Update active order if any
    if (activeOrder) {
      await supabase
        .from('orders')
        .update({
          driver_latitude: latitude,
          driver_longitude: longitude,
          last_location_update: new Date().toISOString(),
        })
        .eq('driver_id', driverId)
        .in('status', ['accepted', 'picked_up', 'on_the_way']);
    }
  };

  const stopLocationTracking = () => {
    if (locationSubscription) {
      locationSubscription.remove();
      setLocationSubscription(null);
    }
  };

const fetchDriverStatus = async () => {
  if (!user) return;
  
  // Use maybeSingle() and also handle the case of multiple rows
  const { data, error } = await supabase
    .from('drivers')
    .select('status')
    .eq('id', user.id)
    .maybeSingle();
  
  if (error) {
    console.log('Error fetching driver status:', error);
  }
  
  // If data is an array (multiple rows), take the first one
  const status = Array.isArray(data) ? data[0]?.status : data?.status;
  
  if (status) {
    setIsOnline(status === 'online');
  }
};

  const fetchAvailableOrders = async () => {
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, delivery_address, total, delivery_fee, created_at')
      .eq('status', 'confirmed')
      .is('driver_id', null);
    
    if (data) {
      setAvailableOrders(data);
    }
  };

const fetchActiveOrder = async () => {
  if (!user) return;
  
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, delivery_address, total, delivery_fee, created_at')
    .eq('driver_id', user.id)
    .in('status', ['accepted', 'picked_up', 'on_the_way'])
    .maybeSingle();  
  
  if (data) {
    setActiveOrder(data);
  } else {
    setActiveOrder(null);
  }
};

const fetchEarnings = async () => {
  if (!user) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const { data } = await supabase
    .from('orders')
    .select('delivery_fee, delivered_at')
    .eq('driver_id', user.id)
    .eq('status', 'delivered');
  
  if (data && data.length > 0) {
    const todayEarnings = data
      .filter(o => new Date(o.delivered_at) >= today)
      .reduce((sum, o) => sum + o.delivery_fee, 0);
    
    const weekEarnings = data
      .filter(o => new Date(o.delivered_at) >= weekAgo)
      .reduce((sum, o) => sum + o.delivery_fee, 0);
    
    const totalEarnings = data.reduce((sum, o) => sum + o.delivery_fee, 0);
    
    setEarnings({ today: todayEarnings, week: weekEarnings, total: totalEarnings });
  } else {
    setEarnings({ today: 0, week: 0, total: 0 });
  }
};

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDriverStatus();
    await fetchAvailableOrders();
    await fetchActiveOrder();
    await fetchEarnings();
    setRefreshing(false);
  };

  const handleToggleStatus = async () => {
    if (!user) return;
    
    const newStatus = !isOnline;
    const { error } = await supabase
      .from('drivers')
      .update({ status: newStatus ? 'online' : 'offline' })
      .eq('id', user.id);
    
    if (!error) {
      setIsOnline(newStatus);
      
      if (newStatus) {
        // Start location tracking when going online
        await startLocationTracking(user.id);
        setIsTrackingLocation(true);
        Alert.alert('You are now ONLINE', 'Your location will be shared with customers');
      } else {
        // Stop location tracking when going offline
        stopLocationTracking();
        setIsTrackingLocation(false);
        Alert.alert('You are now OFFLINE', 'You will not receive new orders');
      }
    }
  };

  const handleAcceptOrder = async (orderId: string) => {
  if (!user) return;
  
  Alert.alert(
    'Accept Delivery',
    'Are you sure you want to accept this delivery?',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept',
        onPress: async () => {
          // Atomic update - only accept if driver_id is still null
          const { data, error } = await supabase
            .from('orders')
            .update({ 
              driver_id: user.id, 
              status: 'accepted', 
              accepted_at: new Date().toISOString() 
            })
            .eq('id', orderId)
            .is('driver_id', null)  // ✅ Only accept if no driver assigned yet
            .select();
          
          if (error) {
            Alert.alert('Error', 'Failed to accept order');
          } else if (data && data.length === 0) {
            Alert.alert('Order Taken', 'This order has already been accepted by another driver');
          } else {
            await fetchAvailableOrders();
            await fetchActiveOrder();
            Alert.alert('Order Accepted', 'Navigate to pick up the order');
          }
        },
      },
    ]
  );
};

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Driver Dashboard</Text>
            <Text style={styles.name}>{user?.email?.split('@')[0] || 'Driver'}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/(driver)/profile')}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={24} color={theme.colors.textWhite} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Status Card */}
        <View style={styles.statusCard}>
          <View>
            <Text style={styles.statusLabel}>Current Status</Text>
            <Text style={[styles.statusValue, isOnline && styles.statusOnline]}>
              {isOnline ? '🟢 ONLINE' : '⚫ OFFLINE'}
            </Text>
            {isTrackingLocation && (
              <Text style={styles.trackingText}>📍 Sharing location</Text>
            )}
          </View>
          <Button
            title={isOnline ? 'GO OFFLINE' : 'GO ONLINE'}
            variant={isOnline ? 'danger' : 'success'}
            onPress={handleToggleStatus}
            size="sm"
          />
        </View>

        {/* Active Order */}
        {activeOrder && (
          <View style={styles.activeSection}>
            <Text style={styles.sectionTitle}>ACTIVE DELIVERY</Text>
            <TouchableOpacity 
              style={styles.activeCard}
              onPress={() => router.push(`/(driver)/orders/${activeOrder.id}`)}
            >
              <Text style={styles.activeOrderNumber}>{activeOrder.order_number}</Text>
              <Text style={styles.activeAddress}>{activeOrder.delivery_address}</Text>
              <Text style={styles.activeFee}>+{activeOrder.delivery_fee} MAD</Text>
              <View style={styles.activeStatus}>
                <Text style={styles.activeStatusText}>Tap to navigate →</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Earnings Preview */}
        <View style={styles.earningsSection}>
          <Text style={styles.sectionTitle}>TODAY'S EARNINGS</Text>
          <View style={styles.earningsCard}>
            <View style={styles.earningItem}>
              <Text style={styles.earningValue}>{earnings.today} MAD</Text>
              <Text style={styles.earningLabel}>Today</Text>
            </View>
            <View style={styles.earningDivider} />
            <View style={styles.earningItem}>
              <Text style={styles.earningValue}>{earnings.week} MAD</Text>
              <Text style={styles.earningLabel}>This Week</Text>
            </View>
            <View style={styles.earningDivider} />
            <View style={styles.earningItem}>
              <Text style={styles.earningValue}>{earnings.total} MAD</Text>
              <Text style={styles.earningLabel}>Total</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => router.push('/(driver)/earnings')}>
            <Text style={styles.earningsLink}>View Details →</Text>
          </TouchableOpacity>
        </View>

        {/* Available Orders */}
        {isOnline && (
          <View style={styles.ordersSection}>
            <Text style={styles.sectionTitle}>AVAILABLE ORDERS ({availableOrders.length})</Text>
            {availableOrders.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="bicycle-outline" size={48} color={theme.colors.textLight} />
                <Text style={styles.emptyText}>No orders available</Text>
                <Text style={styles.emptySubtext}>Check back later</Text>
              </View>
            ) : (
              availableOrders.map((order) => (
                <View key={order.id} style={styles.orderCard}>
                  <View style={styles.orderHeader}>
                    <Text style={styles.orderNumber}>{order.order_number}</Text>
                    <Text style={styles.orderFee}>+{order.delivery_fee} MAD</Text>
                  </View>
                  <View style={styles.orderAddress}>
                    <Ionicons name="location-outline" size={16} color={theme.colors.textLight} />
                    <Text style={styles.addressText}>{order.delivery_address}</Text>
                  </View>
                  <View style={styles.orderFooter}>
                    <Text style={styles.orderTotal}>{order.total} MAD</Text>
                    <Button
                      title="ACCEPT"
                      variant="primary"
                      size="sm"
                      onPress={() => handleAcceptOrder(order.id)}
                    />
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
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
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  greeting: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  name: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  statusLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  statusValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.error,
  },
  statusOnline: {
    color: theme.colors.success,
  },
  trackingText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
    marginTop: 4,
  },
  activeSection: {
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
    letterSpacing: 1,
    marginBottom: theme.spacing.md,
  },
  activeCard: {
    backgroundColor: theme.colors.accent + '10',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  activeOrderNumber: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.accent,
  },
  activeAddress: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
    marginTop: theme.spacing.sm,
  },
  activeFee: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.success,
    marginTop: theme.spacing.sm,
  },
  activeStatus: {
    marginTop: theme.spacing.md,
    alignItems: 'flex-end',
  },
  activeStatusText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.accent,
  },
  earningsSection: {
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
  },
  earningsCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    justifyContent: 'space-around',
  },
  earningItem: {
    alignItems: 'center',
    flex: 1,
  },
  earningValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  earningLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 4,
  },
  earningDivider: {
    width: 1,
    backgroundColor: theme.colors.border,
  },
  earningsLink: {
    marginTop: theme.spacing.sm,
    textAlign: 'right',
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.accent,
  },
  ordersSection: {
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  orderCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  orderNumber: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  orderFee: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.success,
  },
  orderAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  addressText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  orderTotal: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  emptyState: {
    alignItems: 'center',
    padding: theme.spacing['3xl'],
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.lg,
  },
  emptyText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textDark,
    marginTop: theme.spacing.md,
  },
  emptySubtext: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
});