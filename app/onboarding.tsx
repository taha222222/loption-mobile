import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../src/theme';
import { BrandButton, OptionCard, StepProgress, SurfaceCard, TextField, formatNumber } from '../src/components/v2';
import { RouteGate } from '../src/components/navigation/RouteGate';
import { useAuthStore } from '../src/stores/authStore';
import { useUserStore } from '../src/stores/userStore';
import {
  ActivityLevel,
  estimateEnergy,
  FieldError,
  LIMITS,
  parseNumberInput,
  SexInput,
  validateAge,
  validateHeight,
  validateWeight,
} from '../src/nutrition/energy';

export default function OnboardingRoute() {
  return (
    <RouteGate group="onboarding">
      <OnboardingScreen />
    </RouteGate>
  );
}

type StepKey = 'sex' | 'age' | 'weight' | 'height' | 'activity';
const STEPS: StepKey[] = ['sex', 'age', 'weight', 'height', 'activity'];

const SEX_OPTIONS: { value: SexInput; title: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'woman', title: 'Femme', icon: 'female' },
  { value: 'man', title: 'Homme', icon: 'male' },
  { value: 'unspecified', title: 'Je préfère ne pas répondre', icon: 'remove-circle-outline' },
];

const ACTIVITY_OPTIONS: { value: ActivityLevel; title: string; description: string }[] = [
  { value: 'sedentary', title: 'Sédentaire', description: 'Peu ou pas d’exercice régulier.' },
  { value: 'light', title: 'Légèrement actif', description: 'Exercice ou activité légère quelques jours par semaine.' },
  { value: 'moderate', title: 'Modérément actif', description: 'Exercice modéré plusieurs jours par semaine.' },
  { value: 'active', title: 'Très actif', description: 'Exercice intense ou quotidien physiquement actif.' },
  { value: 'very_active', title: 'Extrêmement actif', description: 'Entraînement très intense ou activité très exigeante physiquement.' },
];

function numberError(error: FieldError | null, unit: string, range: { min: number; max: number }): string | null {
  switch (error) {
    case null:
      return null;
    case 'required':
      return 'Ce champ est obligatoire.';
    case 'not_a_number':
      return 'Saisissez un nombre (par exemple 72 ou 72,5).';
    case 'not_an_integer':
      return 'Saisissez un nombre entier.';
    default:
      return `Saisissez une valeur entre ${range.min} et ${range.max} ${unit}.`;
  }
}

function OnboardingScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const profile = useUserStore((s) => s.profile);
  const saveOnboardingAnswers = useUserStore((s) => s.saveOnboardingAnswers);
  const completeOnboarding = useUserStore((s) => s.completeOnboarding);

  // Answers are kept here for the whole flow, so Back/Continue never lose
  // them; earlier saved answers (an interrupted onboarding) are pre-filled.
  const [step, setStep] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [sex, setSex] = useState<SexInput | null>(profile?.gender ?? null);
  const [ageText, setAgeText] = useState(profile?.age ? String(profile.age) : '');
  const [weightText, setWeightText] = useState(profile?.weight ? String(profile.weight) : '');
  const [heightText, setHeightText] = useState(profile?.height ? String(profile.height) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(profile?.activity_level ?? null);
  const [touched, setTouched] = useState<Partial<Record<StepKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const age = parseNumberInput(ageText);
  const weight = parseNumberInput(weightText);
  const height = parseNumberInput(heightText);

  const errors: Record<StepKey, string | null> = {
    sex: sex ? null : 'Choisissez une option pour continuer.',
    age: numberError(validateAge(age), 'ans', LIMITS.age),
    weight: numberError(validateWeight(weight), 'kg', LIMITS.weightKg),
    height: numberError(validateHeight(height), 'cm', LIMITS.heightCm),
    activity: activity ? null : 'Choisissez votre niveau d’activité.',
  };

  const preview = useMemo(
    () => estimateEnergy({ sex, age, weightKg: weight, heightCm: height, activity }),
    [sex, age, weight, height, activity]
  );

  const key = STEPS[step];
  const visibleError = touched[key] ? errors[key] : null;

  const goBack = () => {
    setSaveError(null);
    if (showResult) setShowResult(false);
    else if (step > 0) setStep(step - 1);
  };

  const goNext = async () => {
    setTouched((t) => ({ ...t, [key]: true }));
    if (errors[key]) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveOnboardingAnswers(user.id, {
      gender: sex!,
      age: age!,
      weight: weight!,
      height: height!,
      activity_level: activity!,
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setShowResult(true);
  };

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    const result = await completeOnboarding(user.id);
    setSaving(false);
    // On success the routing policy moves on to the permission screens.
    if (!result.ok) setSaveError(result.message);
  };

  // Server-computed values when the profile has them; same formula otherwise.
  const bmr = typeof profile?.bmr_kcal === 'number' ? profile.bmr_kcal : (preview?.bmrKcal ?? null);
  const tdee = typeof profile?.tdee_kcal === 'number' ? profile.tdee_kcal : (preview?.tdeeKcal ?? null);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          {step > 0 || showResult ? (
            <TouchableOpacity
              onPress={goBack}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Étape précédente"
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={22} color={theme.colors.ink} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => signOut()} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.signOut}>Se déconnecter</Text>
            </TouchableOpacity>
          )}
          <View style={styles.progress}>
            <StepProgress step={showResult ? STEPS.length : step + 1} total={STEPS.length} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {showResult ? (
            <ResultStep sex={sex} bmr={bmr} tdee={tdee} />
          ) : (
            <>
              {key === 'sex' && (
                <Step
                  title="Votre profil nutritionnel"
                  intro="Quelques questions pour estimer vos besoins énergétiques. Quel sexe utiliser pour le calcul ?"
                  note="Les formules d’estimation de l’énergie au repos utilisent des valeurs différentes selon le sexe. Si vous préférez ne pas répondre, nous ne calculerons pas d’estimation."
                >
                  <View style={styles.options} accessibilityRole="radiogroup">
                    {SEX_OPTIONS.map((o) => (
                      <OptionCard
                        key={o.value}
                        title={o.title}
                        icon={o.icon}
                        selected={sex === o.value}
                        onPress={() => setSex(o.value)}
                      />
                    ))}
                  </View>
                </Step>
              )}
              {key === 'age' && (
                <Step title="Quel âge avez-vous ?" intro="Votre âge en années.">
                  <TextField
                    label="Âge"
                    value={ageText}
                    onChangeText={setAgeText}
                    keyboardType="number-pad"
                    placeholder="30"
                    suffix="ans"
                    maxLength={3}
                    returnKeyType="next"
                    onSubmitEditing={goNext}
                    onBlur={() => setTouched((t) => ({ ...t, age: true }))}
                    error={visibleError}
                  />
                </Step>
              )}
              {key === 'weight' && (
                <Step title="Quel est votre poids ?" intro="En kilogrammes.">
                  <TextField
                    label="Poids"
                    value={weightText}
                    onChangeText={setWeightText}
                    keyboardType="decimal-pad"
                    placeholder="70"
                    suffix="kg"
                    maxLength={5}
                    returnKeyType="next"
                    onSubmitEditing={goNext}
                    onBlur={() => setTouched((t) => ({ ...t, weight: true }))}
                    error={visibleError}
                  />
                </Step>
              )}
              {key === 'height' && (
                <Step title="Quelle est votre taille ?" intro="En centimètres.">
                  <TextField
                    label="Taille"
                    value={heightText}
                    onChangeText={setHeightText}
                    keyboardType="decimal-pad"
                    placeholder="170"
                    suffix="cm"
                    maxLength={5}
                    returnKeyType="next"
                    onSubmitEditing={goNext}
                    onBlur={() => setTouched((t) => ({ ...t, height: true }))}
                    error={visibleError}
                  />
                </Step>
              )}
              {key === 'activity' && (
                <Step title="Votre niveau d’activité" intro="Choisissez ce qui décrit le mieux une semaine habituelle.">
                  <View style={styles.options} accessibilityRole="radiogroup">
                    {ACTIVITY_OPTIONS.map((o) => (
                      <OptionCard
                        key={o.value}
                        title={o.title}
                        description={o.description}
                        selected={activity === o.value}
                        onPress={() => setActivity(o.value)}
                      />
                    ))}
                  </View>
                </Step>
              )}
              {(key === 'sex' || key === 'activity') && visibleError ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {visibleError}
                </Text>
              ) : null}
            </>
          )}

          {saveError ? (
            <SurfaceCard style={styles.errorCard}>
              <Ionicons name="alert-circle" size={20} color={theme.colors.error} />
              <Text style={styles.errorCardText} accessibilityRole="alert">
                {saveError}
              </Text>
            </SurfaceCard>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          {showResult ? (
            <BrandButton title={saveError ? 'Réessayer' : 'Continuer'} onPress={finish} loading={saving} />
          ) : (
            <BrandButton
              title={step === STEPS.length - 1 ? (saveError ? 'Réessayer' : 'Calculer mon estimation') : 'Continuer'}
              onPress={goNext}
              loading={saving}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Step({ title, intro, note, children }: { title: string; intro: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.intro}>{intro}</Text>
      {children}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function ResultStep({ sex, bmr, tdee }: { sex: SexInput | null; bmr: number | null; tdee: number | null }) {
  if (sex === 'unspecified' || bmr === null) {
    return (
      <Step title="Profil enregistré" intro="Sans le sexe utilisé par la formule, nous ne calculons pas d’estimation énergétique.">
        <SurfaceCard>
          <Text style={styles.note}>Vous pourrez compléter cette information plus tard depuis votre profil.</Text>
        </SurfaceCard>
      </Step>
    );
  }
  return (
    <Step title="Votre estimation" intro="Calculée à partir de vos réponses.">
      <SurfaceCard style={styles.resultCard}>
        <Text style={styles.resultLabel}>Métabolisme de base (au repos)</Text>
        <Text style={styles.resultValue}>{`${formatNumber(bmr)} kcal / jour`}</Text>
        <Text style={styles.note}>L’énergie que votre corps utilise au repos.</Text>
      </SurfaceCard>
      {tdee !== null ? (
        <SurfaceCard style={styles.resultCard}>
          <Text style={styles.resultLabel}>Dépense quotidienne estimée</Text>
          <Text style={styles.resultValue}>{`${formatNumber(tdee)} kcal / jour`}</Text>
          <Text style={styles.note}>Votre métabolisme de base ajusté à votre niveau d’activité.</Text>
        </SurfaceCard>
      ) : null}
      <Text style={styles.disclaimer}>
        Estimation calculée avec la formule de Mifflin–St Jeor. Ce n’est pas un avis médical : consultez un professionnel
        de santé pour des recommandations personnalisées.
      </Text>
    </Step>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
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
  },
  signOut: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.inkMuted,
    fontWeight: theme.typography.weights.semibold,
  },
  progress: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing['2xl'],
    gap: theme.spacing.lg,
  },
  step: {
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    lineHeight: theme.typography.lineHeights['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.5,
  },
  intro: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.inkMuted,
  },
  note: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  options: {
    gap: theme.spacing.md,
  },
  error: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.error,
    fontWeight: theme.typography.weights.semibold,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderColor: theme.colors.error,
  },
  errorCardText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.ink,
  },
  resultCard: {
    gap: theme.spacing.xs,
  },
  resultLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
  },
  resultValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.brand,
  },
  disclaimer: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  actions: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    backgroundColor: theme.colors.canvas,
  },
});
