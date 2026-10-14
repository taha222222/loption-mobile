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
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/authStore';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../../src/i18n';

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
  success: '#34C759',
};

export default function SignupScreen() {
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fullNameFocused, setFullNameFocused] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);
  const { signUp } = useAuthStore();
  const { t, i18n } = useTranslation();

  const handleSignup = async () => {
    if (!fullName || !phoneNumber || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (phoneNumber.length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setLoading(true);
    
    // Pass user data including name and phone
    const { error } = await signUp(email, password, 'customer', {
      full_name: fullName,
      phone: phoneNumber,
    });
    
    setLoading(false);

    if (error) {
      Alert.alert('Signup Failed', error.message);
    } else {
      Alert.alert(
        'Verify Your Email',
        `We've sent a verification link to ${email}. Please check your email and verify your account, then sign in.`,
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
    }
  };

  const isPasswordValid = password.length >= 6;
  const doPasswordsMatch = password === confirmPassword && password.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: brandColors.softWhite }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
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

            {/* Back Button */}
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={brandColors.textDark} />
            </TouchableOpacity>

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
              <Text style={styles.brandSlogan}>Start your transformation journey</Text>
            </View>

            {/* Form Section */}
            <View style={styles.formSection}>
              <Text style={styles.welcomeTitle}>Create account</Text>
              <Text style={styles.welcomeSubtitle}>Join the fitness revolution</Text>

              {/* Full Name Input */}
              <View style={styles.inputGroup}>
                <View style={[styles.inputContainer, fullNameFocused && styles.inputContainerFocused]}>
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color={fullNameFocused ? brandColors.primary : brandColors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Full name"
                    placeholderTextColor={brandColors.textLight}
                    value={fullName}
                    onChangeText={setFullName}
                    onFocus={() => setFullNameFocused(true)}
                    onBlur={() => setFullNameFocused(false)}
                  />
                </View>
              </View>

              {/* Phone Number Input */}
              <View style={styles.inputGroup}>
                <View style={[styles.inputContainer, phoneFocused && styles.inputContainerFocused]}>
                  <Ionicons
                    name="call-outline"
                    size={20}
                    color={phoneFocused ? brandColors.primary : brandColors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Phone number"
                    placeholderTextColor={brandColors.textLight}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              {/* Email Input */}
              <View style={styles.inputGroup}>
                <View style={[styles.inputContainer, emailFocused && styles.inputContainerFocused]}>
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
                <View style={[styles.inputContainer, passwordFocused && styles.inputContainerFocused]}>
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

              {/* Confirm Password Input */}
              <View style={styles.inputGroup}>
                <View
                  style={[
                    styles.inputContainer,
                    confirmPasswordFocused && styles.inputContainerFocused,
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={20}
                    color={confirmPasswordFocused ? brandColors.primary : brandColors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm password"
                    placeholderTextColor={brandColors.textLight}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onFocus={() => setConfirmPasswordFocused(true)}
                    onBlur={() => setConfirmPasswordFocused(false)}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off' : 'eye'}
                      size={20}
                      color={brandColors.textLight}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Password Requirements */}
              <View style={styles.requirements}>
                <View style={styles.requirementRow}>
                  <Ionicons
                    name={isPasswordValid ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={isPasswordValid ? brandColors.success : brandColors.textLight}
                  />
                  <Text style={[styles.requirementText, { color: brandColors.textLight }]}>
                    At least 6 characters
                  </Text>
                </View>
                <View style={styles.requirementRow}>
                  <Ionicons
                    name={doPasswordsMatch ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={doPasswordsMatch ? brandColors.success : brandColors.textLight}
                  />
                  <Text style={[styles.requirementText, { color: brandColors.textLight }]}>
                    Passwords match
                  </Text>
                </View>
              </View>

              {/* Sign Up Button - With Glow Effect */}
              <TouchableOpacity
                style={[styles.signUpButton, loading && styles.signUpButtonDisabled]}
                onPress={handleSignup}
                disabled={loading}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[brandColors.primary, brandColors.primaryDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.signUpGradient}
                >
                  <Text style={styles.signUpButtonText}>
                    {loading ? 'Creating account...' : 'Create account'}
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

              {/* Sign In Link */}
              <View style={styles.footer}>
                <Text style={styles.footerText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
                  <Text style={styles.signinLink}>Sign in</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 32,
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
    width: 80,
    height: 80,
    borderRadius: 20,
  },
  brandTitle: {
    fontSize: 28,
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
  formSection: {
    flex: 1,
    paddingBottom: 32,
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
    marginBottom: 24,
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
  requirements: {
    marginTop: 8,
    marginBottom: 28,
    gap: 8,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requirementText: {
    fontSize: 13,
    fontWeight: '500',
  },
  signUpButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: brandColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  signUpButtonDisabled: {
    opacity: 0.6,
  },
  signUpGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  signUpButtonText: {
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
  signinLink: {
    fontSize: 14,
    fontWeight: '600',
    color: brandColors.primary,
  },
});