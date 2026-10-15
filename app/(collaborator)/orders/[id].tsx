import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../../src/theme';
import { Button } from '../../../src/components/ui/Button';
import { useCollaboratorStore } from '../../../src/stores/collaboratorStore';
import { supabase } from '../../../src/lib/supabase';

interface OrderDetail {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  order_total: number;
  collaborator_share: number;
  preparation_status: string;
  preparation_notes: string;
  created_at: string;
  items: any[];
}

export default function CollaboratorOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { updateOrderStatus, acceptOrder, rejectOrder, markOrderReady } = useCollaboratorStore();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  useEffect(() => {
    fetchOrderDetail();
    // Return the unsubscribe so the channel is removed on unmount / id change.
    return subscribeToOrderUpdates();
  }, [id]);

  const fetchOrderDetail = async () => {
    const { data } = await supabase
      .from('collaborator_orders')
      .select(`
        *,
        orders:order_id (
          order_number,
          delivery_address,
          total,
          status,
          order_items (*)
        )
      `)
      .eq('order_id', id)
      .single();
    
    if (data) {
      setOrder({
        id: data.id,
        order_id: data.order_id,
        order_number: data.orders?.order_number,
        customer_name: 'Customer',
        customer_address: data.orders?.delivery_address,
        customer_phone: '',
        order_total: data.order_total,
        collaborator_share: data.collaborator_share,
        preparation_status: data.preparation_status,
        preparation_notes: data.preparation_notes,
        created_at: data.created_at,
        items: data.orders?.order_items || [],
      });
    }
    setLoading(false);
  };

  const subscribeToOrderUpdates = () => {
    const subscription = supabase
      .channel(`collaborator_order_${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'collaborator_orders',
          filter: `order_id=eq.${id}`,
        },
        (payload) => {
          if (payload.new) {
            setOrder(prev => ({ ...prev!, preparation_status: payload.new.preparation_status }));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const handleAccept = async () => {
    setUpdating(true);
    await acceptOrder(order!.id);
    setUpdating(false);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      Alert.alert('Error', 'Please provide a reason for rejection');
      return;
    }
    setUpdating(true);
    await rejectOrder(order!.id, rejectReason);
    setShowRejectModal(false);
    setRejectReason('');
    setUpdating(false);
  };

  const handleStartPreparing = async () => {
    setUpdating(true);
    await updateOrderStatus(order!.id, 'preparing');
    setUpdating(false);
  };

  const handleMarkReady = async () => {
    setUpdating(true);
    await markOrderReady(order!.id);
    setUpdating(false);
  };

  const getActionButtons = () => {
    switch (order?.preparation_status) {
      case 'pending':
        return (
          <View style={styles.actionButtons}>
            <Button
              title="Accept Order"
              variant="success"
              onPress={handleAccept}
              loading={updating}
              style={styles.acceptButton}
            />
            <Button
              title="Reject"
              variant="danger"
              onPress={() => setShowRejectModal(true)}
              loading={updating}
              style={styles.rejectButton}
            />
          </View>
        );
      case 'accepted':
        return (
          <Button
            title="Start Preparing"
            variant="primary"
            onPress={handleStartPreparing}
            loading={updating}
            style={styles.fullButton}
          />
        );
      case 'preparing':
        return (
          <Button
            title="Mark as Ready"
            variant="success"
            onPress={handleMarkReady}
            loading={updating}
            style={styles.fullButton}
          />
        );
      case 'ready':
        return (
          <View style={styles.readyBadge}>
            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
            <Text style={styles.readyText}>Order Ready for Pickup</Text>
            <Text style={styles.readySubtext}>Driver will pick up shortly</Text>
          </View>
        );
      case 'rejected':
        return (
          <View style={styles.rejectedBadge}>
            <Ionicons name="close-circle" size={24} color="#ef4444" />
            <Text style={styles.rejectedText}>Order Rejected</Text>
            <Text style={styles.rejectedSubtext}>Reason: {order?.preparation_notes}</Text>
          </View>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D4A757" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#ef4444" />
        <Text style={styles.errorText}>Order not found</Text>
        <Button title="Go Back" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order #{order.order_number}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statusCard}>
          <Text style={styles.statusLabel}>Preparation Status</Text>
          <View style={[styles.statusBadgeLarge, { backgroundColor: getStatusColor(order.preparation_status) + '20' }]}>
            <Text style={[styles.statusTextLarge, { color: getStatusColor(order.preparation_status) }]}>
              {order.preparation_status.toUpperCase()}
            </Text>
          </View>
        </LinearGradient>

        {/* Order Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          {order.items.map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.quantity}x {item.meal_name}</Text>
                <Text style={styles.itemMeta}>
                  {item.calories} cal • {item.protein}g protein
                </Text>
              </View>
              <Text style={styles.itemPrice}>{item.price} MAD</Text>
            </View>
          ))}
        </View>

        {/* Delivery Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Details</Text>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={20} color="#9CA3AF" />
            <Text style={styles.infoText}>{order.customer_address}</Text>
          </View>
        </View>

        {/* Financial Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financial Summary</Text>
          <View style={styles.financialRow}>
            <Text style={styles.financialLabel}>Order Total</Text>
            <Text style={styles.financialValue}>{order.order_total} MAD</Text>
          </View>
          <View style={styles.financialRow}>
            <Text style={styles.financialLabel}>Your Share (50%)</Text>
            <Text style={styles.financialValueGold}>{order.collaborator_share} MAD</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionContainer}>
          {getActionButtons()}
        </View>
      </ScrollView>

      {/* Reject Modal */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject Order</Text>
            <Text style={styles.modalSubtitle}>Please provide a reason for rejection</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason..."
              placeholderTextColor="#6B7280"
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setShowRejectModal(false)}
              />
              <Button
                title="Reject Order"
                variant="danger"
                onPress={handleReject}
              />
            </View>
          </LinearGradient>
        </View>
      </Modal>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F1115',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F1115',
  },
  errorText: {
    fontSize: theme.typography.sizes.lg,
    color: '#FFFFFF',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  statusCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
    marginBottom: theme.spacing.sm,
  },
  statusBadgeLarge: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.spacing.lg,
  },
  statusTextLarge: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
  },
  section: {
    backgroundColor: '#1E293B',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
    marginBottom: theme.spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    color: '#FFFFFF',
  },
  itemMeta: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 2,
  },
  itemPrice: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#D4A757',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  financialLabel: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
  },
  financialValue: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  financialValueGold: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  actionContainer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  acceptButton: {
    flex: 1,
  },
  rejectButton: {
    flex: 1,
  },
  fullButton: {
    width: '100%',
  },
  readyBadge: {
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: '#10b98120',
    borderRadius: theme.spacing.lg,
  },
  readyText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#10b981',
    marginTop: theme.spacing.sm,
  },
  readySubtext: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 4,
  },
  rejectedBadge: {
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: '#ef444420',
    borderRadius: theme.spacing.lg,
  },
  rejectedText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#ef4444',
    marginTop: theme.spacing.sm,
  },
  rejectedSubtext: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: '85%',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.xl,
  },
  modalTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
    marginBottom: theme.spacing.sm,
  },
  modalSubtitle: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
    marginBottom: theme.spacing.lg,
  },
  modalInput: {
    backgroundColor: '#0F1115',
    borderRadius: theme.spacing.md,
    padding: theme.spacing.md,
    fontSize: theme.typography.sizes.md,
    color: '#FFFFFF',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: theme.spacing.lg,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
});