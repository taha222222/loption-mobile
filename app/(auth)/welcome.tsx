import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AuthScreen } from '../../src/components/auth/AuthScreen';
import { SocialSignIn } from '../../src/components/auth/SocialSignIn';
import { ProviderButton } from '../../src/components/v2';
import { changeLanguage } from '../../src/i18n';
import { theme } from '../../src/theme';

// Entry point for signed-out users: Apple, Google or e-mail sign-up, and a
// clear path for existing customers to log in.
export default function WelcomeScreen() {
  const { i18n } = useTranslation();

  return (
    <AuthScreen
      title="Bienvenue chez L’OPTION"
      subtitle="Des repas sains préparés dans nos cuisines et livrés chez vous. Créez votre compte pour commencer."
      footer={
        <>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/login')}
            accessibilityRole="button"
            style={styles.loginRow}
          >
            <Text style={styles.loginText}>
              Déjà un compte ? <Text style={styles.loginLink}>Se connecter</Text>
            </Text>
          </TouchableOpacity>
          <View style={styles.languages} accessibilityRole="radiogroup" accessibilityLabel="Langue">
            {(['fr', 'en'] as const).map((lang) => (
              <TouchableOpacity
                key={lang}
                onPress={() => changeLanguage(lang)}
                accessibilityRole="radio"
                accessibilityState={{ selected: i18n.language === lang }}
                style={[styles.lang, i18n.language === lang && styles.langActive]}
              >
                <Text style={[styles.langText, i18n.language === lang && styles.langTextActive]}>
                  {lang.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      }
    >
      <SocialSignIn />
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>ou</Text>
        <View style={styles.line} />
      </View>
      <ProviderButton provider="email" onPress={() => router.push('/(auth)/signup')} />
      <Text style={styles.legal}>
        En continuant, vous acceptez les conditions d’utilisation et la politique de confidentialité de L’OPTION.
      </Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.hairline,
  },
  or: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
  },
  legal: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
    textAlign: 'center',
  },
  loginRow: {
    paddingVertical: theme.spacing.sm,
  },
  loginText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.inkMuted,
  },
  loginLink: {
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.bold,
  },
  languages: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    padding: 4,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  lang: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
  },
  langActive: {
    backgroundColor: theme.colors.brand,
  },
  langText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.inkMuted,
  },
  langTextActive: {
    color: theme.colors.textWhite,
  },
});
