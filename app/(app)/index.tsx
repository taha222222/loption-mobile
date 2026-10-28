import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import {
  ActionTile,
  BrandMark,
  IconBadge,
  MacroBar,
  ProgressRing,
  Screen,
  SectionHeader,
  SurfaceCard,
  formatNumber,
  formatPrice,
} from '../../src/components/v2';
import { useAuthStore } from '../../src/stores/authStore';
import { useUserStore } from '../../src/stores/userStore';
import { supabase } from '../../src/lib/supabase';

interface Meal {
  id: string;
  name: string;
  price: number;
  calories: number;
  image_url: string | null;
}

export default function HomeScreen() {
  const { user } = useAuthStore();
  const { 
    profile, 
    loadProfile, 
    calculateDailyCalories, 
    calculateProteinTarget,
    calculateCarbsTarget,
    calculateFatsTarget 
  } = useUserStore();
  const [recommendedMeals, setRecommendedMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadProfile(user.id);
      fetchRecommendedMeals();
    }
  }, [user]);

  const fetchRecommendedMeals = async () => {
    const { data } = await supabase
      .from('meals')
      .select('id, name, price, calories, image_url')
      .limit(3);
    
    if (data) {
      setRecommendedMeals(data);
    }
    setLoading(false);
  };

  const dailyCalories = calculateDailyCalories();
  const proteinTarget = calculateProteinTarget();
  const carbsTarget = calculateCarbsTarget();
  const fatsTarget = calculateFatsTarget();

  // Estimate remaining calories (assume 60% consumed by end of day)
  const remainingCalories = Math.round(dailyCalories * 0.6);
  const progressPercent = 40; // 40% consumed
  const consumedCalories = dailyCalories - remainingCalories;
  // Macro intake isn't tracked yet: show the same placeholder share as calories.
  const consumedShare = (target: number) => Math.round((target * progressPercent) / 100);

  if (loading) {
    return (
      <Screen contentStyle={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {/* Header */}
      <View style={styles.header}>
        <BrandMark size={48} />
        <View style={styles.headerText}>
          <Text style={styles.greeting} numberOfLines={1}>Bonjour</Text>
          <Text style={styles.userName} numberOfLines={1}>
            {user?.email?.split('@')[0] || 'Utilisateur'}
          </Text>
        </View>
        <TouchableOpacity style={styles.notificationButton} accessibilityLabel="Notifications">
          <Ionicons name="notifications-outline" size={22} color={theme.colors.ink} />
          <View style={styles.notificationBadge} />
        </TouchableOpacity>
      </View>

      {/* Energy card */}
      <View style={styles.energyCard}>
        <View style={styles.energyGlow} />
        <View style={styles.energyTop}>
          <View style={styles.energyText}>
            <Text style={styles.energyLabel}>Énergie du jour</Text>
            <Text
              style={styles.energyValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatNumber(remainingCalories)}
            </Text>
            <Text style={styles.energyUnit} numberOfLines={1}>kcal restantes</Text>
          </View>
          <ProgressRing progress={progressPercent / 100} size={116} stroke={12}>
            <Text style={styles.ringValue}>{`${progressPercent}\u00A0%`}</Text>
            <Text style={styles.ringLabel}>CONSOMMÉ</Text>
          </ProgressRing>
        </View>
        <Text style={styles.energyMeta} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {`${formatNumber(consumedCalories)} consommées · objectif ${formatNumber(dailyCalories)}`}
        </Text>
        <View style={styles.energyDivider} />
        <View style={styles.macroRow}>
          <MacroBar label="Protéines" value={consumedShare(proteinTarget)} target={proteinTarget} color={theme.colors.coral} />
          <MacroBar label="Glucides" value={consumedShare(carbsTarget)} target={carbsTarget} color={theme.colors.highlight} />
          <MacroBar label="Lipides" value={consumedShare(fatsTarget)} target={fatsTarget} color={theme.colors.textWhite} />
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsContainer}>
        <ActionTile
          icon="restaurant"
          label="Commander un repas"
          highlighted
          onPress={() => router.push('/(app)/menu')}
        />
        <ActionTile
          icon="pulse"
          label="Suivre mes progrès"
          onPress={() => router.push('/(app)/progress')}
        />
        <ActionTile icon="calendar-outline" label="Plan repas" />
      </View>

      {/* Recommended Section */}
      <View style={styles.section}>
        <SectionHeader
          title="Recommandé pour vous"
          actionLabel="Voir tout"
          onAction={() => router.push('/(app)/menu')}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recommendList}
        >
          {recommendedMeals.map((meal) => (
            <SurfaceCard
              key={meal.id}
              style={styles.recommendCard}
              onPress={() => router.push('/(app)/menu')}
            >
              <View style={styles.recommendImageWrap}>
                {meal.image_url ? (
                  <Image source={{ uri: meal.image_url }} style={styles.recommendImage} />
                ) : (
                  <View style={[styles.recommendImage, styles.recommendPlaceholder]}>
                    <Ionicons name="restaurant-outline" size={28} color={theme.colors.inkFaint} />
                  </View>
                )}
                <View style={styles.kcalPill}>
                  <Text style={styles.kcalPillText}>{`${formatNumber(meal.calories)}\u00A0kcal`}</Text>
                </View>
              </View>
              <Text style={styles.recommendName} numberOfLines={2}>{meal.name}</Text>
              <Text style={styles.recommendPrice}>{formatPrice(meal.price)}</Text>
            </SurfaceCard>
          ))}
        </ScrollView>
      </View>

      {/* Subscription Banner - Show if no active subscription */}
      {!profile?.program && (
        <SurfaceCard style={styles.subscriptionBanner}>
          <IconBadge icon="sparkles-outline" />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>Libérez votre potentiel</Text>
            <Text style={styles.bannerSubtitle}>
              Abonnez-vous pour des plans repas personnalisés
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.inkMuted} />
        </SurfaceCard>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  userName: {
    fontSize: theme.typography.sizes['2xl'],
    lineHeight: theme.typography.lineHeights.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.4,
  },
  notificationButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: 11,
    right: 12,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.colors.surface,
    backgroundColor: theme.colors.highlight,
  },
  energyCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.brand,
    overflow: 'hidden',
  },
  energyGlow: {
    position: 'absolute',
    top: -90,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  energyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  energyText: {
    flex: 1,
    minWidth: 0,
  },
  energyLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandOnDark,
  },
  energyValue: {
    fontSize: theme.typography.sizes.display,
    lineHeight: theme.typography.lineHeights.display,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
    letterSpacing: -1.5,
    marginTop: theme.spacing.xs,
  },
  energyUnit: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandOnDark,
  },
  ringValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  ringLabel: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandOnDark,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  energyMeta: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.brandOnDark,
    marginTop: theme.spacing.md,
  },
  energyDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginVertical: theme.spacing.lg,
  },
  macroRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
    gap: 10,
    marginBottom: theme.spacing['2xl'],
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  recommendList: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  recommendCard: {
    width: 220,
    padding: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
  },
  recommendImageWrap: {
    marginBottom: theme.spacing.md,
  },
  recommendImage: {
    width: '100%',
    height: 140,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.canvas,
  },
  recommendPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  kcalPill: {
    position: 'absolute',
    top: theme.spacing.sm,
    left: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  kcalPillText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  recommendName: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.sm,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    paddingHorizontal: theme.spacing.sm,
  },
  recommendPrice: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brand,
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  subscriptionBanner: {
    marginHorizontal: theme.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  bannerSubtitle: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
    marginTop: 2,
  },
});
