import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { EmptyState, IconBadge, Screen, ScreenHeader, StatusBadge, SurfaceCard, formatPrice } from '../../src/components/v2';

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

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'Confirmée';
      case 'preparing':
        return 'En préparation';
      case 'on_the_way':
        return 'En route';
      case 'delivered':
        return 'Livrée';
      default:
        return status.replace('_', ' ');
    }
  };

  if (loading) {
    return (
      <Screen contentStyle={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader subtitle="Historique" title="Commandes" />

      {orders.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="Aucune commande"
          message="Votre historique de commandes apparaîtra ici"
          actionLabel="Commander un repas"
          onAction={() => router.push('/(app)/menu')}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.ordersContainer}
        >
          {orders.map((order) => (
            <SurfaceCard
              key={order.id}
              style={styles.orderCard}
              onPress={() => router.push(`/(app)/order-tracking/${order.id}`)}
            >
              <IconBadge icon="receipt-outline" />
              <View style={styles.orderBody}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderNumber} numberOfLines={1}>#{order.order_number}</Text>
                  <StatusBadge
                    label={getStatusLabel(order.status)}
                    color={getStatusColor(order.status)}
                    icon={getStatusIcon(order.status) as any}
                  />
                </View>
                <View style={styles.orderFooter}>
                  <Text style={styles.orderDate}>
                    {new Date(order.created_at).toLocaleDateString('fr-FR')}
                  </Text>
                  <Text style={styles.orderTotal}>{formatPrice(order.total)}</Text>
                </View>
              </View>
            </SurfaceCard>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ordersContainer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  orderBody: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  orderNumber: {
    flexShrink: 1,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderDate: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  orderTotal: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
});
