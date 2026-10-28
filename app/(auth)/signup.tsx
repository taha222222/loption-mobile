import React, { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { AuthScreen } from '../../src/components/auth/AuthScreen';
import { BrandButton, TextField, TextFieldHandle } from '../../src/components/v2';
import {
  describeOutcome,
  PASSWORD_MIN_LENGTH,
  signUpWithEmail,
  validateEmail,
  validatePassword,
} from '../../src/services/authFlows';
import { theme } from '../../src/theme';

type Errors = { email?: string | null; password?: string | null; confirm?: string | null };

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextFieldHandle>(null);
  const confirmRef = useRef<TextFieldHandle>(null);

  const handleSignup = async () => {
    const next: Errors = {
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: password === confirm ? null : 'Les mots de passe ne correspondent pas.',
    };
    setErrors(next);
    if (next.email || next.password || next.confirm) return;

    setLoading(true);
    const outcome = await signUpWithEmail(email, password);
    setLoading(false);

    switch (outcome.kind) {
      case 'verification_sent':
        router.replace({ pathname: '/(auth)/verify-email', params: { email: outcome.email, sent: '1' } });
        return;
      case 'signed_in':
        router.replace('/');
        return;
      case 'account_exists':
        Alert.alert(
          'Compte existant',
          'Un compte existe peut-être déjà avec cette adresse. Connectez-vous ou utilisez la méthode choisie lors de votre inscription.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Se connecter', onPress: () => router.replace('/(auth)/login') },
          ]
        );
        return;
      case 'invalid_input':
        setErrors(/e-mail/i.test(outcome.message) ? { email: outcome.message } : { password: outcome.message });
        return;
      default: {
        const text = describeOutcome(outcome);
        if (text) Alert.alert(text.title, text.message);
      }
    }
  };

  return (
    <AuthScreen
      title="Créer un compte"
      subtitle="Nous vous enverrons un lien pour confirmer votre adresse e-mail."
      showBack
      footer={
        <TouchableOpacity onPress={() => router.replace('/(auth)/login')} accessibilityRole="button">
          <Text style={styles.footerText}>
            Déjà un compte ? <Text style={styles.footerLink}>Se connecter</Text>
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
        error={errors.email}
      />
      <TextField
        ref={passwordRef}
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        placeholder={`${PASSWORD_MIN_LENGTH} caractères minimum`}
        secureToggle
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        hint="Au moins 8 caractères, dont une lettre et un chiffre."
        error={errors.password}
      />
      <TextField
        ref={confirmRef}
        label="Confirmer le mot de passe"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Saisissez-le à nouveau"
        secureToggle
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={handleSignup}
        error={errors.confirm}
      />
      <BrandButton title="Créer mon compte" onPress={handleSignup} loading={loading} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  footerText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.inkMuted,
  },
  footerLink: {
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.bold,
  },
});
