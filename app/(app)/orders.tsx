import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';

interface Order {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
}

export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return theme.colors.pending;
      case 'preparing':
        return theme.colors.preparing;
      case 'on_the_way':
        return theme.colors.onTheWay;
      case 'delivered':
        return theme.colors.delivered;
      default:
        return theme.colors.textLight;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'checkmark-circle';
      case 'preparing':
        return 'restaurant';
      case 'on_the_way':
        return 'bicycle';
      case 'delivered':
        return 'home';
      default:
        return 'time';
    }
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="receipt-outline" size={80} color={theme.colors.textLight} />
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>Your order history will appear here</Text>
          <TouchableOpacity
            style={styles.orderButton}
            onPress={() => router.push('/(app)/menu')}
          >
            <Text style={styles.orderButtonText}>Start Ordering</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.ordersContainer}
        >
          {orders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => router.push(`/(app)/order-tracking/${order.id}`)}
            >
              <View style={styles.orderHeader}>
                <Text style={styles.orderNumber}>#{order.order_number}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getStatusColor(order.status) + '20' },
                  ]}
                >
                  <Ionicons
                    name={getStatusIcon(order.status) as any}
                    size={14}
                    color={getStatusColor(order.status)}
                  />
                  <Text
                    style={[styles.statusText, { color: getStatusColor(order.status) }]}
                  >
                    {order.status.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.orderFooter}>
                <Text style={styles.orderDate}>
                  {new Date(order.created_at).toLocaleDateString()}
                </Text>
                <Text style={styles.orderTotal}>{order.total} MAD</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  orderButton: {
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    marginTop: theme.spacing.xl,
  },
  orderButtonText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.dark,
  },
  ordersContainer: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  orderCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  orderNumber: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
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
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderDate: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  orderTotal: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
});