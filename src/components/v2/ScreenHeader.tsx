import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, subtitle, right }) => (
  <View style={styles.header}>
    <View style={styles.text}>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
    {right}
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  text: {
    flex: 1,
  },
  subtitle: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    lineHeight: theme.typography.lineHeights['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.5,
  },
});
