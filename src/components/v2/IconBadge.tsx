import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface IconBadgeProps {
  icon: IconName;
  tone?: 'brand' | 'dark' | 'danger';
  size?: number;
}

const tones = {
  brand: { bg: theme.colors.brandSoft, fg: theme.colors.brand },
  dark: { bg: theme.colors.ink, fg: theme.colors.highlight },
  danger: { bg: '#FDECEC', fg: theme.colors.error },
};

export const IconBadge: React.FC<IconBadgeProps> = ({ icon, tone = 'brand', size = 44 }) => (
  <View
    style={[
      styles.badge,
      { width: size, height: size, borderRadius: size * 0.32, backgroundColor: tones[tone].bg },
    ]}
  >
    <Ionicons name={icon} size={size * 0.46} color={tones[tone].fg} />
  </View>
);

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
