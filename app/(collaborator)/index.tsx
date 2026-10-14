import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { useCollaboratorStore } from '../../src/stores/collaboratorStore';
import { useAuthStore } from '../../src/stores/authStore';

const { width } = Dimensions.get('window');

export default function CollaboratorDashboard() {
  const { user } = useAuthStore();
  const { profile, stats, orders, fetchProfile, fetchStats, fetchOrders, isLoading } = useCollaboratorStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchStats();
      fetchOrders();
    }
  }, [user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    await fetchStats();
    await fetchOrders();
    setRefreshing(false);
  };

  const activeOrders = orders.filter(o => o.preparation_status !== 'ready' && o.preparation_status !== 'rejected');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Partner Dashboard</Text>
            <Text style={styles.branchName}>{profile?.branch_name || 'Loading...'}</Text>
          </View>
          <TouchableOpacity style={styles.notificationButton}>
            <Ionicons name="notifications-outline" size={24} color={theme.colors.textWhite} />
          </TouchableOpacity>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.totalRevenueToday || 0} MAD</Text>
            <Text style={styles.statLabel}>Today's Revenue</Text>
          </LinearGradient>
          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.totalOrdersToday || 0}</Text>
            <Text style={styles.statLabel}>Total Orders</Text>
          </LinearGradient>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.smallStatCard}>
            <Text style={styles.smallStatValue}>{stats?.pendingOrders || 0}</Text>
            <Text style={styles.smallStatLabel}>Pending</Text>
          </View>
          <View style={styles.smallStatCard}>
            <Text style={styles.smallStatValue}>{stats?.preparingOrders || 0}</Text>
            <Text style={styles.smallStatLabel}>Preparing</Text>
          </View>
          <View style={styles.smallStatCard}>
            <Text style={styles.smallStatValue}>{stats?.readyOrders || 0}</Text>
            <Text style={styles.smallStatLabel}>Ready</Text>
          </View>
          <View style={styles.smallStatCard}>
            <Text style={styles.smallStatValue}>{stats?.deliveredOrders || 0}</Text>
            <Text style={styles.smallStatLabel}>Delivered</Text>
          </View>
        </View>

        {/* Earnings Split Card */}
        <LinearGradient
          colors={['#D4A757', '#B8860B']}
          style={styles.earningsCard}
        >
          <Text style={styles.earningsTitle}>Revenue Split (50/50)</Text>
          <View style={styles.splitRow}>
            <View style={styles.splitItem}>
              <Text style={styles.splitValue}>{stats?.collaboratorEarnings || 0} MAD</Text>
              <Text style={styles.splitLabel}>Your Share</Text>
            </View>
            <View style={styles.splitDivider} />
            <View style={styles.splitItem}>
              <Text style={styles.splitValue}>{stats?.loptionEarnings || 0} MAD</Text>
              <Text style={styles.splitLabel}>L'OPTION Share</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Active Orders Section */}
        <View style={styles.ordersSection}>
          <Text style={styles.sectionTitle}>Active Orders ({activeOrders.length})</Text>
          {activeOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={48} color={theme.colors.textLight} />
              <Text style={styles.emptyText}>No active orders</Text>
            </View>
          ) : (
            activeOrders.map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderCard}
                onPress={() => router.push(`./(collaborator)/orders/${order.order_id}`)}
              >
                <View style={styles.orderHeader}>
                  <Text style={styles.orderNumber}>{order.order_number}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(order.preparation_status) + '20' }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(order.preparation_status) }]}>
                      {order.preparation_status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.orderTotal}>{order.order_total} MAD</Text>
                <Text style={styles.orderShare}>Your share: {order.collaborator_share} MAD</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending': return '#f59e0b';
    case 'accepted': return '#3b82f6';
    case 'preparing': return '#8b5cf6';
    case 'ready': return '#10b981';
    case 'rejected': return '#ef4444';
    default: return '#64748b';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1115',
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
    color: '#9CA3AF',
  },
  branchName: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  notificationButton: {
    padding: theme.spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  statCard: {
    flex: 1,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 4,
  },
  smallStatCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  smallStatValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  smallStatLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 2,
  },
  earningsCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
  },
  earningsTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: '#0F1115',
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  splitItem: {
    alignItems: 'center',
  },
  splitValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: '#0F1115',
  },
  splitLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#0F1115',
    opacity: 0.7,
    marginTop: 2,
  },
  splitDivider: {
    width: 1,
    backgroundColor: '#0F1115',
    opacity: 0.2,
  },
  ordersSection: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
    marginBottom: theme.spacing.md,
  },
  orderCard: {
    backgroundColor: '#1E293B',
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
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.spacing.sm,
  },
  statusText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
  },
  orderTotal: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
    marginBottom: 4,
  },
  orderShare: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
  },
  emptyState: {
    alignItems: 'center',
    padding: theme.spacing['3xl'],
    backgroundColor: '#1E293B',
    borderRadius: theme.spacing.lg,
  },
  emptyText: {
    fontSize: theme.typography.sizes.md,
    color: '#9CA3AF',
    marginTop: theme.spacing.md,
  },
});