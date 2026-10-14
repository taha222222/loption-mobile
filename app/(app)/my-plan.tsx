import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';

const { width } = Dimensions.get('window');

interface Meal {
  id: string;
  name: string;
  time: string;
  calories: number;
  protein: number;
  image?: string;
  isCompleted?: boolean;
}

const mockMeals: Meal[] = [
  { id: '1', name: 'Protein Oatmeal', time: '08:00 AM', calories: 380, protein: 25, isCompleted: true },
  { id: '2', name: 'Grilled Chicken Bowl', time: '01:00 PM', calories: 450, protein: 35, isCompleted: true },
  { id: '3', name: 'Salmon Quinoa', time: '07:00 PM', calories: 520, protein: 42, isCompleted: false },
  { id: '4', name: 'Protein Smoothie', time: '10:00 PM', calories: 320, protein: 28, isCompleted: false },
];

export default function MyPlanScreen() {
  const [meals, setMeals] = useState(mockMeals);
  const completedCount = meals.filter(m => m.isCompleted).length;
  const totalMeals = meals.length;
  const progressPercent = (completedCount / totalMeals) * 100;

  const handleReorder = (mealId: string) => {
    console.log('Reorder meal:', mealId);
  };

  const handleComplete = (mealId: string) => {
    setMeals(prev => prev.map(meal =>
      meal.id === mealId ? { ...meal, isCompleted: !meal.isCompleted } : meal
    ));
  };

  const nextDelivery = {
    date: 'Today',
    time: '6:00 PM',
    meals: 3,
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>My Plan</Text>
        <TouchableOpacity style={styles.editButton}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Next Delivery Card - with glow effect */}
      <LinearGradient
        colors={['#1e293b', '#0f172a']}
        style={styles.deliveryCard}
      >
        <View style={styles.deliveryHeader}>
          <Ionicons name="calendar" size={20} color={theme.colors.accent} />
          <Text style={styles.deliveryLabel}>ACTIVE SYSTEM</Text>
        </View>
        <Text style={styles.deliveryTime}>{nextDelivery.date} at {nextDelivery.time}</Text>
        
        {/* Prominent Meals Remaining Card */}
        <View style={styles.mealsRemainingCard}>
          <Text style={styles.mealsRemainingValue}>{nextDelivery.meals}</Text>
          <Text style={styles.mealsRemainingLabel}>meals remaining today</Text>
        </View>
        
        <TouchableOpacity style={styles.rescheduleButton}>
          <Text style={styles.rescheduleText}>Adjust schedule →</Text>
        </TouchableOpacity>
      </LinearGradient>

      {/* Today's Progress */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>Today's Meals</Text>
          <Text style={styles.progressCount}>{completedCount}/{totalMeals} completed</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={styles.progressHint}>🔥 Complete all meals to maintain your streak!</Text>
      </View>

      {/* Meals List */}
      <ScrollView showsVerticalScrollIndicator={false} style={styles.mealsContainer}>
        <Text style={styles.sectionTitle}>Today's Plan</Text>
        
        {meals.map((meal) => (
          <View key={meal.id} style={styles.mealCard}>
            <TouchableOpacity 
              style={styles.checkbox}
              onPress={() => handleComplete(meal.id)}
            >
              <Ionicons 
                name={meal.isCompleted ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={meal.isCompleted ? theme.colors.success : theme.colors.textLight}
              />
            </TouchableOpacity>
            
            <View style={styles.mealInfo}>
              <Text style={styles.mealName}>{meal.name}</Text>
              <View style={styles.mealMeta}>
                <Text style={styles.mealTime}>{meal.time}</Text>
                <Text style={styles.mealDivider}>•</Text>
                <Text style={styles.mealCalories}>{meal.calories} cal</Text>
                <Text style={styles.mealDivider}>•</Text>
                <Text style={styles.mealProtein}>{meal.protein}g protein</Text>
              </View>
            </View>
            
            <TouchableOpacity 
              style={styles.reorderMealButton}
              onPress={() => handleReorder(meal.id)}
            >
              <Ionicons name="repeat" size={20} color={theme.colors.accent} />
              <Text style={styles.reorderMealText}>Reorder</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add Meal Option */}
        <TouchableOpacity style={styles.addMealCard}>
          <Ionicons name="add-circle" size={32} color={theme.colors.accent} />
          <View style={styles.addMealInfo}>
            <Text style={styles.addMealTitle}>Add Extra Meal</Text>
            <Text style={styles.addMealSubtitle}>Customize your plan</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textLight} />
        </TouchableOpacity>

        {/* Weekly Overview */}
        <View style={styles.weeklyContainer}>
          <Text style={styles.sectionTitle}>This Week</Text>
          <View style={styles.weekDays}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
              <View key={index} style={styles.weekDay}>
                <Text style={styles.weekDayLabel}>{day}</Text>
                <View style={[styles.weekDayDot, index < 3 && styles.weekDayCompleted]} />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA - Upgrade */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.upgradeFooterButton}
          onPress={() => router.push('/(app)/upgrade')}
        >
          <LinearGradient
            colors={theme.gradients.gold}
            style={styles.upgradeFooterGradient}
          >
            <Text style={styles.upgradeFooterText}>⬆️ Upgrade to Premium Meals</Text>
            <Ionicons name="arrow-forward" size={20} color={theme.colors.dark} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
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
  editButton: {
    padding: theme.spacing.xs,
  },
  editText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.accent,
    fontWeight: theme.typography.weights.medium,
  },
  deliveryCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent + '40',
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  deliveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  deliveryLabel: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.accent,
    letterSpacing: 1,
  },
  deliveryTime: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
    marginBottom: 4,
  },
  mealsRemainingCard: {
    backgroundColor: theme.colors.accent + '20',
    borderRadius: theme.spacing.md,
    padding: theme.spacing.md,
    marginVertical: theme.spacing.md,
    alignItems: 'center',
  },
  mealsRemainingValue: {
    fontSize: 36,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.accent,
  },
  mealsRemainingLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textWhite,
    opacity: 0.9,
  },
  rescheduleButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: theme.spacing.sm,
  },
  rescheduleText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.accent,
  },
  progressCard: {
    backgroundColor: theme.colors.card,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows.sm,
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
  progressCount: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.accent,
    fontWeight: theme.typography.weights.medium,
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: theme.spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
    borderRadius: 4,
  },
  progressHint: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
  },
  mealsContainer: {
    flex: 1,
    paddingHorizontal: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.md,
  },
  mealCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    ...theme.shadows.sm,
  },
  checkbox: {
    marginRight: theme.spacing.md,
  },
  mealInfo: {
    flex: 1,
  },
  mealName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: 4,
  },
  mealMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  mealTime: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
  },
  mealDivider: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginHorizontal: 4,
  },
  mealCalories: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
  },
  mealProtein: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
  },
  reorderMealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.sm,
  },
  reorderMealText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.accent,
    fontWeight: theme.typography.weights.medium,
  },
  addMealCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  addMealInfo: {
    flex: 1,
  },
  addMealTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
  },
  addMealSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: 2,
  },
  weeklyContainer: {
    marginBottom: theme.spacing.xl,
  },
  weekDays: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  weekDay: {
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  weekDayLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textLight,
  },
  weekDayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
  },
  weekDayCompleted: {
    backgroundColor: theme.colors.success,
  },
  footer: {
    padding: theme.spacing.xl,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  upgradeFooterButton: {
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  upgradeFooterGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  upgradeFooterText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
});