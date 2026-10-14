import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../theme';

interface TierCardProps {
  id: string;
  name: string;
  description: string;
  priceWeekly: number;
  priceMonthly: number;
  benefits: string[];
  badge?: string;
  popular?: boolean;
  selected?: boolean;
  billingCycle: 'weekly' | 'monthly';
  onSelect: () => void;
}

export const TierCard: React.FC<TierCardProps> = ({
  name,
  description,
  priceWeekly,
  priceMonthly,
  benefits,
  badge,
  popular,
  selected,
  billingCycle,
  onSelect,
}) => {
  const currentPrice = billingCycle === 'weekly' ? priceWeekly : priceMonthly;
  const pricePeriod = billingCycle === 'weekly' ? 'week' : 'month';

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onSelect}
      activeOpacity={0.9}
    >
      {badge && (
        <LinearGradient
          colors={theme.gradients.gold}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.badge}
        >
          <Text style={styles.badgeText}>{badge}</Text>
        </LinearGradient>
      )}

      <View style={styles.header}>
        <Text style={[styles.name, selected && styles.nameSelected]}>{name}</Text>
        <View style={styles.priceContainer}>
          <Text style={styles.price}>{currentPrice}</Text>
          <Text style={styles.pricePeriod}> MAD / {pricePeriod}</Text>
        </View>
        <Text style={styles.description}>{description}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.benefits}>
        {benefits.map((benefit, index) => (
          <View key={index} style={styles.benefitItem}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={selected ? theme.colors.gold : theme.colors.success}
            />
            <Text style={styles.benefitText}>{benefit}</Text>
          </View>
        ))}
      </View>

      {selected && (
        <View style={styles.selectedIndicator}>
          <Ionicons name="checkmark" size={24} color={theme.colors.gold} />
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    ...theme.shadows.md,
  },
  cardSelected: {
    borderColor: theme.colors.gold,
    backgroundColor: theme.colors.gold + '08',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.spacing.md,
  },
  badgeText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
  header: {
    marginBottom: theme.spacing.md,
  },
  name: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
    marginBottom: theme.spacing.sm,
  },
  nameSelected: {
    color: theme.colors.gold,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: theme.spacing.sm,
  },
  price: {
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  pricePeriod: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    marginLeft: 4,
  },
  description: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  benefits: {
    gap: theme.spacing.sm,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  benefitText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
    flex: 1,
  },
  selectedIndicator: {
    position: 'absolute',
    bottom: theme.spacing.md,
    right: theme.spacing.md,
  },
});