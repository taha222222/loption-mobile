import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { Button } from '../../src/components/ui/Button';

interface Driver {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: string;
  total_earned: number;
  created_at: string;
}

export default function AdminDrivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [pendingDrivers, setPendingDrivers] = useState<Driver[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'pending'>('active');

  useEffect(() => {
    fetchDrivers();
    fetchPendingDrivers();
  }, []);

  const fetchDrivers = async () => {
    const { data } = await supabase
      .from('drivers')
      .select('*')
      .in('status', ['online', 'offline'])
      .order('created_at', { ascending: false });
    
    if (data) {
      setDrivers(data);
    }
  };

  const fetchPendingDrivers = async () => {
    const { data } = await supabase
      .from('drivers')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    
    if (data) {
      setPendingDrivers(data);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDrivers();
    await fetchPendingDrivers();
    setRefreshing(false);
  };

  const approveDriver = async (driver: Driver) => {
    const { error } = await supabase
      .from('drivers')
      .update({ status: 'offline' })
      .eq('id', driver.id);
    
    if (!error) {
      await fetchDrivers();
      await fetchPendingDrivers();
      Alert.alert('Success', `${driver.first_name} ${driver.last_name} has been approved`);
    }
  };

  const rejectDriver = async (driver: Driver) => {
    Alert.alert(
      'Reject Driver',
      `Are you sure you want to reject ${driver.first_name} ${driver.last_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('drivers')
              .update({ status: 'rejected' })
              .eq('id', driver.id);
            
            if (!error) {
              await fetchPendingDrivers();
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#34C759';
      case 'offline': return '#8E8E93';
      case 'pending': return '#FF9500';
      default: return '#FF3B30';
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
  };

  const currentList = activeTab === 'active' ? drivers : pendingDrivers;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Drivers</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'active' && styles.tabActive]}
          onPress={() => setActiveTab('active')}
        >
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>
            Active ({drivers.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'pending' && styles.tabActive]}
          onPress={() => setActiveTab('pending')}
        >
          <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>
            Pending ({pendingDrivers.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8E8E93" />}
        contentContainerStyle={styles.content}
      >
        {currentList.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color="#C6C6C8" />
            <Text style={styles.emptyTitle}>
              {activeTab === 'active' ? 'No active drivers' : 'No pending applications'}
            </Text>
          </View>
        ) : (
          currentList.map((driver) => (
            <TouchableOpacity
              key={driver.id}
              style={styles.driverCard}
              onPress={() => setSelectedDriver(driver)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(driver.first_name, driver.last_name)}</Text>
                </View>
                <View style={styles.driverInfo}>
                  <Text style={styles.driverName}>{driver.first_name} {driver.last_name}</Text>
                  <Text style={styles.driverEmail}>{driver.email}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(driver.status) + '10' }]}>
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(driver.status) }]} />
                  <Text style={[styles.statusText, { color: getStatusColor(driver.status) }]}>
                    {driver.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              {activeTab === 'active' && (
                <View style={styles.cardFooter}>
                  <Text style={styles.earnings}>Total earned: {driver.total_earned || 0} MAD</Text>
                </View>
              )}

              {activeTab === 'pending' && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity style={styles.approveButton} onPress={() => approveDriver(driver)}>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.actionButtonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectButton} onPress={() => rejectDriver(driver)}>
                    <Ionicons name="close-circle" size={18} color="#FF3B30" />
                    <Text style={[styles.actionButtonText, { color: '#FF3B30' }]}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Driver Details Modal */}
      <Modal
        visible={!!selectedDriver}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDriver(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Driver Details</Text>
              <TouchableOpacity onPress={() => setSelectedDriver(null)}>
                <Ionicons name="close" size={24} color="#1C1C1E" />
              </TouchableOpacity>
            </View>

            {selectedDriver && (
              <ScrollView>
                <View style={styles.detailAvatar}>
                  <View style={styles.detailAvatarCircle}>
                    <Text style={styles.detailAvatarText}>
                      {getInitials(selectedDriver.first_name, selectedDriver.last_name)}
                    </Text>
                  </View>
                  <Text style={styles.detailName}>{selectedDriver.first_name} {selectedDriver.last_name}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Contact Information</Text>
                  <View style={styles.detailRow}>
                    <Ionicons name="mail-outline" size={18} color="#8E8E93" />
                    <Text style={styles.detailValue}>{selectedDriver.email}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Ionicons name="call-outline" size={18} color="#8E8E93" />
                    <Text style={styles.detailValue}>{selectedDriver.phone || 'Not set'}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={styles.statusContainer}>
                    <View style={[styles.statusBadgeLarge, { backgroundColor: getStatusColor(selectedDriver.status) + '10' }]}>
                      <View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedDriver.status) }]} />
                      <Text style={[styles.statusTextLarge, { color: getStatusColor(selectedDriver.status) }]}>
                        {selectedDriver.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>

                {selectedDriver.status !== 'pending' && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Earnings</Text>
                    <Text style={styles.detailValue}>{selectedDriver.total_earned || 0} MAD</Text>
                  </View>
                )}

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Joined</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedDriver.created_at).toLocaleDateString()}
                  </Text>
                </View>

                <Button
                  title="Close"
                  variant="primary"
                  onPress={() => setSelectedDriver(null)}
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
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#E5E5EA',
  },
  tabActive: {
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 15,
    color: '#8E8E93',
  },
  tabTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  content: {
    padding: 16,
  },
  driverCard: {
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#007AFF10',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  driverEmail: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  cardFooter: {
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
  },
  earnings: {
    fontSize: 13,
    color: '#34C759',
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34C759',
    paddingVertical: 8,
    borderRadius: 24,
    gap: 6,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B3010',
    paddingVertical: 8,
    borderRadius: 24,
    gap: 6,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
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
  detailAvatar: {
    alignItems: 'center',
    marginBottom: 24,
  },
  detailAvatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF10',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  detailAvatarText: {
    fontSize: 32,
    fontWeight: '600',
    color: '#007AFF',
  },
  detailName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  detailValue: {
    fontSize: 16,
    color: '#1C1C1E',
    flex: 1,
  },
  statusContainer: {
    flexDirection: 'row',
  },
  statusBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    gap: 8,
  },
  statusTextLarge: {
    fontSize: 14,
    fontWeight: '500',
  },
  closeButton: {
    marginTop: 16,
  },
});