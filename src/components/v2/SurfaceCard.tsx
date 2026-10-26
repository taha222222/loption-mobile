import React from 'react';
import { StyleSheet, TouchableOpacity, View, ViewStyle, StyleProp } from 'react-native';
import { theme } from '../../theme';

interface SurfaceCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

// Rounded white card with a hairline border: the base surface of redesign v2.
export const SurfaceCard: React.FC<SurfaceCardProps> = ({ children, onPress, style }) =>
  onPress ? (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, style]}>
      {children}
    </TouchableOpacity>
  ) : (
    <View style={[styles.card, style]}>{children}</View>
  );

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.lg,
  },
});
