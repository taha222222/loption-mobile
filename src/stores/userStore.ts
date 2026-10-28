import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { ActivityLevel, estimateEnergy, SexInput } from '../nutrition/energy';

export type FirstOrderOfferStatus = 'eligible' | 'applied' | 'not_eligible' | 'unavailable';

export interface UserProfile {
  id: string;
  user_id: string;
  full_name?: string | null;
  phone?: string | null;
  gender: SexInput | null;
  goal: 'lose_fat' | 'gain_muscle' | 'maintain' | 'healthy_lifestyle' | null;
  height: number | null;
  weight: number | null;
  age: number | null;
  activity_level: ActivityLevel | null;
  program: 'meals_only' | 'coaching' | 'transformation' | null;
  // Present once the V1 onboarding migration is applied; all server-managed
  // except onboarding_completed_at (server-stamped) and the address fields.
  bmr_kcal?: number | null;
  tdee_kcal?: number | null;
  nutrition_formula?: string | null;
  onboarding_completed_at?: string | null;
  delivery_address?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  first_order_offer_status?: FirstOrderOfferStatus | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingAnswers {
  gender: SexInput;
  age: number;
  weight: number;
  height: number;
  activity_level: ActivityLevel;
}

export type ProfileStatus = 'unloaded' | 'loading' | 'loaded' | 'error';

export type SaveResult = { ok: true; profile: UserProfile } | { ok: false; message: string; code?: string };

interface UserState {
  profile: UserProfile | null;
  isLoading: boolean;
  // Which auth user the current profile/profileStatus refer to.
  loadedUserId: string | null;
  profileStatus: ProfileStatus;
  loadProfile: (userId: string) => Promise<void>;
  reset: () => void;
  saveOnboardingAnswers: (userId: string, answers: OnboardingAnswers) => Promise<SaveResult>;
  completeOnboarding: (userId: string) => Promise<SaveResult>;
  saveDeliveryAddress: (
    userId: string,
    address: string,
    coords: { latitude: number; longitude: number } | null
  ) => Promise<SaveResult>;
  calculateBMR: () => number;
  calculateTDEE: () => number;
  calculateDailyCalories: () => number;
  calculateProteinTarget: () => number;
  calculateCarbsTarget: () => number;
  calculateFatsTarget: () => number;
}

// Server messages for refused profile writes (trigger validation, SQLSTATE 22023).
function describeSaveError(error: any): SaveResult {
  if (error?.code === '22023') return { ok: false, code: error.code, message: 'Une valeur saisie n’est pas acceptée. Vérifiez vos réponses.' };
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    return { ok: false, code: error.code, message: 'Le serveur n’est pas encore à jour pour cette fonctionnalité.' };
  }
  return { ok: false, code: error?.code, message: 'Enregistrement impossible. Vérifiez votre connexion et réessayez.' };
}

export const useUserStore = create<UserState>((set, get) => {
  const writeProfile = async (userId: string, values: Record<string, unknown>): Promise<SaveResult> => {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    if (error) return describeSaveError(error);
    if (!data) return { ok: false, message: 'Profil introuvable. Reconnectez-vous puis réessayez.' };
    if (get().loadedUserId === userId) set({ profile: data as UserProfile });
    return { ok: true, profile: data as UserProfile };
  };

  return {
    profile: null,
    isLoading: false,
    loadedUserId: null,
    profileStatus: 'unloaded',

    loadProfile: async (userId: string) => {
      const read = () => supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();

      // Already loaded for this user (e.g. the home screen refreshing the
      // offer status): refresh in the background. Switching back to
      // 'loading' would make the route gate unmount the screen that asked,
      // which re-mounts and asks again — an endless reload loop.
      if (get().loadedUserId === userId && get().profileStatus === 'loaded') {
        const { data, error } = await read();
        if (!error && data && get().loadedUserId === userId) set({ profile: data as UserProfile });
        return;
      }

      set({ isLoading: true, loadedUserId: userId, profileStatus: 'loading' });
      let { data, error } = await read();

      // First sign-in (any provider): create the profile. Only user_id is
      // sent; the database makes it a customer profile and refuses anything
      // else. ON CONFLICT DO NOTHING keeps one profile per account.
      if (!error && !data) {
        const { error: insertError } = await supabase
          .from('user_profiles')
          .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (insertError) {
          error = insertError;
        } else {
          ({ data, error } = await read());
        }
      }

      // Ignore results for a user who is no longer the active one (sign-out or account switch).
      if (get().loadedUserId !== userId) return;

      if (error || !data) {
        console.error('Error loading profile:', error?.message ?? 'profile missing');
        set({ profile: null, isLoading: false, profileStatus: 'error' });
        return;
      }

      set({ profile: data as UserProfile, isLoading: false, profileStatus: 'loaded' });
    },

    reset: () => {
      set({ profile: null, isLoading: false, loadedUserId: null, profileStatus: 'unloaded' });
    },

    saveOnboardingAnswers: (userId, answers) =>
      writeProfile(userId, {
        gender: answers.gender,
        age: answers.age,
        weight: answers.weight,
        height: answers.height,
        activity_level: answers.activity_level,
      }),

    // The server stamps the time and checks that every answer is present.
    completeOnboarding: (userId) => writeProfile(userId, { onboarding_completed_at: new Date().toISOString() }),

    saveDeliveryAddress: (userId, address, coords) =>
      writeProfile(userId, {
        delivery_address: address.trim(),
        delivery_latitude: coords?.latitude ?? null,
        delivery_longitude: coords?.longitude ?? null,
      }),

    // Estimates: the server-computed values when available, otherwise the
    // same formula on the device. 0 means "no estimate" (missing or
    // unspecified answers); callers show that state instead of a number.
    calculateBMR: () => {
      const profile = get().profile;
      if (!profile) return 0;
      if (typeof profile.bmr_kcal === 'number') return profile.bmr_kcal;
      return (
        estimateEnergy({
          sex: profile.gender,
          age: profile.age,
          weightKg: profile.weight,
          heightCm: profile.height,
          activity: profile.activity_level,
        })?.bmrKcal ?? 0
      );
    },

    calculateTDEE: () => {
      const profile = get().profile;
      if (!profile) return 0;
      if (typeof profile.tdee_kcal === 'number') return profile.tdee_kcal;
      return (
        estimateEnergy({
          sex: profile.gender,
          age: profile.age,
          weightKg: profile.weight,
          heightCm: profile.height,
          activity: profile.activity_level,
        })?.tdeeKcal ?? 0
      );
    },

    calculateDailyCalories: () => {
      const tdee = get().calculateTDEE();
      const profile = get().profile;
      if (!tdee || !profile?.goal) return tdee;

      switch (profile.goal) {
        case 'lose_fat':
          return Math.round(tdee - 500);
        case 'gain_muscle':
          return Math.round(tdee + 300);
        default:
          return Math.round(tdee);
      }
    },

    calculateProteinTarget: () => {
      const profile = get().profile;
      if (!profile?.weight) return 150;

      const proteinPerKg = profile.goal === 'gain_muscle' ? 2.0 : 1.6;
      return Math.round(profile.weight * proteinPerKg);
    },

    calculateCarbsTarget: () => {
      const calories = get().calculateDailyCalories();
      const proteinCalories = get().calculateProteinTarget() * 4;
      const fatCalories = get().calculateFatsTarget() * 9;
      const carbsCalories = calories - proteinCalories - fatCalories;
      return Math.max(0, Math.round(carbsCalories / 4));
    },

    calculateFatsTarget: () => {
      const calories = get().calculateDailyCalories();
      return Math.round((calories * 0.25) / 9);
    },
  };
});
