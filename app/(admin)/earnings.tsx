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
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';

interface EarningsData {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  pendingPayouts: number;
  completedPayouts: number;
}

export default function AdminEarnings() {
  const [earnings, setEarnings] = useState<EarningsData>({
    totalRevenue: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    pendingPayouts: 0,
    completedPayouts: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchEarnings();
  }, []);

  const fetchEarnings = async () => {
    // Get all orders
    const { data: orders } = await supabase
      .from('orders')
      .select('total, status');
    
    if (orders) {
      const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
      const totalOrders = orders.length;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      
      setEarnings(prev => ({
        ...prev,
        totalRevenue,
        totalOrders,
        avgOrderValue,
      }));
    }

    // Get collaborator payouts
    const { data: payouts } = await supabase
      .from('collaborator_payouts')
      .select('status, collaborator_share');
    
    if (payouts) {
      const pendingPayouts = payouts
        .filter(p => p.status === 'pending')
        .reduce((sum, p) => sum + p.collaborator_share, 0);
      
      const completedPayouts = payouts
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.collaborator_share, 0);
      
      setEarnings(prev => ({
        ...prev,
        pendingPayouts,
        completedPayouts,
      }));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchEarnings();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Earnings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8E8E93" />}
        contentContainerStyle={styles.content}
      >
        {/* Main Stats */}
        <View style={styles.mainCard}>
          <Text style={styles.mainLabel}>Total Revenue</Text>
          <Text style={styles.mainValue}>{earnings.totalRevenue.toLocaleString()} MAD</Text>
          <Text style={styles.mainSubtext}>from {earnings.totalOrders} orders</Text>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{Math.round(earnings.avgOrderValue)} MAD</Text>
            <Text style={styles.statLabel}>Avg Order Value</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{earnings.totalOrders}</Text>
            <Text style={styles.statLabel}>Total Orders</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{earnings.pendingPayouts.toLocaleString()} MAD</Text>
            <Text style={styles.statLabel}>Pending Payouts</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{earnings.completedPayouts.toLocaleString()} MAD</Text>
            <Text style={styles.statLabel}>Completed Payouts</Text>
          </View>
        </View>

        {/* Info Section */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>How earnings work</Text>
            <Text style={styles.infoText}>
              • Customer payments go to L'OPTION platform
              {'\n'}• Partners receive {50}% revenue share per order
              {'\n'}• Drivers receive 15% commission per delivery
              {'\n'}• Payouts are processed weekly every Monday
            </Text>
          </View>
        </View>
      </ScrollView>
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
  content: {
    padding: 16,
  },
  mainCard: {
    backgroundColor: '#007AFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  mainLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 8,
  },
  mainValue: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  mainSubtext: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: '#8E8E93',
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 20,
  },
});