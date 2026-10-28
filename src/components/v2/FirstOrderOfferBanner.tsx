import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import type { FirstOrderOfferStatus } from '../../stores/userStore';

interface FirstOrderOfferBannerProps {
  status: FirstOrderOfferStatus | null | undefined;
}

// Display only. Eligibility and the discount itself are decided by the
// server when the order is created (public.apply_first_order_offer).
export const FirstOrderOfferBanner: React.FC<FirstOrderOfferBannerProps> = ({ status }) => {
  if (status === 'eligible') {
    return (
      <View style={styles.card} accessibilityRole="summary" testID="first-order-offer">
        <View style={styles.icon}>
          <Ionicons name="gift" size={24} color={theme.colors.ink} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Livraison offerte sur votre première commande !</Text>
          <Text style={styles.body}>Appliquée automatiquement lors de la validation de votre commande.</Text>
        </View>
      </View>
    );
  }
  if (status === 'applied') {
    return (
      <View style={[styles.card, styles.cardQuiet]} accessibilityRole="summary" testID="first-order-offer-applied">
        <Ionicons name="checkmark-circle" size={22} color={theme.colors.brand} />
        <Text style={[styles.body, styles.bodyQuiet]}>Livraison offerte appliquée à votre première commande.</Text>
      </View>
    );
  }
  return null;
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.highlight,
  },
  cardQuiet: {
    backgroundColor: theme.colors.brandSoft,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
  body: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.ink,
  },
  bodyQuiet: {
    flex: 1,
    color: theme.colors.brandDeep,
    fontWeight: theme.typography.weights.semibold,
  },
});
