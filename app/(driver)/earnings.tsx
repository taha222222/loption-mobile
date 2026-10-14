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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { supabase } from '../../src/lib/supabase';

const COMMISSION_RATE = 0.15; // 15% commission on delivery fees

interface WeeklyEarnings {
  weekStart: string;
  weekEnd: string;
  totalDeliveryFees: number;
  commission: number;
  deliveries: number;
  payoutStatus?: string;
}

export default function DriverEarnings() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [weeklyEarnings, setWeeklyEarnings] = useState<WeeklyEarnings[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [currentWeekEarnings, setCurrentWeekEarnings] = useState(0);
  const [pendingPayout, setPendingPayout] = useState(0);

  useEffect(() => {
    if (user) {
      fetchEarnings();
      fetchDriverStats();
    }
  }, [user]);

  const fetchDriverStats = async () => {
    if (!user) return;
    
    // Get driver's total stats
    const { data } = await supabase
      .from('drivers')
      .select('total_earned')
      .eq('id', user.id)
      .maybeSingle();
    
    if (data) {
      // Update local state if needed
    }
  };

  const fetchEarnings = async () => {
    if (!user) return;
    
    setLoading(true);
    
    // Get all delivered orders with commission
    const { data: orders } = await supabase
      .from('orders')
      .select('delivery_fee, delivered_at, driver_commission')
      .eq('driver_id', user.id)
      .eq('status', 'delivered')
      .order('delivered_at', { ascending: false });
    
    if (orders && orders.length > 0) {
      // Group by week using driver_commission (already calculated by trigger)
      const weeks: { [key: string]: { totalFees: number; commission: number; count: number } } = {};
      
      orders.forEach(order => {
        const date = new Date(order.delivered_at);
        const weekStart = getWeekStart(date);
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weeks[weekKey]) {
          weeks[weekKey] = { totalFees: 0, commission: 0, count: 0 };
        }
        weeks[weekKey].totalFees += order.delivery_fee;
        weeks[weekKey].commission += order.driver_commission || (order.delivery_fee * COMMISSION_RATE);
        weeks[weekKey].count += 1;
      });
      
      // Get payout status from driver_weekly_earnings table
      const { data: payouts } = await supabase
        .from('driver_weekly_earnings')
        .select('week_start, payout_status')
        .eq('driver_id', user.id);
      
      const payoutMap: { [key: string]: string } = {};
      if (payouts) {
        payouts.forEach(p => {
          payoutMap[p.week_start] = p.payout_status;
        });
      }
      
      // Calculate commission and format
      const weekData: WeeklyEarnings[] = Object.entries(weeks).map(([weekStart, data]) => {
        const startDate = new Date(weekStart);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        
        return {
          weekStart,
          weekEnd: endDate.toISOString().split('T')[0],
          totalDeliveryFees: data.totalFees,
          commission: Math.round(data.commission),
          deliveries: data.count,
          payoutStatus: payoutMap[weekStart] || 'pending',
        };
      });
      
      setWeeklyEarnings(weekData);
      
      // Calculate total earned
      const total = weekData.reduce((sum, week) => sum + week.commission, 0);
      setTotalEarned(total);
      
      // Calculate pending payout (unpaid weeks)
      const pending = weekData
        .filter(w => w.payoutStatus === 'pending')
        .reduce((sum, w) => sum + w.commission, 0);
      setPendingPayout(pending);
      
      // Current week earnings
      const currentWeek = getWeekStart(new Date());
      const currentWeekKey = currentWeek.toISOString().split('T')[0];
      const currentWeekData = weekData.find(w => w.weekStart === currentWeekKey);
      setCurrentWeekEarnings(currentWeekData?.commission || 0);
    }
    
    setLoading(false);
  };

  const getWeekStart = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const formatWeekRange = (weekStart: string, weekEnd: string) => {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  };

  const getPayoutStatusColor = (status?: string) => {
    switch (status) {
      case 'completed': return '#10b981';
      case 'processing': return '#3b82f6';
      default: return '#f59e0b';
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchEarnings();
    await fetchDriverStats();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Earnings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Current Week Card */}
        <LinearGradient
          colors={theme.gradients.gold}
          style={styles.currentCard}
        >
          <Text style={styles.currentLabel}>This week's earnings</Text>
          <Text style={styles.currentValue}>{currentWeekEarnings} MAD</Text>
          <View style={styles.commissionBadge}>
            <Text style={styles.commissionBadgeText}>15% commission</Text>
          </View>
          <Text style={styles.currentNote}>
            Based on {Math.round(currentWeekEarnings / 2.25)} deliveries this week
          </Text>
        </LinearGradient>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalEarned} MAD</Text>
            <Text style={styles.statLabel}>Total earned</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{pendingPayout} MAD</Text>
            <Text style={styles.statLabel}>Pending payout</Text>
          </View>
        </View>

        {/* Info Card - How earnings work */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={24} color={theme.colors.accent} />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>How earnings work</Text>
            <Text style={styles.infoText}>
              • You earn 15% commission on delivery fees
              • Delivery fee is 15 MAD per order
              • You earn 2.25 MAD per delivery
              • Earnings are calculated weekly
              • Paid every Monday via bank transfer
            </Text>
          </View>
        </View>

        {/* Weekly Breakdown */}
        <View style={styles.weeklySection}>
          <Text style={styles.sectionTitle}>Weekly breakdown</Text>
          {weeklyEarnings.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={48} color={theme.colors.textLight} />
              <Text style={styles.emptyText}>No earnings yet</Text>
              <Text style={styles.emptySubtext}>Complete deliveries to see earnings</Text>
            </View>
          ) : (
            weeklyEarnings.map((week, index) => (
              <View key={index} style={styles.weekCard}>
                <View style={styles.weekHeader}>
                  <Text style={styles.weekRange}>
                    {formatWeekRange(week.weekStart, week.weekEnd)}
                  </Text>
                  <View style={[styles.payoutBadge, { backgroundColor: getPayoutStatusColor(week.payoutStatus) + '20' }]}>
                    <Text style={[styles.payoutText, { color: getPayoutStatusColor(week.payoutStatus) }]}>
                      {week.payoutStatus?.toUpperCase() || 'PENDING'}
                    </Text>
                  </View>
                </View>
                <View style={styles.weekStats}>
                  <View style={styles.weekStat}>
                    <Text style={styles.weekStatValue}>{week.deliveries}</Text>
                    <Text style={styles.weekStatLabel}>Deliveries</Text>
                  </View>
                  <View style={styles.weekStatDivider} />
                  <View style={styles.weekStat}>
                    <Text style={styles.weekStatValue}>{week.totalDeliveryFees} MAD</Text>
                    <Text style={styles.weekStatLabel}>Total fees</Text>
                  </View>
                  <View style={styles.weekStatDivider} />
                  <View style={styles.weekStat}>
                    <Text style={styles.weekStatValue}>{week.commission} MAD</Text>
                    <Text style={styles.weekStatLabel}>Your earnings</Text>
                  </View>
                </View>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: week.payoutStatus === 'completed' ? '100%' : '0%' }]} />
                </View>
                {week.payoutStatus === 'completed' && (
                  <Text style={styles.paidLabel}>✓ Paid</Text>
                )}
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
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  currentCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.xl,
    borderRadius: theme.spacing.lg,
    alignItems: 'center',
  },
  currentLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.dark,
    opacity: 0.7,
  },
  currentValue: {
    fontSize: theme.typography.sizes['4xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
    marginVertical: theme.spacing.sm,
  },
  commissionBadge: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.spacing.md,
  },
  commissionBadgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.dark,
  },
  currentNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.dark,
    opacity: 0.6,
    marginTop: theme.spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: theme.colors.border,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: 4,
  },
  infoText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    lineHeight: 20,
  },
  weeklySection: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.md,
  },
  weekCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  weekRange: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  payoutBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.spacing.sm,
  },
  payoutText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
  },
  weekStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  weekStat: {
    flex: 1,
    alignItems: 'center',
  },
  weekStatValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  weekStatLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  weekStatDivider: {
    width: 1,
    backgroundColor: theme.colors.border,
  },
  progressBar: {
    height: 4,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.success,
    borderRadius: 2,
  },
  paidLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.success,
    textAlign: 'right',
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    padding: theme.spacing['3xl'],
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.lg,
  },
  emptyText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textDark,
    marginTop: theme.spacing.md,
  },
  emptySubtext: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
});