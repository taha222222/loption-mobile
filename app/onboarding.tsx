import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { theme } from '../src/theme';
import { Button } from '../src/components/ui/Button';
import { useAuthStore } from '../src/stores/authStore';
import { supabase } from '../src/lib/supabase';
import { OnboardingData } from '../src/types/onboarding';

const { width, height } = Dimensions.get('window');

type Gender = 'man' | 'woman';
type Goal = 'lose_fat' | 'gain_muscle' | 'maintain' | 'healthy_lifestyle';
type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
type Program = 'meals_only' | 'coaching' | 'transformation';

const STEPS = ['Welcome', 'Gender', 'Goal', 'Body', 'Activity', 'Program'];

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);
  const [data, setData] = useState<OnboardingData>({
    gender: null,
    goal: null,
    weight: null,
    height: null,
    age: null,
    activityLevel: null,
    program: null,
  });
  const { user } = useAuthStore();

  const updateData = (key: keyof OnboardingData, value: any) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const nextStep = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const getProgramDisplayName = () => {
    switch (data.program) {
      case 'meals_only': return 'Meals Only';
      case 'coaching': return 'Coaching';
      case 'transformation': return 'Transformation';
      default: return 'selected';
    }
  };

  const handleSubscribeOnWeb = () => {
    const planUrls: Record<Program, string> = {
      meals_only: 'https://loption.org/subscription.html?plan=meals',
      coaching: 'https://loption.org/subscription.html?plan=coaching',
      transformation: 'https://loption.org/subscription.html?plan=transformation',
    };
    
    const url = planUrls[data.program as Program] || 'https://loption.org/subscription.html';
    router.push({
      pathname: './app/(webview)',
      params: { url }
    });
  };

  const handleComplete = async () => {
    if (!user) {
      Alert.alert('Error', 'User not found. Please sign in again.');
      router.replace('/(auth)/login');
      return;
    }

    if (!data.gender || !data.goal || !data.weight || !data.height || !data.age || !data.activityLevel || !data.program) {
      Alert.alert('Error', 'Please complete all steps');
      return;
    }

    setLoading(true);
    
    try {
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();
      
      if (existingProfile) {
        await supabase
          .from('user_profiles')
          .update({
            gender: data.gender,
            goal: data.goal,
            weight: data.weight,
            height: data.height,
            age: data.age,
            activity_level: data.activityLevel,
            program: data.program,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('user_profiles')
          .insert({
            user_id: user.id,
            gender: data.gender,
            goal: data.goal,
            weight: data.weight,
            height: data.height,
            age: data.age,
            activity_level: data.activityLevel,
            program: data.program,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
      }
      
      setShowSubscriptionPrompt(true);
      setLoading(false);
      
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to save your profile. Please try again.');
      setLoading(false);
    }
  };

  const isStepValid = () => {
    switch (step) {
      case 0: return true;
      case 1: return data.gender !== null;
      case 2: return data.goal !== null;
      case 3: return data.weight !== null && data.height !== null && data.age !== null;
      case 4: return data.activityLevel !== null;
      case 5: return data.program !== null;
      default: return true;
    }
  };

  // PREMIUM WELCOME SCREEN
  const renderWelcome = () => (
    <View style={styles.welcomeContainer}>
      <LinearGradient colors={['#0A0C10', '#0F1115', '#0F1115']} style={styles.backgroundGradient} />
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={styles.progressSection}>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: '16%' }]} />
        </View>
        <Text style={styles.progressText}>Step 1 of 6</Text>
      </View>

      <View style={styles.heroSection}>
        <Image source={require('../assets/onboarding.png')} style={styles.heroImage} resizeMode="cover" />
        <LinearGradient colors={['transparent', 'transparent', '#0F1115']} style={styles.heroOverlay} />
      </View>

      <View style={styles.sloganContainer}>
        <Text style={styles.slogan}>PROGRESS STARTS HERE</Text>
      </View>

      <View style={styles.featuresContainer}>
        <BlurView intensity={30} tint="dark" style={styles.featureCard}>
          <View style={styles.featureIcon}>
            <Ionicons name="nutrition-outline" size={22} color="#D4A757" />
          </View>
          <Text style={styles.featureTitle}>Smart Nutrition</Text>
        </BlurView>

        <BlurView intensity={30} tint="dark" style={styles.featureCard}>
          <View style={styles.featureIcon}>
            <Ionicons name="fitness-outline" size={22} color="#3B82F6" />
          </View>
          <Text style={styles.featureTitle}>Fitness Sync</Text>
        </BlurView>

        <BlurView intensity={30} tint="dark" style={styles.featureCard}>
          <View style={styles.featureIcon}>
            <Ionicons name="trending-up-outline" size={22} color="#D4A757" />
          </View>
          <Text style={styles.featureTitle}>Discipline</Text>
        </BlurView>
      </View>

      <TouchableOpacity style={styles.continueButton} onPress={nextStep} activeOpacity={0.92}>
        <LinearGradient colors={['#D4A757', '#B8860B', '#D4A757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.buttonGradient}>
          <Text style={styles.buttonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={18} color="#0F1115" style={styles.buttonIcon} />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  const renderGender = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Select your gender</Text>
      <View style={styles.genderContainer}>
        <TouchableOpacity style={[styles.genderOption, data.gender === 'man' && styles.genderSelected]} onPress={() => updateData('gender', 'man')}>
          <Ionicons name="male" size={48} color={data.gender === 'man' ? theme.colors.gold : theme.colors.textLight} />
          <Text style={[styles.genderText, data.gender === 'man' && styles.genderTextSelected]}>Man</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.genderOption, data.gender === 'woman' && styles.genderSelected]} onPress={() => updateData('gender', 'woman')}>
          <Ionicons name="female" size={48} color={data.gender === 'woman' ? theme.colors.gold : theme.colors.textLight} />
          <Text style={[styles.genderText, data.gender === 'woman' && styles.genderTextSelected]}>Woman</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderGoal = () => {
    const goals: { value: Goal; label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
      { value: 'lose_fat', label: 'Lose Fat', icon: 'trending-down', description: 'Shed excess body fat' },
      { value: 'gain_muscle', label: 'Gain Muscle', icon: 'fitness', description: 'Build lean muscle mass' },
      { value: 'maintain', label: 'Maintain', icon: 'happy', description: 'Stay at your current weight' },
      { value: 'healthy_lifestyle', label: 'Healthy Lifestyle', icon: 'leaf', description: 'Improve overall wellness' },
    ];

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>What's your goal?</Text>
        <View style={styles.goalsContainer}>
          {goals.map((goal) => (
            <TouchableOpacity key={goal.value} style={[styles.goalOption, data.goal === goal.value && styles.goalSelected]} onPress={() => updateData('goal', goal.value)}>
              <Ionicons name={goal.icon} size={32} color={data.goal === goal.value ? theme.colors.gold : theme.colors.textLight} />
              <View style={styles.goalTextContainer}>
                <Text style={[styles.goalText, data.goal === goal.value && styles.goalTextSelected]}>{goal.label}</Text>
                <Text style={styles.goalDescription}>{goal.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderBody = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Tell us about your body</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Weight (kg)</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={data.weight?.toString() || ''} onChangeText={(text) => updateData('weight', text ? parseFloat(text) : null)} placeholder="70" placeholderTextColor={theme.colors.textLight} />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Height (cm)</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={data.height?.toString() || ''} onChangeText={(text) => updateData('height', text ? parseFloat(text) : null)} placeholder="170" placeholderTextColor={theme.colors.textLight} />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Age</Text>
        <TextInput style={styles.input} keyboardType="numeric" value={data.age?.toString() || ''} onChangeText={(text) => updateData('age', text ? parseInt(text) : null)} placeholder="30" placeholderTextColor={theme.colors.textLight} />
      </View>
    </View>
  );

  const renderActivity = () => {
    const levels: { value: ActivityLevel; label: string; description: string }[] = [
      { value: 'sedentary', label: 'Sedentary', description: 'Office job, little to no exercise' },
      { value: 'light', label: 'Light', description: 'Exercise 1-3 days/week' },
      { value: 'moderate', label: 'Moderate', description: 'Exercise 3-5 days/week' },
      { value: 'active', label: 'Active', description: 'Daily exercise or active job' },
      { value: 'very_active', label: 'Very Active', description: 'Athlete or training twice daily' },
    ];

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>What's your activity level?</Text>
        <View style={styles.activityContainer}>
          {levels.map((level) => (
            <TouchableOpacity key={level.value} style={[styles.activityOption, data.activityLevel === level.value && styles.activitySelected]} onPress={() => updateData('activityLevel', level.value)}>
              <Text style={[styles.activityLabel, data.activityLevel === level.value && styles.activityLabelSelected]}>{level.label}</Text>
              <Text style={styles.activityDescription}>{level.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderProgram = () => {
    const programs: { value: Program; label: string; description: string; price?: string; features: string[] }[] = [
      { value: 'meals_only', label: 'Meals Only', description: 'Order healthy meals on demand', features: ['Access to full menu', 'Free delivery', 'Basic nutrition tracking'] },
      { value: 'coaching', label: 'Coaching', description: 'Personalized nutrition coaching', price: '499 MAD/mo', features: ['Everything in Meals Only', 'Weekly coaching calls', 'Custom meal plans', 'Priority support'] },
      { value: 'transformation', label: 'Transformation', description: 'Complete program with meal plans & coaching', price: '1,299 MAD/mo', features: ['Everything in Coaching', 'Daily check-ins', 'Before/after analysis', 'Unlimited meal swaps'] },
    ];

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Choose your program</Text>
        <View style={styles.programsContainer}>
          {programs.map((program) => (
            <TouchableOpacity key={program.value} style={[styles.programOption, data.program === program.value && styles.programSelected]} onPress={() => updateData('program', program.value)}>
              <View style={styles.programHeader}>
                <View>
                  <Text style={[styles.programLabel, data.program === program.value && styles.programLabelSelected]}>{program.label}</Text>
                  <Text style={styles.programDescription}>{program.description}</Text>
                </View>
                {program.price && <Text style={styles.programPrice}>{program.price}</Text>}
              </View>
              <View style={styles.featuresList}>
                {program.features.map((feature, idx) => (
                  <View key={idx} style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.gold} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderSubscriptionPrompt = () => (
    <View style={styles.promptContainer}>
      <LinearGradient colors={['#0F1115', '#171A21']} style={styles.promptCard}>
        <View style={styles.promptIcon}>
          <Ionicons name="cart-outline" size={48} color="#D4A757" />
        </View>
        <Text style={styles.promptTitle}>Complete Your Subscription</Text>
        <Text style={styles.promptText}>Your profile has been created. To activate your {getProgramDisplayName()} plan, please complete your subscription on our secure website.</Text>
        <View style={styles.benefitList}>
          <View style={styles.benefitRow}><Ionicons name="checkmark-circle" size={20} color="#10b981" /><Text style={styles.benefitText}>No Apple fees - better value</Text></View>
          <View style={styles.benefitRow}><Ionicons name="checkmark-circle" size={20} color="#10b981" /><Text style={styles.benefitText}>Secure payment via Stripe</Text></View>
          <View style={styles.benefitRow}><Ionicons name="checkmark-circle" size={20} color="#10b981" /><Text style={styles.benefitText}>7-day money-back guarantee</Text></View>
        </View>
        <TouchableOpacity style={styles.subscribeButton} onPress={handleSubscribeOnWeb}>
          <LinearGradient colors={['#D4A757', '#B8860B']} style={styles.subscribeGradient}>
            <Text style={styles.subscribeButtonText}>Continue to Website</Text>
            <Ionicons name="arrow-forward" size={20} color="#0F1115" />
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={() => router.replace('/(app)')}>
          <Text style={styles.skipButtonText}>Maybe later</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );

  const renderStep = () => {
    if (showSubscriptionPrompt) return renderSubscriptionPrompt();
    switch (step) {
      case 0: return renderWelcome();
      case 1: return renderGender();
      case 2: return renderGoal();
      case 3: return renderBody();
      case 4: return renderActivity();
      case 5: return renderProgram();
      default: return renderWelcome();
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D4A757" />
        <Text style={styles.loadingText}>Setting up your profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flexContainer}>
        {step === 0 ? renderWelcome() : (
          <>
            <View style={styles.progressContainer}>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
              </View>
              <Text style={styles.progressText}>Step {step + 1} of {STEPS.length}</Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {renderStep()}
            </ScrollView>
            <View style={styles.navigation}>
              {step > 0 && <Button title="Back" variant="ghost" onPress={prevStep} />}
              <Button title={step === STEPS.length - 1 ? 'Complete' : 'Continue'} variant="gold" onPress={nextStep} disabled={!isStepValid()} />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1115' },
  flexContainer: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F1115' },
  loadingText: { fontSize: theme.typography.sizes.md, color: '#9CA3AF', marginTop: theme.spacing.md },
  
  welcomeContainer: { flex: 1, position: 'relative' },
  backgroundGradient: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  glowTop: { position: 'absolute', top: -150, left: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: '#3B82F6', opacity: 0.06 },
  glowBottom: { position: 'absolute', bottom: -100, right: -80, width: 250, height: 250, borderRadius: 125, backgroundColor: '#D4A757', opacity: 0.04 },
  
  progressSection: { position: 'absolute', top: 60, left: 24, right: 24, zIndex: 10 },
  progressBarTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden', marginBottom: 8 },
  progressBarFill: { height: '100%', backgroundColor: '#D4A757', borderRadius: 1 },
  progressText: { fontSize: 11, fontWeight: '500', color: '#6B7280', letterSpacing: 0.5 },
  
  heroSection: { position: 'absolute', top: 0, left: 0, right: 0, height: height * 0.58, overflow: 'hidden' },
  heroImage: { width: width, height: height * 0.58, position: 'absolute', top: 0, left: 0 },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 100 },
  
  sloganContainer: { position: 'absolute', bottom: 170, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  slogan: { fontSize: 12, fontWeight: '600', color: '#FFFFFF', letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.9 },
  
  featuresContainer: { position: 'absolute', bottom: 100, left: 24, right: 24, flexDirection: 'row', justifyContent: 'center', gap: 20, zIndex: 10 },
  featureCard: { width: 95, backgroundColor: 'rgba(23,26,33,0.7)', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  featureIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  featureTitle: { fontSize: 11, fontWeight: '500', color: '#FFFFFF', textAlign: 'center', letterSpacing: 0.3 },
  
  continueButton: { position: 'absolute', bottom: 30, left: 24, right: 24, borderRadius: 40, overflow: 'hidden', shadowColor: '#D4A757', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6, zIndex: 10 },
  buttonGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 6 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#0F1115', letterSpacing: 0.3 },
  buttonIcon: { marginLeft: 4 },
  
  stepContainer: { padding: theme.spacing.xl },
  stepTitle: { fontSize: theme.typography.sizes['3xl'], fontWeight: theme.typography.weights.bold, color: '#1F2937', marginBottom: theme.spacing['3xl'], textAlign: 'center' },
  progressContainer: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl },
  scrollContent: { flexGrow: 1, paddingBottom: theme.spacing.xl },
  
  genderContainer: { flexDirection: 'row', justifyContent: 'center', gap: theme.spacing['3xl'] },
  genderOption: { alignItems: 'center', padding: theme.spacing.xl, borderRadius: theme.spacing.lg, backgroundColor: '#F3F4F6', minWidth: 120 },
  genderSelected: { backgroundColor: theme.colors.gold + '20', borderWidth: 2, borderColor: theme.colors.gold },
  genderText: { marginTop: theme.spacing.md, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.medium, color: theme.colors.textLight },
  genderTextSelected: { color: theme.colors.gold },
  
  goalsContainer: { gap: theme.spacing.md },
  goalOption: { flexDirection: 'row', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: '#F3F4F6', borderRadius: theme.spacing.lg, gap: theme.spacing.md },
  goalSelected: { backgroundColor: theme.colors.gold + '20', borderWidth: 2, borderColor: theme.colors.gold },
  goalTextContainer: { flex: 1 },
  goalText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.textDark },
  goalTextSelected: { color: theme.colors.gold },
  goalDescription: { fontSize: theme.typography.sizes.xs, color: theme.colors.textLight, marginTop: 2 },
  
  inputGroup: { marginBottom: theme.spacing.xl },
  inputLabel: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.medium, color: theme.colors.textDark, marginBottom: theme.spacing.sm },
  input: { backgroundColor: '#F3F4F6', borderRadius: theme.spacing.lg, padding: theme.spacing.lg, fontSize: theme.typography.sizes.lg, color: theme.colors.textDark },
  
  activityContainer: { gap: theme.spacing.md },
  activityOption: { padding: theme.spacing.lg, backgroundColor: '#F3F4F6', borderRadius: theme.spacing.lg },
  activitySelected: { backgroundColor: theme.colors.gold + '20', borderWidth: 2, borderColor: theme.colors.gold },
  activityLabel: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.textDark },
  activityLabelSelected: { color: theme.colors.gold },
  activityDescription: { fontSize: theme.typography.sizes.sm, color: theme.colors.textLight, marginTop: theme.spacing.xs },
  
  programsContainer: { gap: theme.spacing.md },
  programOption: { padding: theme.spacing.lg, backgroundColor: '#F3F4F6', borderRadius: theme.spacing.lg },
  programSelected: { backgroundColor: theme.colors.gold + '20', borderWidth: 2, borderColor: theme.colors.gold },
  programHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.spacing.md },
  programLabel: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.semibold, color: theme.colors.textDark },
  programLabelSelected: { color: theme.colors.gold },
  programPrice: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.gold },
  programDescription: { fontSize: theme.typography.sizes.sm, color: theme.colors.textLight, marginTop: 2 },
  featuresList: { marginTop: theme.spacing.sm, gap: theme.spacing.xs },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  featureText: { fontSize: theme.typography.sizes.sm, color: theme.colors.textLight },
  
  navigation: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl, gap: theme.spacing.md },
  
  // Subscription Prompt Styles
  promptContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.xl, backgroundColor: '#0F1115' },
  promptCard: { width: '100%', borderRadius: 32, padding: theme.spacing.xl, alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' },
  promptIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(212,167,87,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg },
  promptTitle: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginBottom: theme.spacing.sm, textAlign: 'center' },
  promptText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20, marginBottom: theme.spacing.lg },
  benefitList: { width: '100%', gap: theme.spacing.sm, marginBottom: theme.spacing.xl },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  benefitText: { fontSize: 13, color: '#D1D5DB' },
  subscribeButton: { width: '100%', borderRadius: 40, overflow: 'hidden', marginBottom: theme.spacing.md },
  subscribeGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  subscribeButtonText: { fontSize: 16, fontWeight: '600', color: '#0F1115' },
  skipButton: { paddingVertical: 12 },
  skipButtonText: { fontSize: 14, color: '#6B7280' },
});