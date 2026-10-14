import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';

type PlanTier = 'premium' | 'ultimate';

export default function UpgradeScreen() {
  const [selectedTier, setSelectedTier] = useState<PlanTier>('premium');

  const premiumFeatures = [
    'Higher protein meals (40g+)',
    'Premium ingredients (grass-fed, organic)',
    'Priority delivery window',
    'Exclusive chef-crafted recipes',
    'Dedicated nutrition coach',
  ];

  const ultimateFeatures = [
    'Everything in Premium',
    'Unlimited meal customizations',
    'Daily meal planning support',
    'Monthly body composition scan',
    'Access to private community',
    'Free wellness events',
  ];

  const handleViewPlans = () => {
    const url = `https://loption.org/subscription.html?plan=${selectedTier}`;
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'Website',
        'Unable to open the website. Please check your connection.',
        [{ text: 'OK' }]
      );
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Premium Plans</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Current Plan Banner */}
        <View style={styles.currentPlan}>
          <Text style={styles.currentLabel}>CURRENT PLAN</Text>
          <Text style={styles.currentPlanName}>Transformation Program</Text>
          <View style={styles.currentBadge}>
            <Text style={styles.currentBadgeText}>Active</Text>
          </View>
        </View>

        {/* Premium Tier */}
        <TouchableOpacity
          style={[
            styles.tierCard,
            selectedTier === 'premium' && styles.tierCardSelected,
          ]}
          onPress={() => setSelectedTier('premium')}
        >
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={styles.tierGradient}
          >
            <View style={styles.tierHeader}>
              <View>
                <View style={styles.tierNameRow}>
                  <Text style={styles.tierName}>Premium Plus</Text>
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedText}>RECOMMENDED</Text>
                  </View>
                </View>
                <Text style={styles.tierDescription}>Higher protein • Premium ingredients</Text>
              </View>
              <View style={styles.tierPrice}>
                <Text style={styles.tierPriceValue}>Premium</Text>
                <Text style={styles.tierPricePeriod}>upgrade</Text>
              </View>
            </View>
            
            {selectedTier === 'premium' && (
              <View style={styles.featuresList}>
                {premiumFeatures.map((feature, index) => (
                  <View key={index} style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Ultimate Tier */}
        <TouchableOpacity
          style={[
            styles.tierCard,
            selectedTier === 'ultimate' && styles.tierCardSelected,
          ]}
          onPress={() => setSelectedTier('ultimate')}
        >
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={styles.tierGradient}
          >
            <View style={styles.tierHeader}>
              <View>
                <Text style={styles.tierName}>Ultimate Athlete</Text>
                <Text style={styles.tierDescription}>Maximum performance • Elite support</Text>
              </View>
              <View style={styles.tierPrice}>
                <Text style={styles.tierPriceValue}>Ultimate</Text>
                <Text style={styles.tierPricePeriod}>upgrade</Text>
              </View>
            </View>
            
            {selectedTier === 'ultimate' && (
              <View style={styles.featuresList}>
                {ultimateFeatures.map((feature, index) => (
                  <View key={index} style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Upgrade Benefits Calculator */}
        <LinearGradient
          colors={theme.gradients.gold}
          style={styles.benefitsCard}
        >
          <Text style={styles.benefitsTitle}>📊 Your Upgrade Benefits</Text>
          <View style={styles.benefitsRow}>
            <View style={styles.benefitItem}>
              <Text style={styles.benefitValue}>+15g</Text>
              <Text style={styles.benefitLabel}>More Protein/Meal</Text>
            </View>
            <View style={styles.benefitDivider} />
            <View style={styles.benefitItem}>
              <Text style={styles.benefitValue}>-30min</Text>
              <Text style={styles.benefitLabel}>Faster Delivery</Text>
            </View>
            <View style={styles.benefitDivider} />
            <View style={styles.benefitItem}>
              <Text style={styles.benefitValue}>24/7</Text>
              <Text style={styles.benefitLabel}>Coach Support</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Testimonials */}
        <View style={styles.testimonials}>
          <Text style={styles.testimonialTitle}>Trusted by elite athletes</Text>
          <View style={styles.testimonialCard}>
            <View style={styles.stars}>
              <Ionicons name="star" size={14} color={theme.colors.gold} />
              <Ionicons name="star" size={14} color={theme.colors.gold} />
              <Ionicons name="star" size={14} color={theme.colors.gold} />
              <Ionicons name="star" size={14} color={theme.colors.gold} />
              <Ionicons name="star" size={14} color={theme.colors.gold} />
            </View>
            <Text style={styles.testimonialText}>
              "Upgraded to Premium - best decision ever! Hit my protein goals effortlessly."
            </Text>
            <Text style={styles.testimonialAuthor}>— Karim, Casablanca</Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA - Safe and compliant */}
      <View style={styles.footer}>
        <Button
          title={`VIEW PLANS • ${selectedTier === 'premium' ? 'Premium Plus' : 'Ultimate Athlete'}`}
          variant="gold"
          onPress={handleViewPlans}
          size="lg"
        />
        <Text style={styles.complianceText}>
          Manage your subscription on our website
        </Text>
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
  currentPlan: {
    backgroundColor: theme.colors.backgroundDark,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    alignItems: 'center',
  },
  currentLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    letterSpacing: 1,
    marginBottom: 4,
  },
  currentPlanName: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textDark,
  },
  currentBadge: {
    backgroundColor: theme.colors.success + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  currentBadgeText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.success,
  },
  tierCard: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tierCardSelected: {
    borderColor: theme.colors.gold,
  },
  tierGradient: {
    padding: theme.spacing.lg,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tierNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  tierName: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textWhite,
  },
  recommendedBadge: {
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.spacing.sm,
  },
  recommendedText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
  tierDescription: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textWhite,
    opacity: 0.8,
    marginTop: 2,
  },
  tierPrice: {
    alignItems: 'flex-end',
  },
  tierPriceValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.gold,
  },
  tierPricePeriod: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textWhite,
    opacity: 0.7,
  },
  featuresList: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  featureText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textWhite,
    opacity: 0.9,
  },
  benefitsCard: {
    marginHorizontal: theme.spacing.xl,
    marginVertical: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  benefitsTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  benefitsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  benefitItem: {
    flex: 1,
    alignItems: 'center',
  },
  benefitValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dark,
  },
  benefitLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.dark,
    opacity: 0.8,
    marginTop: 2,
  },
  benefitDivider: {
    width: 1,
    backgroundColor: theme.colors.dark,
    opacity: 0.2,
  },
  testimonials: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  testimonialTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.sm,
  },
  testimonialCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: theme.spacing.sm,
  },
  testimonialText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textDark,
    lineHeight: 20,
  },
  testimonialAuthor: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
  },
  footer: {
    padding: theme.spacing.xl,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  complianceText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textLight,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
});