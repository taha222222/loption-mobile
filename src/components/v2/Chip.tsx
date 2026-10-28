import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface ChipProps {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  active?: boolean;
  onPress?: () => void;
}

export const Chip: React.FC<ChipProps> = ({ label, icon, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    style={[styles.chip, active && styles.active]}
  >
    {icon ? (
      <Ionicons name={icon} size={16} color={active ? theme.colors.textWhite : theme.colors.inkMuted} />
    ) : null}
    <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  active: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
  },
  labelActive: {
    color: theme.colors.textWhite,
  },
});
