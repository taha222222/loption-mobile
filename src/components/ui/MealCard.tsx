import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { Card } from './Card';

interface MealCardProps {
  id: string;
  name: string;
  price: number;
  calories: number;
  protein: number;
  carbs?: number;
  fat?: number;
  image?: string;
  popular?: boolean;
  onAddToCart: () => void;
  onPress?: () => void;
}

export const MealCard: React.FC<MealCardProps> = ({
  name,
  price,
  calories,
  protein,
  carbs,
  fat,
  image,
  popular = false,
  onAddToCart,
  onPress,
}) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card variant="elevated" style={styles.card}>
        <View style={styles.imageContainer}>
          {image && !imageError ? (
            <>
              <Image
                source={{ uri: image }}
                style={styles.image}
                onLoadStart={() => setImageLoading(true)}
                onLoadEnd={() => setImageLoading(false)}
                onError={() => {
                  setImageError(true);
                  setImageLoading(false);
                }}
              />
              {imageLoading && (
                <View style={styles.imageLoadingOverlay}>
                  <ActivityIndicator size="small" color={theme.colors.gold} />
                </View>
              )}
            </>
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="restaurant-outline" size={32} color={theme.colors.textLight} />
            </View>
          )}
          {popular && (
            <View style={styles.popularBadge}>
              <Ionicons name="flame" size={10} color={theme.colors.dark} />
              <Text style={styles.popularText}>Popular</Text>
            </View>
          )}
        </View>
        
        <View style={styles.content}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          
          <View style={styles.macros}>
            <View style={styles.macro}>
              <Ionicons name="flame-outline" size={12} color={theme.colors.textLight} />
              <Text style={styles.macroText}>{calories} cal</Text>
            </View>
            <View style={styles.macro}>
              <Ionicons name="nutrition-outline" size={12} color={theme.colors.textLight} />
              <Text style={styles.macroText}>{protein}g protein</Text>
            </View>
            {carbs !== undefined && carbs > 0 && (
              <View style={styles.macro}>
                <Ionicons name="leaf-outline" size={12} color={theme.colors.textLight} />
                <Text style={styles.macroText}>{carbs}g carbs</Text>
              </View>
            )}
            {fat !== undefined && fat > 0 && (
              <View style={styles.macro}>
                <Ionicons name="egg-outline" size={12} color={theme.colors.textLight} />
                <Text style={styles.macroText}>{fat}g fat</Text>
              </View>
            )}
          </View>
          
          <View style={styles.footer}>
            <Text style={styles.price}>{price} MAD</Text>
            <TouchableOpacity onPress={onAddToCart} style={styles.addButton} activeOpacity={0.7}>
              <Ionicons name="add-circle" size={32} color={theme.colors.gold} />
            </TouchableOpacity>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
    width: 100,
    height: 120,
  },
  image: {
    width: 100,
    height: 120,
    borderRadius: theme.spacing.md,
    backgroundColor: theme.colors.backgroundDark,
  },
  imageLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholder: {
    width: 100,
    height: 120,
    borderRadius: theme.spacing.md,
    backgroundColor: theme.colors.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularBadge: {
    position: 'absolute',
    top: theme.spacing.xs,
    left: theme.spacing.xs,
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  popularText: {
    fontSize: 9,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.dark,
  },
  content: {
    flex: 1,
    marginLeft: theme.spacing.md,
    justifyContent: 'space-between',
  },
  name: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.xs,
  },
  macros: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  macro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  macroText: {
    fontSize: 10,
    color: theme.colors.textLight,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  addButton: {
    padding: theme.spacing.xs,
  },
});