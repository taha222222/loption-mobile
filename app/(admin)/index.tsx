import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { theme } from '../../src/theme';
import { supabase } from '../../src/lib/supabase';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';

const { width } = Dimensions.get('window');

interface DashboardStats {
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  totalDrivers: number;
  totalCollaborators: number;
  pendingOrders: number;
  deliveredOrders: number;
  todayOrders: number;
  todayRevenue: number;
}

export default function AdminOverview() {
  const { signOut } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats>({
    totalOrders: 0,
    totalRevenue: 0,
    totalCustomers: 0,
    totalDrivers: 0,
    totalCollaborators: 0,
    pendingOrders: 0,
    deliveredOrders: 0,
    todayOrders: 0,
    todayRevenue: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get total orders and revenue
    const { data: orders } = await supabase
      .from('orders')
      .select('total, status, created_at');
    
    if (orders) {
      const totalOrders = orders.length;
      const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
      const pendingOrders = orders.filter(o => o.status === 'confirmed' || o.status === 'pending').length;
      const deliveredOrders = orders.filter(o => o.status === 'delivered').length;
      const todayOrders = orders.filter(o => new Date(o.created_at) >= today).length;
      const todayRevenue = orders
        .filter(o => new Date(o.created_at) >= today)
        .reduce((sum, o) => sum + o.total, 0);
      
      setStats(prev => ({
        ...prev,
        totalOrders,
        totalRevenue,
        pendingOrders,
        deliveredOrders,
        todayOrders,
        todayRevenue,
      }));
    }
    
    // Get customers count
    const { count: customers } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });
    
    // Get drivers count
    const { count: drivers } = await supabase
      .from('drivers')
      .select('*', { count: 'exact', head: true })
      .in('status', ['online', 'offline']);
    
    // Get collaborators count
    const { count: collaborators } = await supabase
      .from('collaborators')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    
    setStats(prev => ({
      ...prev,
      totalCustomers: customers || 0,
      totalDrivers: drivers || 0,
      totalCollaborators: collaborators || 0,
    }));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: async () => {
            const { error } = await signOut();
            if (error) {
              Alert.alert('Sign out failed', 'Check your connection and try again.');
              return;
            }
            router.replace('/(auth)/login');
          }
        },
      ]
    );
  };

  const StatCard = ({ title, value, icon, color, onPress }: any) => (
    <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.statIcon, { backgroundColor: color + '10' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={styles.statInfo}>
        <Text style={styles.statValue}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8E8E93" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Overview</Text>
            <Text style={styles.subtitle}>Good morning, Admin</Text>
          </View>
          <TouchableOpacity onPress={handleSignOut} style={styles.signOutButton}>
            <Ionicons name="log-out-outline" size={22} color="#FF3B30" />
          </TouchableOpacity>
        </View>

        {/* Today's Highlights */}
        <View style={styles.highlightsSection}>
          <Text style={styles.sectionTitle}>Today</Text>
          <View style={styles.highlightsRow}>
            <BlurView intensity={80} tint="light" style={styles.highlightCard}>
              <Text style={styles.highlightValue}>{stats.todayOrders}</Text>
              <Text style={styles.highlightLabel}>Orders</Text>
              <View style={styles.highlightTrend}>
                <Ionicons name="trending-up" size={12} color="#34C759" />
                <Text style={styles.trendText}>+12%</Text>
              </View>
            </BlurView>
            <BlurView intensity={80} tint="light" style={styles.highlightCard}>
              <Text style={styles.highlightValue}>{stats.todayRevenue} MAD</Text>
              <Text style={styles.highlightLabel}>Revenue</Text>
              <View style={styles.highlightTrend}>
                <Ionicons name="trending-up" size={12} color="#34C759" />
                <Text style={styles.trendText}>+8%</Text>
              </View>
            </BlurView>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.statsGrid}>
            <StatCard
              title="Total Orders"
              value={stats.totalOrders}
              icon="cart-outline"
              color="#007AFF"
              onPress={() => router.push('/(admin)/orders')}
            />
            <StatCard
              title="Revenue"
              value={`${stats.totalRevenue.toLocaleString()} MAD`}
              icon="cash-outline"
              color="#FF9500"
              onPress={() => router.push('/(admin)/orders')}
            />
            <StatCard
              title="Customers"
              value={stats.totalCustomers}
              icon="person-outline"
              color="#34C759"
            />
            <StatCard
              title="Drivers"
              value={stats.totalDrivers}
              icon="bicycle-outline"
              color="#5856D6"
              onPress={() => router.push('/(admin)/drivers')}
            />
            <StatCard
              title="Partners"
              value={stats.totalCollaborators}
              icon="business-outline"
              color="#FF9500"
              onPress={() => router.push('/(admin)/collaborators')}
            />
            <StatCard
              title="Pending"
              value={stats.pendingOrders}
              icon="time-outline"
              color="#FF3B30"
              onPress={() => router.push('/(admin)/orders')}
            />
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsSection}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionsScroll}>
            <TouchableOpacity style={styles.actionChip} onPress={() => router.push('/(admin)/meals')}>
              <Ionicons name="add-circle-outline" size={20} color="#007AFF" />
              <Text style={styles.actionChipText}>Add Meal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionChip} onPress={() => router.push('/(admin)/orders')}>
              <Ionicons name="list-outline" size={20} color="#007AFF" />
              <Text style={styles.actionChipText}>View Orders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionChip} onPress={() => router.push('/(admin)/drivers')}>
              <Ionicons name="person-add-outline" size={20} color="#007AFF" />
              <Text style={styles.actionChipText}>Add Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionChip} onPress={() => router.push('/(admin)/collaborators')}>
              <Ionicons name="business-outline" size={20} color="#007AFF" />
              <Text style={styles.actionChipText}>Add Partner</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Recent Activity */}
        <View style={styles.activitySection}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <View style={styles.activityList}>
            <View style={styles.activityItem}>
              <View style={[styles.activityDot, { backgroundColor: '#34C759' }]} />
              <View style={styles.activityContent}>
                <Text style={styles.activityText}>System running normally</Text>
                <Text style={styles.activityTime}>Just now</Text>
              </View>
            </View>
            <View style={styles.activityItem}>
              <View style={[styles.activityDot, { backgroundColor: '#007AFF' }]} />
              <View style={styles.activityContent}>
                <Text style={styles.activityText}>{stats.totalCustomers} total customers</Text>
                <Text style={styles.activityTime}>Today</Text>
              </View>
            </View>
            <View style={styles.activityItem}>
              <View style={[styles.activityDot, { backgroundColor: '#5856D6' }]} />
              <View style={styles.activityContent}>
                <Text style={styles.activityText}>{stats.totalDrivers} active drivers</Text>
                <Text style={styles.activityTime}>Today</Text>
              </View>
            </View>
            <View style={styles.activityItem}>
              <View style={[styles.activityDot, { backgroundColor: '#FF9500' }]} />
              <View style={styles.activityContent}>
                <Text style={styles.activityText}>{stats.totalCollaborators} partner branches</Text>
                <Text style={styles.activityTime}>Today</Text>
              </View>
            </View>
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
  subtitle: {
    fontSize: 15,
    color: '#8E8E93',
    marginTop: 2,
  },
  signOutButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF3B3010',
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightsSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  highlightsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  highlightCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  highlightValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.5,
  },
  highlightLabel: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  highlightTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  trendText: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '500',
  },
  statsSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    width: (width - 52) / 2,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statInfo: {
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  statTitle: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  actionsSection: {
    marginBottom: 24,
  },
  actionsScroll: {
    paddingHorizontal: 20,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    marginRight: 10,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  actionChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#007AFF',
  },
  activitySection: {
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  activityList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontSize: 15,
    color: '#1C1C1E',
  },
  activityTime: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
});