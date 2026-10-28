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
import { SurfaceCard } from '../v2/SurfaceCard';
import { formatPrice } from '../v2/format';

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

  const macros = [
    `${calories}\u00A0kcal`,
    `${protein}\u00A0g protéines`,
    carbs ? `${carbs}\u00A0g glucides` : null,
    fat ? `${fat}\u00A0g lipides` : null,
  ].filter(Boolean);

  return (
    <SurfaceCard onPress={onPress} style={styles.card}>
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
                <ActivityIndicator size="small" color={theme.colors.brand} />
              </View>
            )}
          </>
        ) : (
          <View style={styles.image}>
            <Ionicons name="restaurant-outline" size={28} color={theme.colors.inkFaint} />
          </View>
        )}
      </View>

      <View style={styles.content}>
        {popular && (
          <View style={styles.popularBadge}>
            <Ionicons name="flame" size={11} color={theme.colors.brand} />
            <Text style={styles.popularText}>Populaire</Text>
          </View>
        )}
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.macroText} numberOfLines={2}>
          {macros.join(' · ')}
        </Text>

        <View style={styles.footer}>
          <Text style={styles.price}>{formatPrice(price)}</Text>
          <TouchableOpacity
            onPress={onAddToCart}
            style={styles.addButton}
            activeOpacity={0.8}
            accessibilityLabel="Ajouter au panier"
            hitSlop={6}
          >
            <Ionicons name="add" size={22} color={theme.colors.textWhite} />
          </TouchableOpacity>
        </View>
      </View>
    </SurfaceCard>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
    padding: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  imageContainer: {
    width: 104,
    height: 116,
  },
  image: {
    width: 104,
    height: 116,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,19,43,0.15)',
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingVertical: theme.spacing.xs,
    paddingRight: theme.spacing.xs,
  },
  popularBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.colors.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radii.pill,
    marginBottom: 4,
  },
  popularText: {
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brand,
  },
  name: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.sm,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  macroText: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
    marginTop: 2,
  },
  footer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: theme.spacing.sm,
  },
  price: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
