import React, { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { AuthScreen } from '../../src/components/auth/AuthScreen';
import { SocialSignIn } from '../../src/components/auth/SocialSignIn';
import { BrandButton, TextField, TextFieldHandle } from '../../src/components/v2';
import { describeOutcome, signInWithEmail } from '../../src/services/authFlows';
import { theme } from '../../src/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextFieldHandle>(null);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    const outcome = await signInWithEmail(email, password);
    setLoading(false);

    switch (outcome.kind) {
      case 'signed_in':
        // The root layout routes to the correct home for the resolved role.
        router.replace('/');
        return;
      case 'verification_required':
        router.push({ pathname: '/(auth)/verify-email', params: { email: outcome.email } });
        return;
      case 'invalid_input':
      case 'error':
        setError(describeOutcome(outcome)?.message ?? null);
        return;
      default: {
        const text = describeOutcome(outcome);
        if (text) Alert.alert(text.title, text.message);
      }
    }
  };

  return (
    <AuthScreen
      title="Bon retour"
      subtitle="Connectez-vous pour commander vos repas."
      showBack
      footer={
        <TouchableOpacity onPress={() => router.replace('/(auth)/signup')} accessibilityRole="button">
          <Text style={styles.footerText}>
            Pas encore de compte ? <Text style={styles.footerLink}>Créer un compte</Text>
          </Text>
        </TouchableOpacity>
      }
    >
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        placeholder="vous@exemple.ma"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        placeholder="Votre mot de passe"
        secureToggle
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleLogin}
        error={error}
      />
      <BrandButton title="Se connecter" onPress={handleLogin} loading={loading} />
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>ou</Text>
        <View style={styles.line} />
      </View>
      <SocialSignIn />
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
  footerText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.inkMuted,
  },
  footerLink: {
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.bold,
  },
});
