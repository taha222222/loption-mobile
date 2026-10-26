import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { IconBadge } from './IconBadge';

interface ActionTileProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress?: () => void;
  highlighted?: boolean;
}

// Square quick-action tile. Only the primary action ("Commander") is highlighted gold.
export const ActionTile: React.FC<ActionTileProps> = ({ icon, label, onPress, highlighted }) => {
  // Three tiles share one row; step the label down on narrow phones so
  // "Commander" never breaks mid-word.
  const { width } = useWindowDimensions();
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.tile, highlighted && styles.highlighted]}
    >
      <IconBadge icon={icon} tone={highlighted ? 'dark' : 'brand'} />
      <Text style={[styles.label, width < 375 && styles.labelCompact]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 124,
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.md,
    paddingHorizontal: 10,
  },
  highlighted: {
    backgroundColor: theme.colors.highlight,
    borderColor: theme.colors.highlight,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.1,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    marginTop: theme.spacing.md,
  },
  labelCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
});
