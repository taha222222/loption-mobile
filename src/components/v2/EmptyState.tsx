import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { BrandButton } from './BrandButton';

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, message, actionLabel, onAction }) => (
  <View style={styles.wrap}>
    <View style={styles.iconDisc}>
      <Ionicons name={icon} size={36} color={theme.colors.brand} />
    </View>
    <Text style={styles.title}>{title}</Text>
    {message ? <Text style={styles.message}>{message}</Text> : null}
    {actionLabel && onAction ? (
      <BrandButton title={actionLabel} onPress={onAction} style={styles.action} />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing['2xl'],
  },
  iconDisc: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    marginTop: theme.spacing.xl,
    textAlign: 'center',
  },
  message: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.inkMuted,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
  action: {
    marginTop: theme.spacing.xl,
    alignSelf: 'stretch',
  },
});
