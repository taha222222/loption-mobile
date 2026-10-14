import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { AdminAuthModal } from '../../src/components/admin/AdminAuthModal';
import { useAuthStore } from '../../src/stores/authStore';
import { useUserStore } from '../../src/stores/userStore';
import { useSubscriptionStore } from '../../src/stores/subscriptionStore';

const { width } = Dimensions.get('window');

export default function ProfileScreen() {
  const { user, signOut, role } = useAuthStore();
  const { profile } = useUserStore();
  const { subscription, fetchSubscription } = useSubscriptionStore();
  const [showAdminModal, setShowAdminModal] = useState(false);

  // Mock data - will be replaced with real data from Supabase
  const streakDays = 7;
  const weightChange = -2.4;
  const completionPercent = 65;
  const nextDelivery = 'Today, 6:00 PM';
  const lastOrder = {
    name: 'Grilled Chicken Bowl',
    price: 69,
    calories: 450,
  };

  useEffect(() => {
    if (user) {
      fetchSubscription(user.id);
    }
  }, [user]);

  const getInitials = () => {
    if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return 'U';
  };

  const getProgramName = () => {
    if (subscription?.status === 'active') {
      switch (subscription.tier) {
        case 'meals_only': return 'Meals Only';
        case 'coaching': return 'Coaching Program';
        case 'transformation': return 'Transformation Program';
        case 'premium': return 'Premium Plus';
        case 'ultimate': return 'Ultimate Athlete';
        default: return 'Active Plan';
      }
    }
    
    switch (profile?.program) {
      case 'meals_only': return 'Meals Only';
      case 'coaching': return 'Coaching Program';
      case 'transformation': return 'Transformation Program';
      default: return 'No Active Plan';
    }
  };

  const hasActiveSubscription = subscription?.status === 'active';
  const isAdmin = role === 'admin';

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
            await signOut();
            router.replace('/(auth)/login');
          }
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header - Identity Section */}
      <View style={styles.header}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </View>
          <View>
            <Text style={styles.name}>{user?.email?.split('@')[0] || 'User'}</Text>
            <View style={[styles.programBadge, hasActiveSubscription && styles.activeProgramBadge]}>
              <Text style={[styles.programText, hasActiveSubscription && styles.activeProgramText]}>
                {getProgramName()}
              </Text>
            </View>
          </View>
        </View>
        
        {/* Progress Stats */}
        <View style={styles.progressStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, weightChange < 0 && styles.statSuccess]}>
              {weightChange > 0 ? `+${Math.abs(weightChange)}` : `-${Math.abs(weightChange)}`} kg
            </Text>
            <Text style={styles.statLabel}>weight change</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{completionPercent}%</Text>
            <Text style={styles.statLabel}>plan complete</Text>
          </View>
        </View>
      </View>

      {/* Primary Actions - Revenue Drivers */}
      <View style={styles.actionsContainer}>
        {/* My Plan - Daily engagement driver */}
        <TouchableOpacity 
          style={styles.actionCard}
          onPress={() => router.push('/(app)/my-plan')}
        >
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={styles.actionGradient}
          >
            <Ionicons name="calendar" size={28} color={theme.colors.accent} />
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>MY PLAN</Text>
              <Text style={styles.actionSubtitle}>Next delivery: {nextDelivery}</Text>
              <Text style={styles.actionDetail}>3 meals remaining today</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textLight} />
          </LinearGradient>
        </TouchableOpacity>

        {/* Reorder - Conversion driver */}
        <TouchableOpacity 
          style={styles.actionCard}
          onPress={() => router.push('/(app)/reorder')}
        >
          <View style={styles.actionRow}>
            <Ionicons name="repeat" size={24} color={theme.colors.accent} />
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>REORDER</Text>
              <Text style={styles.actionSubtitle}>Last: {lastOrder.name}</Text>
            </View>
            <TouchableOpacity style={styles.oneTapButton}>
              <Text style={styles.oneTapText}>1-TAP</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {/* Upgrade Plan - AOV driver (GOLD - premium trigger) */}
        <TouchableOpacity 
          style={styles.upgradeCard}
          onPress={() => router.push('/(app)/upgrade')}
        >
          <LinearGradient
            colors={theme.gradients.gold}
            style={styles.upgradeGradient}
          >
            <Ionicons name="flash" size={24} color={theme.colors.dark} />
            <View style={styles.upgradeContent}>
              <Text style={styles.upgradeTitle}>UPGRADE PLAN</Text>
              <Text style={styles.upgradeSubtitle}>Higher Protein • Premium Meals</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={theme.colors.dark} />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Retention Section - Streak & Progress */}
      <View style={styles.retentionContainer}>
        {/* Streak Card */}
        <View style={styles.streakCard}>
          <View style={styles.streakIcon}>
            <Ionicons name="flame" size={32} color={theme.colors.gold} />
          </View>
          <View style={styles.streakInfo}>
            <Text style={styles.streakValue}>{streakDays} DAY STREAK</Text>
            <Text style={styles.streakLabel}>Don't break your streak!</Text>
            <Text style={styles.streakWarning}>⚠️ {10 - streakDays} days to reach 10-day reward</Text>
          </View>
          <View style={styles.streakReward}>
            <Text style={styles.rewardText}>🏆 +50 pts</Text>
          </View>
        </View>

        {/* Progress Card */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Goal Progress</Text>
            <Text style={styles.progressPercent}>{completionPercent}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${completionPercent}%` }]} />
          </View>
          <Text style={styles.progressHint}>Complete your plan to unlock rewards</Text>
        </View>
      </View>

      {/* Exclusive Offers - High perceived value */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>✨ EXCLUSIVE OFFERS</Text>
          <Text style={styles.sectionBadge}>LIMITED</Text>
        </View>
        <TouchableOpacity style={styles.offerCard}>
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={styles.offerGradient}
          >
            <View>
              <Text style={styles.offerTitle}>Summer Shred Box</Text>
              <Text style={styles.offerDescription}>5 premium meals • 40g protein each</Text>
              <View style={styles.offerPriceRow}>
                <Text style={styles.offerPrice}>299 MAD</Text>
                <Text style={styles.offerOriginal}>399 MAD</Text>
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>SAVE 100 MAD</Text>
                </View>
              </View>
            </View>
            <View style={styles.offerBadge}>
              <Text style={styles.offerBadgeText}>BEST SELLER</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Add-ons - High-margin upsells */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>➕ ADD TO ORDER</Text>
          <TouchableOpacity>
            <Text style={styles.seeAllLink}>View All</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.addonsContainer}>
          <TouchableOpacity style={styles.addonCard}>
            <View style={styles.addonImage} />
            <Text style={styles.addonName}>Protein Smoothie</Text>
            <Text style={styles.addonMacro}>+25g protein</Text>
            <Text style={styles.addonPrice}>39 MAD</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addonCard}>
            <View style={styles.addonImage} />
            <Text style={styles.addonName}>Keto Snack Box</Text>
            <Text style={styles.addonMacro}>Low carb • 15g protein</Text>
            <Text style={styles.addonPrice}>49 MAD</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addonCard}>
            <View style={styles.addonImage} />
            <Text style={styles.addonName}>Protein Dessert</Text>
            <Text style={styles.addonMacro}>20g protein • 280 cal</Text>
            <Text style={styles.addonPrice}>29 MAD</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Admin Dashboard - Only visible to admin users */}
      {isAdmin && (
        <TouchableOpacity 
          style={styles.adminCard}
          onPress={() => setShowAdminModal(true)}
        >
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={styles.adminGradient}
          >
            <View style={styles.adminIcon}>
              <Ionicons name="shield-checkmark" size={28} color="#D4A757" />
            </View>
            <View style={styles.adminContent}>
              <Text style={styles.adminTitle}>Admin Dashboard</Text>
              <Text style={styles.adminSubtitle}>Manage orders, drivers, meals</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#D4A757" />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Settings Section */}
      <View style={styles.settingsContainer}>
        <Text style={styles.settingsLabel}>SETTINGS</Text>
        <TouchableOpacity style={styles.settingsItem}>
          <Ionicons name="help-circle-outline" size={20} color={theme.colors.textLight} />
          <Text style={styles.settingsText}>Help Center</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsItem} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={theme.colors.error} />
          <Text style={[styles.settingsText, styles.signOutText]}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Admin Auth Modal */}
      <AdminAuthModal
        visible={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onSuccess={() => router.push('./(admin)')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  name: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  programBadge: {
    backgroundColor: theme.colors.accent + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  activeProgramBadge: {
    backgroundColor: theme.colors.gold + '20',
  },
  programText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
    fontWeight: theme.typography.weights.medium,
  },
  activeProgramText: {
    color: theme.colors.gold,
  },
  progressStats: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    ...theme.shadows?.sm || {},
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  statSuccess: {
    color: theme.colors.success,
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: theme.colors.border,
  },
  actionsContainer: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  actionCard: {
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.md,
    ...theme.shadows?.sm || {},
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
    letterSpacing: 1,
  },
  actionSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  actionDetail: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
    marginTop: 2,
  },
  oneTapButton: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.spacing.md,
  },
  oneTapText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  upgradeCard: {
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  upgradeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  upgradeContent: {
    flex: 1,
  },
  upgradeTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
    letterSpacing: 1,
  },
  upgradeSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.dark,
    opacity: 0.8,
    marginTop: 2,
  },
  retentionContainer: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.md,
    ...theme.shadows?.sm || {},
  },
  streakIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.gold + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakInfo: {
    flex: 1,
  },
  streakValue: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  streakLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  streakWarning: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.gold,
    marginTop: 2,
  },
  streakReward: {
    backgroundColor: theme.colors.gold + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.spacing.sm,
  },
  rewardText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  progressCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows?.sm || {},
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  progressTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  progressPercent: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.accent,
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
    borderRadius: 4,
  },
  progressHint: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
    letterSpacing: 0.5,
  },
  sectionBadge: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
    backgroundColor: theme.colors.gold + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
  },
  seeAllLink: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
  },
  offerCard: {
    marginHorizontal: theme.spacing.xl,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  offerGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  offerTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  offerDescription: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textWhite,
    opacity: 0.8,
    marginTop: 2,
  },
  offerPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  offerPrice: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  offerOriginal: {
    fontSize: theme.typography.sizes.xs,
    textDecorationLine: 'line-through',
    color: theme.colors.textLight,
    fontWeight: theme.typography.weights.normal,
  },
  saveBadge: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
  },
  saveBadgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  offerBadge: {
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.spacing.sm,
  },
  offerBadgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
  addonsContainer: {
    paddingLeft: theme.spacing.xl,
  },
  addonCard: {
    width: 140,
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    marginRight: theme.spacing.md,
    padding: theme.spacing.md,
    ...theme.shadows?.sm || {},
  },
  addonImage: {
    width: '100%',
    height: 100,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  addonName: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  addonMacro: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  addonPrice: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.accent,
    marginTop: theme.spacing.sm,
  },
  adminCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  adminGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  adminIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(212,167,87,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminContent: {
    flex: 1,
  },
  adminTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
    letterSpacing: 1,
  },
  adminSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 2,
  },
  settingsContainer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
    marginTop: theme.spacing.md,
  },
  settingsLabel: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
    letterSpacing: 1,
    marginBottom: theme.spacing.sm,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  settingsText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  signOutText: {
    color: theme.colors.error,
  },
});