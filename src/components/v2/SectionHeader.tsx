import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../../theme';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  // false inside an already padded container (no side padding / bottom margin).
  inset?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, actionLabel, onAction, inset = true }) => (
  <View style={[styles.row, !inset && styles.flush]}>
    {/* flex + single line so long titles truncate instead of clipping */}
    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
    {actionLabel && onAction ? (
      <TouchableOpacity onPress={onAction} hitSlop={8}>
        <Text style={styles.action}>{actionLabel}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  flush: {
    paddingHorizontal: 0,
    marginBottom: 0,
  },
  title: {
    flex: 1,
    fontSize: theme.typography.sizes.xl,
    lineHeight: theme.typography.lineHeights.lg,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.3,
  },
  action: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brand,
  },
});
