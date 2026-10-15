import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../src/stores/authStore';
import { changeLanguage } from '../../src/i18n';
import { notificationService } from '../../src/services/notificationService';

const { width, height } = Dimensions.get('window');

// Premium brand colors
const brandColors = {
  primary: '#5A52EA',
  primaryDark: '#4A43C4',
  primaryLight: '#7B75F0',
  electric: '#7883DD',
  lavender: '#9A9FE4',
  deepAccent: '#585CAC',
  softWhite: '#FBFBFD',
  textDark: '#1A1A2E',
  textLight: '#6B6B8A',
};

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const { signIn } = useAuthStore();
  const { t, i18n } = useTranslation();

  useFocusEffect(
    React.useCallback(() => {
      const { session } = useAuthStore.getState();
      if (session) {
        router.replace('/(app)');
      }
    }, [])
  );

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      Alert.alert('Login Failed', error.message);
    } else {
      const { user, role } = useAuthStore.getState();
      if (user && role) {
        const token = await notificationService.registerForPushNotificationsAsync();
        if (token) {
          await notificationService.savePushToken(user.id, token, role);
        }
      }
      // The root layout routes to the correct home for the resolved role.
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: brandColors.softWhite }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          {/* Language Switcher - Compact Capsule */}
          <View style={styles.languageCapsule}>
            <TouchableOpacity
              style={[styles.langOption, i18n.language === 'en' && styles.langOptionActive]}
              onPress={() => changeLanguage('en')}
            >
              <Text style={[styles.langText, i18n.language === 'en' && styles.langTextActive]}>EN</Text>
            </TouchableOpacity>
            <View style={styles.langDivider} />
            <TouchableOpacity
              style={[styles.langOption, i18n.language === 'fr' && styles.langOptionActive]}
              onPress={() => changeLanguage('fr')}
            >
              <Text style={[styles.langText, i18n.language === 'fr' && styles.langTextActive]}>FR</Text>
            </TouchableOpacity>
          </View>

          {/* Brand Section - Unified Block */}
          <View style={styles.brandSection}>
            <View style={styles.logoContainer}>
              <Image 
                source={require('../../assets/icon.png')} 
                style={styles.logoIcon}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brandTitle}>L'OPTION</Text>
            <Text style={styles.brandSlogan}>Transform your body. Elevate your life.</Text>
          </View>

          {/* Form Section */}
          <View style={styles.formSection}>
            <Text style={styles.welcomeTitle}>Welcome back</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to continue your journey</Text>

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <View style={[
                styles.inputContainer,
                emailFocused && styles.inputContainerFocused,
              ]}>
                <Ionicons 
                  name="mail-outline" 
                  size={20} 
                  color={emailFocused ? brandColors.primary : brandColors.textLight} 
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email address"
                  placeholderTextColor={brandColors.textLight}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            </View>

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <View style={[
                styles.inputContainer,
                passwordFocused && styles.inputContainerFocused,
              ]}>
                <Ionicons 
                  name="lock-closed-outline" 
                  size={20} 
                  color={passwordFocused ? brandColors.primary : brandColors.textLight} 
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={brandColors.textLight}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color={brandColors.textLight}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Forgot Password */}
            <TouchableOpacity style={styles.forgotPassword}>
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </TouchableOpacity>

            {/* Sign In Button - With Glow Effect */}
            <TouchableOpacity
              style={[styles.signInButton, loading && styles.signInButtonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[brandColors.primary, brandColors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.signInGradient}
              >
                <Text style={styles.signInButtonText}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </Text>
                {!loading && <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />}
              </LinearGradient>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Sign Up Link */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>New to L'OPTION? </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
                <Text style={styles.signupLink}>Create account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  // Language Switcher - Compact Capsule
  languageCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 30,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignSelf: 'flex-end',
    marginTop: Platform.OS === 'ios' ? 16 : 12,
  },
  langOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 26,
  },
  langOptionActive: {
    backgroundColor: brandColors.primary,
    shadowColor: brandColors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  langText: {
    fontSize: 13,
    fontWeight: '600',
    color: brandColors.textLight,
  },
  langTextActive: {
    color: '#FFFFFF',
  },
  langDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E5E5EA',
  },
  // Brand Section - Unified Block
  brandSection: {
    alignItems: 'center',
    marginTop: Platform.OS === 'ios' ? 40 : 20,
    marginBottom: 48,
  },
  logoContainer: {
    marginBottom: 16,
    shadowColor: brandColors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  logoIcon: {
    width: 88,
    height: 88,
    borderRadius: 22,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'SF Pro Display' : 'System',
    letterSpacing: -0.5,
    color: brandColors.primaryDark,
    marginBottom: 8,
  },
  brandSlogan: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
    color: brandColors.textLight,
  },
  // Form Section
  formSection: {
    flex: 1,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: brandColors.textDark,
    marginBottom: 4,
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: brandColors.textLight,
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 1,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  inputContainerFocused: {
    borderColor: brandColors.primary,
    backgroundColor: '#FFFFFF',
    shadowColor: brandColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: brandColors.textDark,
    fontFamily: Platform.OS === 'ios' ? 'SF Pro Text' : 'System',
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 28,
    marginTop: 4,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
    color: brandColors.primary,
  },
  signInButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: brandColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  signInButtonDisabled: {
    opacity: 0.6,
  },
  signInGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  signInButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  dividerText: {
    paddingHorizontal: 16,
    fontSize: 13,
    color: brandColors.textLight,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: brandColors.textLight,
  },
  signupLink: {
    fontSize: 14,
    fontWeight: '600',
    color: brandColors.primary,
  },
});