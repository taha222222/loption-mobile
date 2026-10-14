import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { MealCard } from '../../src/components/ui/MealCard';
import { supabase } from '../../src/lib/supabase';
import { useCartStore } from '../../src/stores/cartStore';
import { useUserStore } from '../../src/stores/userStore';

interface Meal {
  id: string;
  name: string;
  price: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  image_url: string | null;
  category: string;
  popular: boolean;
  available: boolean;
}

const categories = [
  { id: 'all', name: 'All', icon: 'grid-outline' },
  { id: 'popular', name: 'Popular', icon: 'flame-outline' },
  { id: 'high_protein', name: 'High Protein', icon: 'fitness-outline' },
  { id: 'low_calorie', name: 'Low Calorie', icon: 'leaf-outline' },
  { id: 'balanced', name: 'Balanced', icon: 'nutrition-outline' },
  { id: 'drinks', name: 'Drinks', icon: 'cafe-outline' },
  { id: 'desserts', name: 'Desserts', icon: 'ice-cream-outline' },
];

export default function MenuScreen() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [smartFilterEnabled, setSmartFilterEnabled] = useState(false);
  const { addItem, getItemCount } = useCartStore();
  const { profile } = useUserStore();

  useEffect(() => {
    fetchMeals();
  }, [selectedCategory, smartFilterEnabled]);

  const fetchMeals = async () => {
    setLoading(true);
    
    try {
      let query = supabase
        .from('meals')
        .select('*')
        .eq('available', true)
        .order('name');
      
      // Apply category filter at database level
      if (selectedCategory === 'popular') {
        query = query.eq('popular', true);
      } else if (selectedCategory !== 'all') {
        query = query.eq('category', selectedCategory);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching meals:', error);
        Alert.alert('Error', 'Failed to load meals. Please try again.');
        setMeals([]);
      } else if (data) {
        let filteredMeals = data;
        
        // Apply goal-based smart filtering only if enabled
        if (smartFilterEnabled && profile?.goal) {
          if (profile.goal === 'lose_fat') {
            filteredMeals = data.filter((m: Meal) => m.calories < 500);
            console.log(`🎯 Smart filter (lose_fat): ${filteredMeals.length} meals under 500 cal`);
          } else if (profile.goal === 'gain_muscle') {
            filteredMeals = data.filter((m: Meal) => m.protein > 25);
            console.log(`🎯 Smart filter (gain_muscle): ${filteredMeals.length} meals with >25g protein`);
          }
        }
        
        setMeals(filteredMeals);
      } else {
        setMeals([]);
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setMeals([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = (meal: Meal) => {
    addItem({
      id: meal.id,
      name: meal.name,
      price: meal.price,
      calories: meal.calories,
      protein: meal.protein,
      image: meal.image_url || undefined,
    });
  };

  const getSmartFilterLabel = () => {
    if (!profile?.goal) return '';
    switch (profile.goal) {
      case 'lose_fat': return 'Under 500 cal';
      case 'gain_muscle': return 'High Protein';
      case 'maintain': return 'Balanced';
      default: return '';
    }
  };

  const cartItemCount = getItemCount();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu</Text>
        <TouchableOpacity
          style={styles.cartButton}
          onPress={() => router.push('/(app)/cart')}
        >
          <Ionicons name="cart-outline" size={24} color={theme.colors.textDark} />
          {cartItemCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartItemCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Smart Filter Toggle - Only show if user has a goal set */}
      {profile?.goal && (
        <TouchableOpacity
          style={[
            styles.smartFilterButton,
            smartFilterEnabled && styles.smartFilterActive,
          ]}
          onPress={() => setSmartFilterEnabled(!smartFilterEnabled)}
        >
          <Ionicons 
            name={smartFilterEnabled ? "flash" : "flash-outline"} 
            size={16} 
            color={smartFilterEnabled ? theme.colors.gold : theme.colors.textLight} 
          />
          <Text
            style={[
              styles.smartFilterText,
              smartFilterEnabled && styles.smartFilterTextActive,
            ]}
          >
            {smartFilterEnabled 
              ? `Smart Filter: ${getSmartFilterLabel()} ON` 
              : 'Show recommended meals'}
          </Text>
          <Ionicons 
            name={smartFilterEnabled ? "checkmark-circle" : "help-circle-outline"} 
            size={16} 
            color={smartFilterEnabled ? theme.colors.gold : theme.colors.textLight} 
          />
        </TouchableOpacity>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoriesContainer}
        contentContainerStyle={styles.categoriesContent}
      >
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.categoryItem,
              selectedCategory === cat.id && styles.categoryActive,
            ]}
            onPress={() => setSelectedCategory(cat.id)}
          >
            <Ionicons
              name={cat.icon as any}
              size={20}
              color={selectedCategory === cat.id ? theme.colors.gold : theme.colors.textLight}
            />
            <Text
              style={[
                styles.categoryName,
                selectedCategory === cat.id && styles.categoryNameActive,
              ]}
            >
              {cat.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.gold} />
        </View>
      ) : meals.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="restaurant-outline" size={64} color={theme.colors.textLight} />
          <Text style={styles.emptyText}>No meals found</Text>
          <Text style={styles.emptySubtext}>
            {smartFilterEnabled 
              ? 'Try turning off smart filter to see all meals' 
              : 'Check back later or try another category'}
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.mealsContainer}
        >
          {meals.map((meal) => (
            <MealCard
              key={meal.id}
              id={meal.id}
              name={meal.name}
              price={meal.price}
              calories={meal.calories}
              protein={meal.protein}
              carbs={meal.carbs}
              fat={meal.fat}
              image={meal.image_url || undefined}
              popular={meal.popular}
              onAddToCart={() => handleAddToCart(meal)}
              onPress={() => router.push(`/(app)/meal/${meal.id}`)}
            />
          ))}
        </ScrollView>
      )}
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
  title: {
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  cartButton: {
    position: 'relative',
    padding: theme.spacing.sm,
  },
  cartBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: theme.colors.gold,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
  smartFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: 12,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  smartFilterActive: {
    backgroundColor: theme.colors.gold + '15',
    borderColor: theme.colors.gold + '40',
  },
  smartFilterText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    fontWeight: theme.typography.weights.medium,
  },
  smartFilterTextActive: {
    color: theme.colors.gold,
  },
  categoriesContainer: {
    maxHeight: 80,
  },
  categoriesContent: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundDark,
    borderRadius: 24,
    gap: theme.spacing.xs,
  },
  categoryActive: {
    backgroundColor: theme.colors.gold + '20',
    borderWidth: 1,
    borderColor: theme.colors.gold,
  },
  categoryName: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
  },
  categoryNameActive: {
    color: theme.colors.gold,
    fontWeight: theme.typography.weights.medium,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.textLight,
    marginTop: theme.spacing.md,
  },
  emptySubtext: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
  mealsContainer: {
    padding: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
});