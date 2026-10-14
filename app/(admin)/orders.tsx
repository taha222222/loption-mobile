import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { Button } from '../../src/components/ui/Button';

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  total: number;
  status: string;
  delivery_address: string;
  created_at: string;
  driver_name?: string;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchOrders();
  }, [filter]);

  const fetchOrders = async () => {
    let query = supabase
      .from('orders')
      .select(`
        *,
        drivers:driver_id (first_name, last_name)
      `)
      .order('created_at', { ascending: false });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data } = await query;
    
    if (data) {
      const formatted = data.map((order: any) => ({
        id: order.id,
        order_number: order.order_number,
        customer_name: 'Customer',
        total: order.total,
        status: order.status,
        delivery_address: order.delivery_address,
        created_at: order.created_at,
        driver_name: order.drivers?.first_name 
          ? `${order.drivers.first_name} ${order.drivers.last_name}`
          : 'Unassigned',
      }));
      setOrders(formatted);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId);
    
    if (!error) {
      await fetchOrders();
      setSelectedOrder(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return '#FF9500';
      case 'preparing': return '#007AFF';
      case 'on_the_way': return '#5856D6';
      case 'delivered': return '#34C759';
      default: return '#8E8E93';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return 'time-outline';
      case 'preparing': return 'restaurant-outline';
      case 'on_the_way': return 'bicycle-outline';
      case 'delivered': return 'checkmark-circle';
      default: return 'ellipse-outline';
    }
  };

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'preparing', label: 'Preparing' },
    { id: 'on_the_way', label: 'On The Way' },
    { id: 'delivered', label: 'Delivered' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
      </View>

      {/* Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterContainer}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterChip, filter === f.id && styles.filterChipActive]}
            onPress={() => setFilter(f.id)}
          >
            <Text style={[styles.filterText, filter === f.id && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8E8E93" />}
        contentContainerStyle={styles.content}
      >
        {orders.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={64} color="#C6C6C8" />
            <Text style={styles.emptyTitle}>No orders</Text>
            <Text style={styles.emptyText}>Orders will appear here</Text>
          </View>
        ) : (
          orders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => setSelectedOrder(order)}
              activeOpacity={0.7}
            >
              <View style={styles.orderHeader}>
                <Text style={styles.orderNumber}>{order.order_number}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(order.status) + '10' }]}>
                  <Ionicons name={getStatusIcon(order.status)} size={12} color={getStatusColor(order.status)} />
                  <Text style={[styles.statusText, { color: getStatusColor(order.status) }]}>
                    {order.status.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
              </View>

              <Text style={styles.orderTotal}>{order.total} MAD</Text>
              <Text style={styles.orderAddress} numberOfLines={1}>{order.delivery_address}</Text>
              <Text style={styles.orderDriver}>
                <Ionicons name="bicycle-outline" size={12} color="#8E8E93" /> {order.driver_name}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Order Details Modal */}
      <Modal
        visible={!!selectedOrder}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedOrder(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Order Details</Text>
              <TouchableOpacity onPress={() => setSelectedOrder(null)}>
                <Ionicons name="close" size={24} color="#1C1C1E" />
              </TouchableOpacity>
            </View>

            {selectedOrder && (
              <ScrollView>
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Order Number</Text>
                  <Text style={styles.detailValue}>{selectedOrder.order_number}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={styles.statusButtons}>
                    {['confirmed', 'preparing', 'on_the_way', 'delivered'].map((status) => (
                      <TouchableOpacity
                        key={status}
                        style={[
                          styles.statusButton,
                          selectedOrder.status === status && styles.statusButtonActive,
                        ]}
                        onPress={() => updateOrderStatus(selectedOrder.id, status)}
                      >
                        <Text style={[
                          styles.statusButtonText,
                          selectedOrder.status === status && styles.statusButtonTextActive,
                        ]}>
                          {status.replace('_', ' ').toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Total Amount</Text>
                  <Text style={styles.detailValue}>{selectedOrder.total} MAD</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Delivery Address</Text>
                  <Text style={styles.detailValue}>{selectedOrder.delivery_address}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Driver</Text>
                  <Text style={styles.detailValue}>{selectedOrder.driver_name}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Created</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedOrder.created_at).toLocaleString()}
                  </Text>
                </View>

                <Button
                  title="Close"
                  variant="primary"
                  onPress={() => setSelectedOrder(null)}
                  style={styles.closeButton}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.3,
  },
  filterContainer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  filterChipActive: {
    backgroundColor: '#007AFF',
  },
  filterText: {
    fontSize: 14,
    color: '#8E8E93',
  },
  filterTextActive: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  content: {
    padding: 16,
  },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  orderTotal: {
    fontSize: 20,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  orderAddress: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 8,
  },
  orderDriver: {
    fontSize: 12,
    color: '#8E8E93',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: '90%',
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  detailSection: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    color: '#1C1C1E',
  },
  statusButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  statusButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
  },
  statusButtonActive: {
    backgroundColor: '#007AFF',
  },
  statusButtonText: {
    fontSize: 13,
    color: '#8E8E93',
  },
  statusButtonTextActive: {
    color: '#FFFFFF',
  },
  closeButton: {
    marginTop: 16,
  },
});