import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { useCollaboratorStore } from '../../src/stores/collaboratorStore';

type OrderFilter = 'all' | 'pending' | 'accepted' | 'preparing' | 'ready' | 'rejected';

export default function CollaboratorOrders() {
  const { orders, fetchOrders, isLoading } = useCollaboratorStore();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchOrders();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const getFilteredOrders = () => {
    let filtered = [...orders];
    
    if (filter !== 'all') {
      filtered = filtered.filter(o => o.preparation_status === filter);
    }
    
    if (searchQuery) {
      filtered = filtered.filter(o => 
        o.order_number?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  };

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return 'time-outline';
      case 'accepted': return 'checkmark-circle';
      case 'preparing': return 'restaurant-outline';
      case 'ready': return 'cube-outline';
      case 'rejected': return 'close-circle';
      default: return 'ellipse-outline';
    }
  };

  const filteredOrders = getFilteredOrders();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color="#6B7280" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by order number..."
          placeholderTextColor="#6B7280"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery !== '' && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color="#6B7280" />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'pending' && styles.filterActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.filterText, filter === 'pending' && styles.filterTextActive]}>Pending</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'accepted' && styles.filterActive]}
          onPress={() => setFilter('accepted')}
        >
          <Text style={[styles.filterText, filter === 'accepted' && styles.filterTextActive]}>Accepted</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'preparing' && styles.filterActive]}
          onPress={() => setFilter('preparing')}
        >
          <Text style={[styles.filterText, filter === 'preparing' && styles.filterTextActive]}>Preparing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'ready' && styles.filterActive]}
          onPress={() => setFilter('ready')}
        >
          <Text style={[styles.filterText, filter === 'ready' && styles.filterTextActive]}>Ready</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'rejected' && styles.filterActive]}
          onPress={() => setFilter('rejected')}
        >
          <Text style={[styles.filterText, filter === 'rejected' && styles.filterTextActive]}>Rejected</Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.ordersContainer}
      >
        {filteredOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={64} color={theme.colors.textLight} />
            <Text style={styles.emptyTitle}>No orders found</Text>
            <Text style={styles.emptyText}>Orders will appear here when customers place them</Text>
          </View>
        ) : (
          filteredOrders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => router.push(`./(collaborator)/orders/${order.order_id}`)}
            >
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.orderNumber}>{order.order_number}</Text>
                  <Text style={styles.orderDate}>
                    {new Date(order.created_at).toLocaleTimeString()}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(order.preparation_status) + '20' }]}>
                  <Ionicons name={getStatusIcon(order.preparation_status)} size={12} color={getStatusColor(order.preparation_status)} />
                  <Text style={[styles.statusText, { color: getStatusColor(order.preparation_status) }]}>
                    {order.preparation_status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <Text style={styles.orderAddress} numberOfLines={1}>
                {order.customer_address}
              </Text>

              <View style={styles.orderFooter}>
                <Text style={styles.orderTotal}>{order.order_total} MAD</Text>
                <Text style={styles.orderShare}>Your share: {order.collaborator_share} MAD</Text>
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
    backgroundColor: '#0F1115',
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    color: '#FFFFFF',
  },
  filterContainer: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  filterTab: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: 24,
    backgroundColor: '#1E293B',
    marginRight: theme.spacing.sm,
  },
  filterActive: {
    backgroundColor: '#D4A757',
  },
  filterText: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
  },
  filterTextActive: {
    color: '#0F1115',
    fontWeight: theme.typography.weights.semibold,
  },
  ordersContainer: {
    padding: theme.spacing.xl,
    paddingTop: 0,
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
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  orderNumber: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  orderDate: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
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
  orderAddress: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
    marginBottom: theme.spacing.md,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  orderTotal: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  orderShare: {
    fontSize: theme.typography.sizes.xs,
    color: '#10b981',
  },
  emptyState: {
    alignItems: 'center',
    padding: theme.spacing['3xl'],
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
    marginTop: theme.spacing.md,
  },
  emptyText: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
});