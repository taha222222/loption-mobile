import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { AdminAuthModal } from '../../src/components/admin/AdminAuthModal';
import { useAuthStore } from '../../src/stores/authStore';
import { useUserStore } from '../../src/stores/userStore';
import { useSubscriptionStore } from '../../src/stores/subscriptionStore';
import { IconBadge, Screen, SectionHeader, SurfaceCard, formatPrice } from '../../src/components/v2';

export default function ProfileScreen() {
  const { user, signOut, role } = useAuthStore();
  const { profile } = useUserStore();
  const { subscription, fetchSubscription } = useSubscriptionStore();
  const [showAdminModal, setShowAdminModal] = useState(false);

  // Mock data - will be replaced with real data from Supabase
  const streakDays = 7;
  const weightChange = -2.4;
  const completionPercent = 65;
  const nextDelivery = "Aujourd'hui, 18h00";
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
        case 'meals_only': return 'Repas uniquement';
        case 'coaching': return 'Programme Coaching';
        case 'transformation': return 'Programme Transformation';
        case 'premium': return 'Premium Plus';
        case 'ultimate': return 'Ultimate Athlete';
        default: return 'Plan actif';
      }
    }
    
    switch (profile?.program) {
      case 'meals_only': return 'Repas uniquement';
      case 'coaching': return 'Programme Coaching';
      case 'transformation': return 'Programme Transformation';
      default: return 'Aucun plan actif';
    }
  };

  const hasActiveSubscription = subscription?.status === 'active';
  const isAdmin = role === 'admin';

  const handleSignOut = () => {
    Alert.alert(
      'Se déconnecter',
      'Voulez-vous vraiment vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { 
          text: 'Se déconnecter', 
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
    <Screen scroll>
      {/* Header - Identity Section */}
      <View style={styles.header}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>{user?.email?.split('@')[0] || 'Utilisateur'}</Text>
            <View style={[styles.programBadge, hasActiveSubscription && styles.activeProgramBadge]}>
              <Text style={[styles.programText, hasActiveSubscription && styles.activeProgramText]}>
                {getProgramName()}
              </Text>
            </View>
          </View>
        </View>

        {/* Progress Stats */}
        <SurfaceCard style={styles.progressStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, weightChange < 0 && styles.statSuccess]}>
              {`${weightChange > 0 ? '+' : '-'}${String(Math.abs(weightChange)).replace('.', ',')}\u00A0kg`}
            </Text>
            <Text style={styles.statLabel}>évolution du poids</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{completionPercent}{'\u00A0'}%</Text>
            <Text style={styles.statLabel}>plan accompli</Text>
          </View>
        </SurfaceCard>
      </View>

      {/* Primary Actions - Revenue Drivers */}
      <View style={styles.stack}>
        {/* My Plan - Daily engagement driver */}
        <SurfaceCard style={styles.row} onPress={() => router.push('/(app)/my-plan')}>
          <IconBadge icon="calendar-outline" />
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Mon plan</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>Prochaine livraison : {nextDelivery}</Text>
            <Text style={styles.rowDetail}>3 repas restants aujourd'hui</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.inkFaint} />
        </SurfaceCard>

        {/* Reorder - Conversion driver */}
        <SurfaceCard style={styles.row} onPress={() => router.push('/(app)/reorder')}>
          <IconBadge icon="repeat" />
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Recommander</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>Dernier : {lastOrder.name}</Text>
          </View>
          <TouchableOpacity style={styles.oneTapButton}>
            <Text style={styles.oneTapText}>1 clic</Text>
          </TouchableOpacity>
        </SurfaceCard>

        {/* Upgrade Plan - AOV driver */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.upgradeCard}
          onPress={() => router.push('/(app)/upgrade')}
        >
          <View style={styles.upgradeGlow} />
          <View style={styles.upgradeIcon}>
            <Ionicons name="flash" size={22} color={theme.colors.textWhite} />
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.upgradeTitle}>Passer au plan supérieur</Text>
            <Text style={styles.upgradeSubtitle} numberOfLines={1}>Plus de protéines · Repas premium</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={theme.colors.textWhite} />
        </TouchableOpacity>
      </View>

      {/* Retention Section - Streak & Progress */}
      <View style={styles.stack}>
        {/* Streak Card */}
        <SurfaceCard style={styles.row}>
          <IconBadge icon="flame" />
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>{streakDays} jours d'affilée</Text>
            <Text style={styles.rowSubtitle}>Ne cassez pas votre série !</Text>
            <Text style={styles.rowDetail}>
              Encore {10 - streakDays} jours pour la récompense des 10 jours
            </Text>
          </View>
          <View style={styles.rewardPill}>
            <Text style={styles.rewardText}>+50 pts</Text>
          </View>
        </SurfaceCard>

        {/* Progress Card */}
        <SurfaceCard>
          <View style={styles.progressHeader}>
            <Text style={styles.rowTitle}>Progression de l'objectif</Text>
            <Text style={styles.progressPercent}>{completionPercent}{'\u00A0'}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${completionPercent}%` }]} />
          </View>
          <Text style={styles.progressHint}>Terminez votre plan pour débloquer des récompenses</Text>
        </SurfaceCard>
      </View>

      {/* Exclusive Offers - High perceived value */}
      <View style={styles.section}>
        <SectionHeader title="Offres exclusives" />
        <TouchableOpacity activeOpacity={0.85} style={styles.offerCard}>
          <View style={styles.offerTop}>
            <Text style={styles.offerTitle}>Summer Shred Box</Text>
            <View style={styles.offerBadge}>
              <Text style={styles.offerBadgeText}>Meilleure vente</Text>
            </View>
          </View>
          <Text style={styles.offerDescription}>5 repas premium · 40{'\u00A0'}g de protéines chacun</Text>
          <View style={styles.offerPriceRow}>
            <Text style={styles.offerPrice}>{formatPrice(299)}</Text>
            <Text style={styles.offerOriginal}>{formatPrice(399)}</Text>
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>-{formatPrice(100)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Add-ons - High-margin upsells */}
      <View style={styles.section}>
        <SectionHeader title="Ajouter à la commande" actionLabel="Voir tout" onAction={() => {}} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.addonsContainer}
        >
          {[
            { name: 'Smoothie protéiné', macro: '+25\u00A0g de protéines', price: 39 },
            { name: 'Box snack céto', macro: 'Faible en glucides · 15\u00A0g de protéines', price: 49 },
            { name: 'Dessert protéiné', macro: '20\u00A0g de protéines · 280\u00A0kcal', price: 29 },
          ].map((addon) => (
            <SurfaceCard key={addon.name} style={styles.addonCard} onPress={() => {}}>
              <View style={styles.addonImage}>
                <Ionicons name="nutrition-outline" size={26} color={theme.colors.brand} />
              </View>
              <Text style={styles.addonName} numberOfLines={1}>{addon.name}</Text>
              <Text style={styles.addonMacro} numberOfLines={2}>{addon.macro}</Text>
              <Text style={styles.addonPrice}>{formatPrice(addon.price)}</Text>
            </SurfaceCard>
          ))}
        </ScrollView>
      </View>

      {/* Admin Dashboard - Only visible to admin users */}
      {isAdmin && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.adminCard}
          onPress={() => setShowAdminModal(true)}
        >
          <View style={styles.adminIcon}>
            <Ionicons name="shield-checkmark" size={24} color={theme.colors.textWhite} />
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.adminTitle}>Tableau de bord admin</Text>
            <Text style={styles.adminSubtitle}>Gérer commandes, livreurs, repas</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.inkFaint} />
        </TouchableOpacity>
      )}

      {/* Settings Section */}
      <View style={styles.settingsContainer}>
        <Text style={styles.settingsLabel}>PARAMÈTRES</Text>
        <SurfaceCard style={styles.settingsCard}>
          <TouchableOpacity style={styles.settingsItem}>
            <Ionicons name="help-circle-outline" size={20} color={theme.colors.inkMuted} />
            <Text style={styles.settingsText}>Centre d'aide</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.inkFaint} />
          </TouchableOpacity>
          <View style={styles.settingsDivider} />
          <TouchableOpacity style={styles.settingsItem} onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={20} color={theme.colors.error} />
            <Text style={[styles.settingsText, styles.signOutText]}>Se déconnecter</Text>
          </TouchableOpacity>
        </SurfaceCard>
      </View>

      {/* Admin Auth Modal */}
      <AdminAuthModal
        visible={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onSuccess={() => router.push('./(admin)')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
  identityText: {
    flex: 1,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  name: {
    fontSize: theme.typography.sizes['2xl'],
    lineHeight: theme.typography.lineHeights.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.4,
  },
  programBadge: {
    backgroundColor: theme.colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  activeProgramBadge: {
    backgroundColor: theme.colors.brand,
  },
  programText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.bold,
  },
  activeProgramText: {
    color: theme.colors.textWhite,
  },
  progressStats: {
    flexDirection: 'row',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  statSuccess: {
    color: theme.colors.success,
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: theme.colors.hairline,
  },
  stack: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  rowSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
    marginTop: 2,
  },
  rowDetail: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brand,
    marginTop: 2,
  },
  oneTapButton: {
    backgroundColor: theme.colors.brand,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
  },
  oneTapText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  upgradeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.brand,
    overflow: 'hidden',
  },
  upgradeGlow: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  upgradeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  upgradeSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.brandOnDark,
    marginTop: 2,
  },
  rewardPill: {
    backgroundColor: theme.colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radii.pill,
  },
  rewardText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  progressPercent: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.colors.brandSoft,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.brand,
    borderRadius: 4,
  },
  progressHint: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
    marginTop: theme.spacing.sm,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  offerCard: {
    marginHorizontal: theme.spacing.xl,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.ink,
  },
  offerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  offerTitle: {
    flex: 1,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  offerDescription: {
    fontSize: theme.typography.sizes.sm,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  offerPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  offerPrice: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  offerOriginal: {
    fontSize: theme.typography.sizes.sm,
    textDecorationLine: 'line-through',
    color: 'rgba(255,255,255,0.5)',
  },
  saveBadge: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radii.pill,
  },
  saveBadgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  offerBadge: {
    backgroundColor: theme.colors.brand,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
  },
  offerBadgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  addonsContainer: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  addonCard: {
    width: 156,
    padding: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  addonImage: {
    height: 92,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  addonName: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    paddingHorizontal: 4,
  },
  addonMacro: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
    marginTop: 2,
    paddingHorizontal: 4,
  },
  addonPrice: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
    marginTop: theme.spacing.sm,
    paddingHorizontal: 4,
  },
  adminCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.ink,
  },
  adminIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  adminSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  settingsContainer: {
    paddingHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.xs,
  },
  settingsLabel: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.inkMuted,
    letterSpacing: 1,
    marginBottom: theme.spacing.sm,
    marginLeft: theme.spacing.xs,
  },
  settingsCard: {
    paddingVertical: theme.spacing.xs,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: theme.colors.hairline,
  },
  settingsText: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  signOutText: {
    color: theme.colors.error,
  },
});
