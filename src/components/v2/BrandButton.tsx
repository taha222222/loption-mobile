import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { theme } from '../../theme';

interface BrandButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'solid' | 'soft';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

// Pill-shaped primary action in brand indigo (gold is reserved for highlights).
export const BrandButton: React.FC<BrandButtonProps> = ({
  title,
  onPress,
  variant = 'solid',
  disabled,
  loading,
  style,
}) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    disabled={disabled || loading}
    style={[styles.base, variant === 'soft' ? styles.soft : styles.solid, disabled && styles.disabled, style]}
  >
    {loading ? (
      <ActivityIndicator color={variant === 'soft' ? theme.colors.brand : theme.colors.textWhite} />
    ) : (
      <Text style={[styles.text, variant === 'soft' && styles.softText]} numberOfLines={1}>
        {title}
      </Text>
    )}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: theme.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing['2xl'],
  },
  solid: {
    backgroundColor: theme.colors.brand,
  },
  soft: {
    backgroundColor: theme.colors.brandSoft,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
  softText: {
    color: theme.colors.brand,
  },
});
