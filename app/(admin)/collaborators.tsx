import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { supabase } from '../../src/lib/supabase';

interface Collaborator {
  id: string;
  user_id: string;
  branch_name: string;
  branch_address: string;
  branch_phone: string;
  branch_email: string;
  status: string;
  is_active: boolean;
  revenue_share_percent: number;
  created_at: string;
  user_email?: string;
}

export default function AdminCollaborators() {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCollaborator, setSelectedCollaborator] = useState<Collaborator | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    branch_name: '',
    branch_address: '',
    branch_phone: '',
    revenue_share: '50',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCollaborators();
  }, []);

  const fetchCollaborators = async () => {
    const { data } = await supabase
      .from('collaborators')
      .select(`
        *,
        users:user_id (email)
      `)
      .order('created_at', { ascending: false });
    
    if (data) {
      const formatted = data.map((c: any) => ({
        ...c,
        user_email: c.users?.email,
      }));
      setCollaborators(formatted);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchCollaborators();
    setRefreshing(false);
  };

  const handleAddCollaborator = async () => {
    if (!formData.email || !formData.branch_name) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }

    setLoading(true);

    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', formData.email)
      .single();

    if (userError || !user) {
      Alert.alert('Error', 'User not found. Please ask them to sign up first.');
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from('collaborators')
      .insert({
        user_id: user.user_id,
        branch_name: formData.branch_name,
        branch_address: formData.branch_address,
        branch_phone: formData.branch_phone,
        branch_email: formData.email,
        status: 'active',
        is_active: true,
        revenue_share_percent: parseInt(formData.revenue_share),
      });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Partner added successfully');
      setShowAddModal(false);
      setFormData({
        email: '',
        branch_name: '',
        branch_address: '',
        branch_phone: '',
        revenue_share: '50',
      });
      await fetchCollaborators();
    }
    setLoading(false);
  };

  const handleToggleStatus = async (collaborator: Collaborator) => {
    const newStatus = collaborator.status === 'active' ? 'suspended' : 'active';
    
    const { error } = await supabase
      .from('collaborators')
      .update({ status: newStatus, is_active: newStatus === 'active' })
      .eq('id', collaborator.id);
    
    if (!error) {
      await fetchCollaborators();
      Alert.alert('Success', `Partner ${newStatus === 'active' ? 'activated' : 'suspended'}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#34C759';
      case 'suspended': return '#FF9500';
      case 'pending': return '#007AFF';
      default: return '#FF3B30';
    }
  };

  const getInitials = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Partners</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8E8E93" />}
        contentContainerStyle={styles.content}
      >
        {collaborators.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={64} color="#C6C6C8" />
            <Text style={styles.emptyTitle}>No Partners</Text>
            <Text style={styles.emptyText}>Add your first partner branch</Text>
          </View>
        ) : (
          collaborators.map((collaborator) => (
            <TouchableOpacity
              key={collaborator.id}
              style={styles.partnerCard}
              onPress={() => setSelectedCollaborator(collaborator)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <View style={styles.avatarContainer}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{getInitials(collaborator.branch_name)}</Text>
                  </View>
                  <View>
                    <Text style={styles.branchName}>{collaborator.branch_name}</Text>
                    <Text style={styles.branchEmail}>{collaborator.branch_email}</Text>
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(collaborator.status) + '10' }]}>
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(collaborator.status) }]} />
                  <Text style={[styles.statusText, { color: getStatusColor(collaborator.status) }]}>
                    {collaborator.status === 'active' ? 'Active' : 'Suspended'}
                  </Text>
                </View>
              </View>

              <View style={styles.cardStats}>
                <View style={styles.statItem}>
                  <Ionicons name="location-outline" size={14} color="#8E8E93" />
                  <Text style={styles.statText}>{collaborator.branch_address?.split(',')[0] || 'No address'}</Text>
                </View>
                <View style={styles.statItem}>
                  <Ionicons name="cash-outline" size={14} color="#8E8E93" />
                  <Text style={styles.statText}>{collaborator.revenue_share_percent}% share</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Add Partner Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Partner</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#1C1C1E" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <TextInput
                style={styles.modalInput}
                placeholder="User Email"
                placeholderTextColor="#8E8E93"
                value={formData.email}
                onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                autoCapitalize="none"
              />
              
              <TextInput
                style={styles.modalInput}
                placeholder="Branch Name"
                placeholderTextColor="#8E8E93"
                value={formData.branch_name}
                onChangeText={(text) => setFormData(prev => ({ ...prev, branch_name: text }))}
              />
              
              <TextInput
                style={styles.modalInput}
                placeholder="Branch Address"
                placeholderTextColor="#8E8E93"
                value={formData.branch_address}
                onChangeText={(text) => setFormData(prev => ({ ...prev, branch_address: text }))}
              />
              
              <TextInput
                style={styles.modalInput}
                placeholder="Branch Phone"
                placeholderTextColor="#8E8E93"
                value={formData.branch_phone}
                onChangeText={(text) => setFormData(prev => ({ ...prev, branch_phone: text }))}
                keyboardType="phone-pad"
              />
              
              <TextInput
                style={styles.modalInput}
                placeholder="Revenue Share %"
                placeholderTextColor="#8E8E93"
                value={formData.revenue_share}
                onChangeText={(text) => setFormData(prev => ({ ...prev, revenue_share: text }))}
                keyboardType="numeric"
              />
              
              <View style={styles.modalButtons}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setShowAddModal(false)}
                />
                <Button
                  title="Add Partner"
                  variant="gold"
                  onPress={handleAddCollaborator}
                  loading={loading}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Partner Details Modal */}
      <Modal
        visible={!!selectedCollaborator}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedCollaborator(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Partner Details</Text>
              <TouchableOpacity onPress={() => setSelectedCollaborator(null)}>
                <Ionicons name="close" size={24} color="#1C1C1E" />
              </TouchableOpacity>
            </View>

            {selectedCollaborator && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.detailAvatar}>
                  <View style={styles.detailAvatarCircle}>
                    <Text style={styles.detailAvatarText}>{getInitials(selectedCollaborator.branch_name)}</Text>
                  </View>
                  <Text style={styles.detailName}>{selectedCollaborator.branch_name}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Contact Information</Text>
                  <View style={styles.detailRow}>
                    <Ionicons name="mail-outline" size={18} color="#8E8E93" />
                    <Text style={styles.detailValue}>{selectedCollaborator.branch_email}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Ionicons name="call-outline" size={18} color="#8E8E93" />
                    <Text style={styles.detailValue}>{selectedCollaborator.branch_phone || 'Not set'}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Ionicons name="location-outline" size={18} color="#8E8E93" />
                    <Text style={styles.detailValue}>{selectedCollaborator.branch_address || 'Not set'}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Financial</Text>
                  <View style={styles.detailRow}>
                    <Ionicons name="cash-outline" size={18} color="#8E8E93" />
                    <Text style={styles.detailValue}>{selectedCollaborator.revenue_share_percent}% revenue share</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={styles.statusContainer}>
                    <View style={[styles.statusBadgeLarge, { backgroundColor: getStatusColor(selectedCollaborator.status) + '10' }]}>
                      <View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedCollaborator.status) }]} />
                      <Text style={[styles.statusTextLarge, { color: getStatusColor(selectedCollaborator.status) }]}>
                        {selectedCollaborator.status === 'active' ? 'Active' : 'Suspended'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.modalButtons}>
                  <Button
                    title="Close"
                    variant="primary"
                    onPress={() => setSelectedCollaborator(null)}
                    style={styles.closeButton}
                  />
                  <Button
                    title={selectedCollaborator.status === 'active' ? 'Suspend' : 'Activate'}
                    variant={selectedCollaborator.status === 'active' ? 'danger' : 'success'}
                    onPress={() => {
                      handleToggleStatus(selectedCollaborator);
                      setSelectedCollaborator(null);
                    }}
                  />
                </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  content: {
    padding: 16,
  },
  partnerCard: {
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#007AFF10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  branchName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  branchEmail: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  cardStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 13,
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
  modalInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  closeButton: {
    flex: 1,
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
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    marginBottom: 12,
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
});