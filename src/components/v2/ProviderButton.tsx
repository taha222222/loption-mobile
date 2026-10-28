import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface ProviderButtonProps {
  provider: 'google' | 'apple' | 'email';
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  // Shown under the label when the provider is not configured yet.
  note?: string;
}

const content = {
  google: { label: 'Continuer avec Google', icon: 'logo-google' as const },
  apple: { label: 'Continuer avec Apple', icon: 'logo-apple' as const },
  email: { label: 'S’inscrire avec un e-mail', icon: 'mail-outline' as const },
};

// Full-width sign-in option. Apple uses the black style from Apple's
// Human Interface Guidelines; the others use the V2 surface style.
export const ProviderButton: React.FC<ProviderButtonProps> = ({ provider, onPress, loading, disabled, note }) => {
  const dark = provider === 'apple';
  const fg = dark ? theme.colors.textWhite : theme.colors.ink;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={note ? `${content[provider].label}. ${note}` : content[provider].label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[styles.base, dark ? styles.dark : styles.light, (disabled || note) && styles.muted]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          <Ionicons name={content[provider].icon} size={20} color={fg} />
          <View style={styles.text}>
            <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
              {content[provider].label}
            </Text>
            {note ? (
              <Text style={[styles.note, { color: dark ? theme.colors.brandOnDark : theme.colors.inkMuted }]} numberOfLines={1}>
                {note}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: theme.radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.sm,
  },
  light: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  dark: {
    backgroundColor: '#000000',
  },
  muted: {
    opacity: 0.6,
  },
  text: {
    alignItems: 'center',
  },
  label: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
  },
  note: {
    fontSize: theme.typography.sizes.xs,
    marginTop: 1,
  },
});
