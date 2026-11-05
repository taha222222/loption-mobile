import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { Button } from '../../src/components/ui/Button';
import { ASSIGNABLE_STATUSES, isWorkflowOrder, nextPayments, nextStatuses } from '../../src/orders/orderWorkflow';
import { assignDriver, cancelOrder, confirmOrder, setPayment, type WorkflowResult } from '../../src/services/orderWorkflowApi';

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  total: number;
  status: string;
  delivery_address: string;
  created_at: string;
  driver_name?: string;
  driver_id: string | null;
  workflow_version: number | null;
  payment_status: string | null;
}

interface DriverOption {
  id: string;
  name: string;
  status: string;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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
        driver_id: order.driver_id ?? null,
        workflow_version: order.workflow_version ?? null,
        payment_status: order.payment_status ?? null,
      }));
      setOrders(formatted);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  // Every change goes through the order workflow functions: the server
  // checks the admin's role, the order's state and the allowed transition
  // (an admin acts as cashier: confirm, assign a driver, cancel, record the
  // payment). Kitchen and delivery steps belong to kitchen staff and drivers.
  const fetchDrivers = async () => {
    const { data } = await supabase.from('drivers').select('id, first_name, last_name, status').order('status');
    setDrivers((data ?? []).map((d: { id: string; first_name: string | null; last_name: string | null; status: string }) => ({
      id: d.id,
      name: [d.first_name, d.last_name].filter(Boolean).join(' ') || d.id.slice(0, 8),
      status: d.status,
    })));
  };

  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    setReason('');
    setActionMessage(null);
    if (isWorkflowOrder(order) && ASSIGNABLE_STATUSES.some((st) => st === order.status)) void fetchDrivers();
  };

  const run = async (label: string, call: () => Promise<WorkflowResult>) => {
    setBusy(true);
    const result = await call();
    setBusy(false);
    if (result.ok) {
      setActionMessage(result.changed ? `${label}: done.` : `${label}: already done, nothing changed.`);
      await fetchOrders();
      setSelectedOrder(null);
    } else {
      setActionMessage(
        result.error.kind === 'invalid' ? `${label}: not possible in the current state (${result.error.message}).`
        : result.error.kind === 'not_allowed' ? `${label}: not allowed for this account.`
        : result.error.kind === 'not_available' ? `${label}: the server does not have the order workflow yet.`
        : result.error.kind === 'network' ? `${label}: no connection, nothing changed.`
        : `${label}: refused (${result.error.message}).`
      );
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
    { id: 'pending', label: 'Pending' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'preparing', label: 'Preparing' },
    { id: 'ready', label: 'Ready' },
    { id: 'on_the_way', label: 'On The Way' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'cancelled', label: 'Cancelled' },
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
              onPress={() => openOrder(order)}
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
                  <Text style={styles.detailValue}>
                    {selectedOrder.status.replace('_', ' ')}
                    {isWorkflowOrder(selectedOrder) ? ` · payment ${selectedOrder.payment_status ?? '-'}` : ''}
                  </Text>
                  {!isWorkflowOrder(selectedOrder) ? (
                    <Text style={styles.detailLabel}>Historical order (before the delivery workflow): read-only.</Text>
                  ) : (
                    <View style={styles.statusButtons}>
                      {nextStatuses(selectedOrder.status, 'cashier').includes('confirmed') && (
                        <TouchableOpacity style={styles.statusButton} disabled={busy}
                          onPress={() => run('Confirm', () => confirmOrder(selectedOrder.id))}>
                          <Text style={styles.statusButtonText}>CONFIRM ORDER</Text>
                        </TouchableOpacity>
                      )}
                      {nextPayments(selectedOrder.payment_status, selectedOrder.status).map((p) => (
                        <TouchableOpacity key={p} style={styles.statusButton} disabled={busy}
                          onPress={() => run(`Payment ${p}`, () => setPayment(selectedOrder.id, p as 'paid' | 'failed' | 'refunded'))}>
                          <Text style={styles.statusButtonText}>{p === 'paid' ? 'RECORD CASH PAID' : p === 'failed' ? 'RECORD NOT PAID' : 'REFUND'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {isWorkflowOrder(selectedOrder) && ASSIGNABLE_STATUSES.some((st) => st === selectedOrder.status) && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Assign a driver (before pickup)</Text>
                    {drivers.length === 0 ? <Text style={styles.detailValue}>No driver found.</Text> : null}
                    {drivers.map((d) => (
                      <TouchableOpacity key={d.id} disabled={busy}
                        style={[styles.statusButton, selectedOrder.driver_id === d.id && styles.statusButtonActive]}
                        onPress={() => run('Assign driver', () => assignDriver(selectedOrder.id, d.id))}>
                        <Text style={[styles.statusButtonText, selectedOrder.driver_id === d.id && styles.statusButtonTextActive]}>
                          {d.name} ({d.status})
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {isWorkflowOrder(selectedOrder) && nextStatuses(selectedOrder.status, 'cashier').includes('cancelled') && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Cancel (reason required, shown to the customer)</Text>
                    <TextInput value={reason} onChangeText={setReason} placeholder="Reason" maxLength={300}
                      style={styles.reasonInput} accessibilityLabel="Cancellation reason" />
                    <TouchableOpacity style={styles.statusButton} disabled={busy || reason.trim().length < 3}
                      onPress={() => run('Cancel', () => cancelOrder(selectedOrder.id, reason.trim()))}>
                      <Text style={styles.statusButtonText}>CANCEL ORDER</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {actionMessage ? <Text style={styles.detailValue}>{actionMessage}</Text> : null}

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
  reasonInput: {
    borderWidth: 1,
    borderColor: '#D1D1D6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 15,
  },
  closeButton: {
    marginTop: 16,
  },
});