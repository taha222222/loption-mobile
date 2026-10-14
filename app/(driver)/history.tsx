import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { supabase } from '../../src/lib/supabase';

interface DeliveryHistory {
  id: string;
  order_number: string;
  delivery_address: string;
  delivery_fee: number;
  status: string;
  delivered_at: string | null;
}

export default function DriverHistory() {
  const { user } = useAuthStore();
  const [deliveries, setDeliveries] = useState<DeliveryHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user, filter]);

  const fetchHistory = async () => {
    if (!user) return;
    
    setLoading(true);
    
    let query = supabase
      .from('orders')
      .select('id, order_number, delivery_address, delivery_fee, status, delivered_at')
      .eq('driver_id', user.id);
    
    if (filter === 'completed') {
      query = query.eq('status', 'delivered');
    } else if (filter === 'cancelled') {
      query = query.in('status', ['cancelled', 'rejected']);
    }
    
    const { data } = await query.order('created_at', { ascending: false });
    
    if (data) {
      setDeliveries(data);
    }
    
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return theme.colors.success;
      case 'cancelled': return theme.colors.error;
      default: return theme.colors.warning;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered': return 'checkmark-circle';
      case 'cancelled': return 'close-circle';
      default: return 'time-outline';
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Pending';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Delivery History</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'completed' && styles.filterActive]}
          onPress={() => setFilter('completed')}
        >
          <Text style={[styles.filterText, filter === 'completed' && styles.filterTextActive]}>Completed</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'cancelled' && styles.filterActive]}
          onPress={() => setFilter('cancelled')}
        >
          <Text style={[styles.filterText, filter === 'cancelled' && styles.filterTextActive]}>Cancelled</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        {deliveries.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={64} color={theme.colors.textLight} />
            <Text style={styles.emptyTitle}>No deliveries yet</Text>
            <Text style={styles.emptyText}>Your delivery history will appear here</Text>
          </View>
        ) : (
          deliveries.map((delivery) => (
            <TouchableOpacity
              key={delivery.id}
              style={styles.deliveryCard}
              onPress={() => router.push(`/(driver)/orders/${delivery.id}`)}
            >
              <View style={styles.deliveryHeader}>
                <View style={styles.deliveryInfo}>
                  <Text style={styles.deliveryNumber}>{delivery.order_number}</Text>
                  <Text style={styles.deliveryAddress} numberOfLines={1}>{delivery.delivery_address}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(delivery.status) + '20' }]}>
                  <Ionicons name={getStatusIcon(delivery.status)} size={12} color={getStatusColor(delivery.status)} />
                  <Text style={[styles.statusText, { color: getStatusColor(delivery.status) }]}>
                    {delivery.status.toUpperCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.deliveryFooter}>
                <Text style={styles.deliveryDate}>{formatDate(delivery.delivered_at)}</Text>
                <Text style={styles.deliveryFee}>+{delivery.delivery_fee} MAD</Text>
              </View>
            </TouchableOpacity>
          ))
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
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  filterTab: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    borderRadius: theme.spacing.lg,
    backgroundColor: theme.colors.backgroundDark,
  },
  filterActive: {
    backgroundColor: theme.colors.accent,
  },
  filterText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textLight,
  },
  filterTextActive: {
    color: theme.colors.textWhite,
  },
  content: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  deliveryCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    ...theme.shadows?.sm || {},
  },
  deliveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  deliveryInfo: {
    flex: 1,
  },
  deliveryNumber: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  deliveryAddress: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.spacing.sm,
    gap: 4,
  },
  statusText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
  },
  deliveryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  deliveryDate: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
  },
  deliveryFee: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.success,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: theme.spacing['5xl'],
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginTop: theme.spacing.lg,
  },
  emptyText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
  },
});