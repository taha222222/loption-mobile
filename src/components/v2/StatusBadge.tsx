import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface StatusBadgeProps {
  label: string;
  color: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, color, icon }) => (
  <View style={[styles.badge, { backgroundColor: color + '1A' }]}>
    {icon ? <Ionicons name={icon} size={13} color={color} /> : null}
    <Text style={[styles.text, { color }]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radii.pill,
  },
  text: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
});
