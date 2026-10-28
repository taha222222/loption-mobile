import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BrandMark } from '../v2';
import { theme } from '../../theme';

interface AuthScreenProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

// Keyboard-safe, scrollable page for the sign-in screens (works on small
// phones: content scrolls above the keyboard instead of being covered).
export function AuthScreen({ title, subtitle, showBack, children, footer }: AuthScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {showBack ? (
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={22} color={theme.colors.ink} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.header}>
            <BrandMark size={52} />
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
  },
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing['2xl'],
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    marginBottom: theme.spacing.lg,
  },
  header: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing['2xl'],
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    lineHeight: theme.typography.lineHeights['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.inkMuted,
  },
  body: {
    gap: theme.spacing.lg,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: theme.spacing['2xl'],
    alignItems: 'center',
    gap: theme.spacing.md,
  },
});
