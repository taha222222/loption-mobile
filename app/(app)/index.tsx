import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import {
  ActionTile,
  BasketButton,
  BrandMark,
  CalorieTodayCard,
  FirstOrderOfferBanner,
  IconBadge,
  Screen,
  SectionHeader,
  SurfaceCard,
  formatNumber,
  formatPrice,
} from '../../src/components/v2';
import { useAuthStore } from '../../src/stores/authStore';
import { useUserStore } from '../../src/stores/userStore';
import { useNutritionStore } from '../../src/stores/nutritionStore';
import { useTrackingStore } from '../../src/stores/trackingStore';
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
  const { profile, loadProfile } = useUserStore();
  const { today, history, streak, status: nutritionStatus, refresh: refreshNutrition } = useNutritionStore();
  const todaySummary = history.find((d) => d.date === today) ?? null;
  const trackingDays = useTrackingStore((s) => s.days);
  const todayBalance = trackingDays.find((d) => d.date === today) ?? null;

  const refreshTracking = useTrackingStore((s) => s.refresh);
  useFocusEffect(
    useCallback(() => {
      refreshNutrition();
      refreshTracking();
    }, [refreshNutrition, refreshTracking])
  );
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
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.notificationButton}
            accessibilityRole="button"
            accessibilityLabel="Rappels de suivi"
            onPress={() => router.push('/(app)/nutrition-reminders')}
          >
            <Ionicons name="notifications-outline" size={22} color={theme.colors.ink} />
          </TouchableOpacity>
          <BasketButton />
        </View>
      </View>

      {/* First-order offer (display only; applied by the server at checkout) */}
      <FirstOrderOfferBanner status={profile?.first_order_offer_status} />

      {/* Today's calories: the Daily Tracking budget when known (it follows
          measured activity), else the nutrition target; logged meals. */}
      <CalorieTodayCard
        targetKcal={todayBalance ? todayBalance.budgetKcal : (todaySummary?.targetKcal ?? null)}
        targetName={todayBalance?.method && todayBalance.method !== 'tdee_baseline' ? 'budget' : 'objectif'}
        consumedKcal={todaySummary?.consumedKcal ?? null}
        streak={streak?.current ?? null}
        loading={nutritionStatus !== 'ready'}
        onPress={() => router.push('/(app)/tracking')}
      />

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
          onPress={() => router.push('/(app)/tracking')}
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
  headerButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
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
