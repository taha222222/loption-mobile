import React, { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  // Unit shown inside the field, e.g. "kg".
  suffix?: string;
  secureToggle?: boolean;
}

export type TextFieldHandle = React.ComponentRef<typeof TextInput>;

// Labelled input on a white surface; the error replaces the hint and is
// announced to screen readers.
export const TextField = forwardRef<TextFieldHandle, TextFieldProps>(
  ({ label, error, hint, suffix, secureToggle, secureTextEntry, ...inputProps }, ref) => {
    const [focused, setFocused] = useState(false);
    const [hidden, setHidden] = useState(true);
    const secure = secureToggle ? hidden : secureTextEntry;

    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.field, focused && styles.fieldFocused, !!error && styles.fieldError]}>
          <TextInput
            ref={ref}
            {...inputProps}
            secureTextEntry={secure}
            accessibilityLabel={label}
            placeholderTextColor={theme.colors.inkFaint}
            style={styles.input}
            onFocus={(e) => {
              setFocused(true);
              inputProps.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              inputProps.onBlur?.(e);
            }}
          />
          {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
          {secureToggle ? (
            <TouchableOpacity
              onPress={() => setHidden((h) => !h)}
              accessibilityRole="button"
              accessibilityLabel={hidden ? 'Afficher le mot de passe' : 'Masquer le mot de passe'}
              hitSlop={8}
            >
              <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.colors.inkMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : hint ? (
          <Text style={styles.hint}>{hint}</Text>
        ) : null}
      </View>
    );
  }
);
TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  wrap: {
    gap: theme.spacing.xs,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  field: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
  },
  fieldFocused: {
    borderColor: theme.colors.brand,
  },
  fieldError: {
    borderColor: theme.colors.error,
  },
  input: {
    flex: 1,
    minWidth: 0, // lets the field shrink on narrow screens (web gives inputs an intrinsic width)
    fontSize: theme.typography.sizes.md,
    color: theme.colors.ink,
    paddingVertical: theme.spacing.md,
  },
  suffix: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
  },
  hint: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  error: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.error,
    fontWeight: theme.typography.weights.semibold,
  },
});
