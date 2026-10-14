import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { theme } from '../../theme';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'dark' | 'elevated';
  padding?: keyof typeof theme.spacing;
  style?: ViewStyle;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  padding = 'lg',
  style,
}) => {
  const getBackgroundColor = () => {
    switch (variant) {
      case 'dark':
        return theme.colors.cardDark;
      default:
        return theme.colors.card;
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: getBackgroundColor(),
          padding: theme.spacing[padding],
        },
        variant === 'elevated' && styles.elevated,
        style,
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.spacing.lg,
  },
  elevated: {
    ...theme.shadows.md,
  },
});