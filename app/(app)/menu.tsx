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
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { MealCard } from '../../src/components/ui/MealCard';
import { Chip, EmptyState, Screen, ScreenHeader } from '../../src/components/v2';
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
  { id: 'all', name: 'Tout', icon: 'grid-outline' },
  { id: 'popular', name: 'Populaires', icon: 'flame-outline' },
  { id: 'high_protein', name: 'Riche en protéines', icon: 'fitness-outline' },
  { id: 'low_calorie', name: 'Faible en calories', icon: 'leaf-outline' },
  { id: 'balanced', name: 'Équilibré', icon: 'nutrition-outline' },
  { id: 'drinks', name: 'Boissons', icon: 'cafe-outline' },
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
        Alert.alert('Erreur', 'Impossible de charger les repas. Veuillez réessayer.');
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
      case 'lose_fat': return 'moins de 500 kcal';
      case 'gain_muscle': return 'riche en protéines';
      case 'maintain': return 'équilibré';
      default: return '';
    }
  };

  const cartItemCount = getItemCount();

  return (
    <Screen>
      <ScreenHeader
        subtitle="Menu"
        title="Nos repas"
        right={
          <TouchableOpacity
            style={styles.cartButton}
            onPress={() => router.push('/(app)/cart')}
            accessibilityLabel="Panier"
          >
            <Ionicons name="cart-outline" size={22} color={theme.colors.ink} />
            {cartItemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{cartItemCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        }
      />

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
            color={smartFilterEnabled ? theme.colors.textWhite : theme.colors.brand}
          />
          <Text
            style={[
              styles.smartFilterText,
              smartFilterEnabled && styles.smartFilterTextActive,
            ]}
            numberOfLines={1}
          >
            {smartFilterEnabled
              ? `Filtre intelligent : ${getSmartFilterLabel()}`
              : 'Afficher les repas recommandés'}
          </Text>
          <Ionicons
            name={smartFilterEnabled ? "checkmark-circle" : "chevron-forward"}
            size={16}
            color={smartFilterEnabled ? theme.colors.textWhite : theme.colors.brand}
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
          <Chip
            key={cat.id}
            label={cat.name}
            icon={cat.icon as any}
            active={selectedCategory === cat.id}
            onPress={() => setSelectedCategory(cat.id)}
          />
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.brand} />
        </View>
      ) : meals.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="Aucun repas trouvé"
          message={smartFilterEnabled
            ? 'Désactivez le filtre intelligent pour voir tous les repas'
            : 'Revenez plus tard ou essayez une autre catégorie'}
        />
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
              // No meal detail screen exists yet; the card used to navigate to
              // the missing route /(app)/meal/[id] ("Unmatched route").
            />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cartButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    backgroundColor: theme.colors.brand,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  cartBadgeText: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  smartFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    height: 48,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.brandSoft,
    borderRadius: theme.radii.pill,
    gap: theme.spacing.sm,
  },
  smartFilterActive: {
    backgroundColor: theme.colors.brand,
  },
  smartFilterText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.bold,
  },
  smartFilterTextActive: {
    color: theme.colors.textWhite,
  },
  categoriesContainer: {
    flexGrow: 0,
  },
  categoriesContent: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mealsContainer: {
    padding: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
});
