import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { useUserStore } from '../../src/stores/userStore';
import { supabase } from '../../src/lib/supabase';

const { width } = Dimensions.get('window');

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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.gold} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back</Text>
          <Text style={styles.userName}>
            {user?.email?.split('@')[0] || 'User'}
          </Text>
        </View>
        <TouchableOpacity style={styles.notificationButton}>
          <Ionicons name="notifications-outline" size={24} color={theme.colors.textDark} />
          <View style={styles.notificationBadge} />
        </TouchableOpacity>
      </View>

      {/* Calorie Card */}
      <LinearGradient
        colors={theme.gradients.dark}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.calorieCard}
      >
        <Text style={styles.calorieLabel}>Daily Energy Target</Text>
        <Text style={styles.calorieValue}>
          {dailyCalories}
          <Text style={styles.calorieUnit}> kcal</Text>
        </Text>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressText}>{remainingCalories} remaining</Text>
        </View>
        <View style={styles.macroContainer}>
          <View style={styles.macroItem}>
            <Text style={styles.macroValue}>{proteinTarget}g</Text>
            <Text style={styles.macroLabel}>Protein</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={styles.macroValue}>{carbsTarget}g</Text>
            <Text style={styles.macroLabel}>Carbs</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={styles.macroValue}>{fatsTarget}g</Text>
            <Text style={styles.macroLabel}>Fats</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Quick Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/(app)/menu')}>
          <LinearGradient
            colors={theme.gradients.gold}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionGradient}
          >
            <Ionicons name="restaurant" size={28} color={theme.colors.dark} />
            <Text style={styles.actionTitle}>Order Food</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/(app)/progress')}>
          <View style={[styles.actionIcon, { backgroundColor: theme.colors.backgroundDark }]}>
            <Ionicons name="fitness" size={28} color={theme.colors.accent} />
          </View>
          <Text style={styles.actionTitle}>Track Progress</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard}>
          <View style={[styles.actionIcon, { backgroundColor: theme.colors.backgroundDark }]}>
            <Ionicons name="calendar" size={28} color={theme.colors.secondary} />
          </View>
          <Text style={styles.actionTitle}>Meal Plan</Text>
        </TouchableOpacity>
      </View>

      {/* Recommended Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recommended for You</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/menu')}>
            <Text style={styles.seeAllLink}>See All</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {recommendedMeals.map((meal) => (
            <TouchableOpacity 
              key={meal.id} 
              style={styles.recommendCard}
              onPress={() => router.push('/(app)/menu')}
            >
              <View style={styles.recommendImage} />
              <Text style={styles.recommendName}>{meal.name}</Text>
              <Text style={styles.recommendCalories}>{meal.calories} calories</Text>
              <Text style={styles.recommendPrice}>${meal.price.toFixed(2)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Subscription Banner - Show if no active subscription */}
      {!profile?.program && (
        <TouchableOpacity style={styles.subscriptionBanner}>
          <LinearGradient
            colors={theme.gradients.gold}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.bannerGradient}
          >
            <View>
              <Text style={styles.bannerTitle}>Unlock Your Potential</Text>
              <Text style={styles.bannerText}>Subscribe to get personalized meal plans</Text>
            </View>
            <Ionicons name="arrow-forward" size={24} color={theme.colors.dark} />
          </LinearGradient>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  greeting: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  userName: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
    marginTop: 4,
  },
  notificationButton: {
    position: 'relative',
    padding: theme.spacing.sm,
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.gold,
  },
  calorieCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    borderRadius: theme.spacing['2xl'],
    padding: theme.spacing.xl,
  },
  calorieLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textWhite,
    opacity: 0.8,
  },
  calorieValue: {
    fontSize: theme.typography.sizes['4xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
    marginTop: theme.spacing.sm,
  },
  calorieUnit: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.normal,
  },
  progressContainer: {
    marginTop: theme.spacing.lg,
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.gold,
    borderRadius: 4,
  },
  progressText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textWhite,
    opacity: 0.7,
    marginTop: theme.spacing.xs,
  },
  macroContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  macroItem: {
    alignItems: 'center',
  },
  macroValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textWhite,
  },
  macroLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textWhite,
    opacity: 0.7,
    marginTop: 4,
  },
  macroDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  actionCard: {
    flex: 1,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  actionGradient: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  actionIcon: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  actionTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  seeAllLink: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.gold,
    fontWeight: theme.typography.weights.semibold,
  },
  recommendCard: {
    width: 160,
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    marginLeft: theme.spacing.xl,
    padding: theme.spacing.md,
    ...theme.shadows.sm,
  },
  recommendImage: {
    width: '100%',
    height: 100,
    backgroundColor: theme.colors.border,
    borderRadius: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  recommendName: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  recommendCalories: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  recommendPrice: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
    marginTop: 8,
  },
  subscriptionBanner: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  bannerGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  bannerTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
  bannerText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.dark,
    opacity: 0.8,
    marginTop: 2,
  },
});