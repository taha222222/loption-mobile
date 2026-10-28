import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface FormMessageProps {
  title: string;
  message: string;
  tone?: 'error' | 'info';
  actionLabel?: string;
  onAction?: () => void;
}

// Inline outcome message for forms. Used instead of a system alert so the
// message is visible on every platform (React Native Web has no Alert) and
// stays on screen while the user corrects the form.
export const FormMessage: React.FC<FormMessageProps> = ({ title, message, tone = 'error', actionLabel, onAction }) => (
  <View
    style={[styles.box, tone === 'error' ? styles.error : styles.info]}
    accessibilityRole="alert"
    accessibilityLiveRegion="polite"
  >
    <Ionicons
      name={tone === 'error' ? 'alert-circle' : 'information-circle'}
      size={20}
      color={tone === 'error' ? theme.colors.error : theme.colors.brand}
    />
    <View style={styles.text}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
  },
  error: {
    backgroundColor: '#FDF2F2',
    borderColor: '#F7C9C9',
  },
  info: {
    backgroundColor: theme.colors.brandSoft,
    borderColor: theme.colors.hairline,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  message: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.ink,
  },
  action: {
    marginTop: theme.spacing.xs,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brand,
  },
});
