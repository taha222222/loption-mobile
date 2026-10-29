import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { BrandButton, FormMessage, OptionCard, Screen, ScreenHeader, SectionHeader, TextField, formatNumber } from '../../src/components/v2';
import {
  ActivityLevel,
  estimateEnergy,
  LIMITS,
  parseNumberInput,
  SexInput,
  validateAge,
  validateHeight,
  validateWeight,
} from '../../src/nutrition/energy';
import { useAuthStore } from '../../src/stores/authStore';
import { useNutritionStore } from '../../src/stores/nutritionStore';
import { useUserStore } from '../../src/stores/userStore';

const SEX: { value: SexInput; title: string }[] = [
  { value: 'woman', title: 'Femme' },
  { value: 'man', title: 'Homme' },
  { value: 'unspecified', title: 'Je préfère ne pas répondre' },
];
const ACTIVITY: { value: ActivityLevel; title: string }[] = [
  { value: 'sedentary', title: 'Sédentaire' },
  { value: 'light', title: 'Légèrement actif' },
  { value: 'moderate', title: 'Modérément actif' },
  { value: 'active', title: 'Très actif' },
  { value: 'very_active', title: 'Extrêmement actif' },
];

const rangeMsg = (err: string | null, unit: string, r: { min: number; max: number }) =>
  err === null ? null : err === 'required' ? 'Ce champ est obligatoire.' : `Entre ${r.min} et ${r.max} ${unit}.`;

// Update the answers behind the estimate. The server recalculates BMR/TDEE
// and today's target; earlier days keep the target that applied to them.
export default function NutritionProfileScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useUserStore((s) => s.profile);
  const saveAnswers = useUserStore((s) => s.saveOnboardingAnswers);
  const refreshTracking = useNutritionStore((s) => s.refresh);
  const [sex, setSex] = useState<SexInput | null>(profile?.gender ?? null);
  const [age, setAge] = useState(profile?.age ? String(profile.age) : '');
  const [weight, setWeight] = useState(profile?.weight ? String(profile.weight) : '');
  const [height, setHeight] = useState(profile?.height ? String(profile.height) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(profile?.activity_level ?? null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string; tone: 'error' | 'info' } | null>(null);

  const a = parseNumberInput(age);
  const w = parseNumberInput(weight);
  const h = parseNumberInput(height);
  const errors = {
    age: rangeMsg(validateAge(a), 'ans', LIMITS.age),
    weight: rangeMsg(validateWeight(w), 'kg', LIMITS.weightKg),
    height: rangeMsg(validateHeight(h), 'cm', LIMITS.heightCm),
  };
  const preview = estimateEnergy({ sex, age: a, weightKg: w, heightCm: h, activity });
  const invalid = !sex || !activity || errors.age || errors.weight || errors.height;

  const save = async () => {
    if (invalid || !userId) return;
    setSaving(true);
    setMessage(null);
    const result = await saveAnswers(userId, { gender: sex!, age: a!, weight: w!, height: h!, activity_level: activity! });
    setSaving(false);
    if (!result.ok) {
      setMessage({ title: 'Non enregistré', text: result.message, tone: 'error' });
      return;
    }
    await refreshTracking();
    setMessage({ title: 'Profil mis à jour', text: 'Votre estimation et l’objectif d’aujourd’hui ont été recalculés.', tone: 'info' });
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll>
        <ScreenHeader
          title="Mon profil nutritionnel"
          right={
            <TouchableOpacity onPress={() => router.back()} style={styles.close} accessibilityRole="button" accessibilityLabel="Fermer">
              <Ionicons name="close" size={22} color={theme.colors.ink} />
            </TouchableOpacity>
          }
        />
        <View style={styles.section}>
          <SectionHeader inset={false} title="Sexe utilisé par la formule" />
          {SEX.map((o) => (
            <OptionCard key={o.value} title={o.title} selected={sex === o.value} onPress={() => setSex(o.value)} />
          ))}
        </View>
        <View style={styles.section}>
          <TextField label="Âge" value={age} onChangeText={setAge} keyboardType="number-pad" suffix="ans" maxLength={3} error={age ? errors.age : null} />
          <TextField label="Poids" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" suffix="kg" maxLength={5} error={weight ? errors.weight : null} />
          <TextField label="Taille" value={height} onChangeText={setHeight} keyboardType="decimal-pad" suffix="cm" maxLength={5} error={height ? errors.height : null} />
        </View>
        <View style={styles.section}>
          <SectionHeader inset={false} title="Niveau d’activité" />
          {ACTIVITY.map((o) => (
            <OptionCard key={o.value} title={o.title} selected={activity === o.value} onPress={() => setActivity(o.value)} />
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.preview}>
            {preview?.tdeeKcal
              ? `Aperçu : BMR ${formatNumber(preview.bmrKcal)} kcal · TDEE ${formatNumber(preview.tdeeKcal)} kcal (calcul définitif fait par le serveur).`
              : sex === 'unspecified'
                ? 'Sans le sexe utilisé par la formule, aucune estimation n’est calculée.'
                : 'Complétez tous les champs pour voir l’estimation.'}
          </Text>
          {message ? <FormMessage title={message.title} message={message.text} tone={message.tone} /> : null}
          <BrandButton title="Enregistrer" onPress={save} loading={saving} disabled={!!invalid} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  preview: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
});
