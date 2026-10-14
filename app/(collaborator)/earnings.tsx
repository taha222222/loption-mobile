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

const { width } = Dimensions.get('window');

export default function CollaboratorEarnings() {
  const { payouts, fetchPayouts, stats, fetchStats } = useCollaboratorStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'year'>('week');

  useEffect(() => {
    fetchPayouts();
    fetchStats();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPayouts();
    await fetchStats();
    setRefreshing(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const totalEarnings = payouts.reduce((sum, p) => sum + p.collaborator_share, 0);
  const pendingPayouts = payouts.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.collaborator_share, 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Earnings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Today's Earnings Card */}
        <LinearGradient colors={['#D4A757', '#B8860B']} style={styles.todayCard}>
          <Text style={styles.todayLabel}>Today's Earnings</Text>
          <Text style={styles.todayValue}>{stats?.collaboratorEarnings || 0} MAD</Text>
          <View style={styles.todayFooter}>
            <Text style={styles.todayOrders}>{stats?.totalOrdersToday || 0} orders</Text>
            <Ionicons name="arrow-forward" size={20} color="#0F1115" />
          </View>
        </LinearGradient>

        {/* Stats Cards */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalEarnings} MAD</Text>
            <Text style={styles.statLabel}>Total Earnings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{pendingPayouts} MAD</Text>
            <Text style={styles.statLabel}>Pending Payout</Text>
          </View>
        </View>

        {/* Period Selector */}
        <View style={styles.periodContainer}>
          <TouchableOpacity
            style={[styles.periodTab, selectedPeriod === 'week' && styles.periodActive]}
            onPress={() => setSelectedPeriod('week')}
          >
            <Text style={[styles.periodText, selectedPeriod === 'week' && styles.periodTextActive]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.periodTab, selectedPeriod === 'month' && styles.periodActive]}
            onPress={() => setSelectedPeriod('month')}
          >
            <Text style={[styles.periodText, selectedPeriod === 'month' && styles.periodTextActive]}>Month</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.periodTab, selectedPeriod === 'year' && styles.periodActive]}
            onPress={() => setSelectedPeriod('year')}
          >
            <Text style={[styles.periodText, selectedPeriod === 'year' && styles.periodTextActive]}>Year</Text>
          </TouchableOpacity>
        </View>

        {/* Chart Placeholder */}
        <View style={styles.chartContainer}>
          <View style={styles.chartBars}>
            {[65, 45, 80, 55, 70, 85, 60].map((height, index) => (
              <View key={index} style={styles.chartBarWrapper}>
                <View style={[styles.chartBar, { height: height * 1.5 }]} />
                <Text style={styles.chartLabel}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.chartHint}>Weekly earnings trend</Text>
        </View>

        {/* Payout History */}
        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>Payout History</Text>
          {payouts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="wallet-outline" size={48} color={theme.colors.textLight} />
              <Text style={styles.emptyText}>No payouts yet</Text>
            </View>
          ) : (
            payouts.map((payout) => (
              <View key={payout.id} style={styles.payoutCard}>
                <View>
                  <Text style={styles.payoutPeriod}>
                    {formatDate(payout.period_start)} - {formatDate(payout.period_end)}
                  </Text>
                  <Text style={styles.payoutOrders}>{payout.total_orders} orders</Text>
                </View>
                <View style={styles.payoutRight}>
                  <Text style={styles.payoutAmount}>{payout.collaborator_share} MAD</Text>
                  <View style={[styles.payoutStatus, { backgroundColor: payout.status === 'completed' ? '#10b98120' : '#f59e0b20' }]}>
                    <Text style={[styles.payoutStatusText, { color: payout.status === 'completed' ? '#10b981' : '#f59e0b' }]}>
                      {payout.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
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
  todayCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  todayLabel: {
    fontSize: theme.typography.sizes.sm,
    color: '#0F1115',
    opacity: 0.7,
  },
  todayValue: {
    fontSize: theme.typography.sizes['4xl'],
    fontWeight: theme.typography.weights.bold,
    color: '#0F1115',
    marginVertical: theme.spacing.sm,
  },
  todayFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  todayOrders: {
    fontSize: theme.typography.sizes.sm,
    color: '#0F1115',
    opacity: 0.7,
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 4,
  },
  periodContainer: {
    flexDirection: 'row',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    backgroundColor: '#1E293B',
    borderRadius: theme.spacing.lg,
    padding: 4,
  },
  periodTab: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    borderRadius: theme.spacing.md,
  },
  periodActive: {
    backgroundColor: '#D4A757',
  },
  periodText: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
  },
  periodTextActive: {
    color: '#0F1115',
    fontWeight: theme.typography.weights.semibold,
  },
  chartContainer: {
    backgroundColor: '#1E293B',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  chartBars: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 120,
    marginBottom: theme.spacing.md,
  },
  chartBarWrapper: {
    alignItems: 'center',
  },
  chartBar: {
    width: 30,
    backgroundColor: '#D4A757',
    borderRadius: 8,
    marginBottom: 8,
  },
  chartLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
  },
  chartHint: {
    fontSize: theme.typography.sizes.xs,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
  historySection: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
    marginBottom: theme.spacing.md,
  },
  payoutCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  payoutPeriod: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  payoutOrders: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 2,
  },
  payoutRight: {
    alignItems: 'flex-end',
  },
  payoutAmount: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  payoutStatus: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
    marginTop: 4,
  },
  payoutStatusText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
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