import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  user_id: string;
  gender: 'man' | 'woman' | null;
  goal: 'lose_fat' | 'gain_muscle' | 'maintain' | 'healthy_lifestyle' | null;
  height: number | null;
  weight: number | null;
  age: number | null;
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | null;
  program: 'meals_only' | 'coaching' | 'transformation' | null;
  created_at: string;
  updated_at: string;
}

export type ProfileStatus = 'unloaded' | 'loading' | 'loaded' | 'error';

interface UserState {
  profile: UserProfile | null;
  isLoading: boolean;
  // Which auth user the current profile/profileStatus refer to.
  loadedUserId: string | null;
  profileStatus: ProfileStatus;
  loadProfile: (userId: string) => Promise<void>;
  reset: () => void;
  createProfile: (userId: string, data: Partial<UserProfile>) => Promise<void>;
  updateProfile: (userId: string, data: Partial<UserProfile>) => Promise<void>;
  calculateBMR: () => number;
  calculateTDEE: () => number;
  calculateDailyCalories: () => number;
  calculateProteinTarget: () => number;
  calculateCarbsTarget: () => number;
  calculateFatsTarget: () => number;
}

export const useUserStore = create<UserState>((set, get) => ({
  profile: null,
  isLoading: false,
  loadedUserId: null,
  profileStatus: 'unloaded',

  loadProfile: async (userId: string) => {
    set({ isLoading: true, loadedUserId: userId, profileStatus: 'loading' });
    
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // Ignore results for a user who is no longer the active one (sign-out or account switch).
    if (get().loadedUserId !== userId) return;
    
    if (error) {
      console.error('Error loading profile:', error);
      set({ profile: null, isLoading: false, profileStatus: 'error' });
      return;
    }
    
    set({ profile: (data as UserProfile) ?? null, isLoading: false, profileStatus: 'loaded' });
  },

  reset: () => {
    set({ profile: null, isLoading: false, loadedUserId: null, profileStatus: 'unloaded' });
  },

  createProfile: async (userId: string, data: Partial<UserProfile>) => {
    console.log('Creating profile for user:', userId);
    
    // First check if profile already exists
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (existingProfile) {
      console.log('Profile already exists, updating instead');
      await get().updateProfile(userId, data);
      return;
    }
    
    // Insert new profile
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .insert({ user_id: userId, ...data })
      .select()
      .maybeSingle();
    
    if (error) {
      console.error('Error creating profile:', error);
    }
    
    if (profile) {
      console.log('Profile created:', profile);
      set({ profile: profile as UserProfile });
    }
  },

  updateProfile: async (userId: string, data: Partial<UserProfile>) => {
    console.log('Updating profile for user:', userId);
    
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    
    if (error) {
      console.error('Error updating profile:', error);
    }
    
    if (profile) {
      console.log('Profile updated:', profile);
      set({ profile: profile as UserProfile });
    }
  },

  calculateBMR: () => {
    const profile = get().profile;
    if (!profile?.weight || !profile?.height || !profile?.age) return 0;
    
    // Mifflin-St Jeor Equation
    if (profile.gender === 'man') {
      return 10 * profile.weight + 6.25 * profile.height - 5 * profile.age + 5;
    } else {
      return 10 * profile.weight + 6.25 * profile.height - 5 * profile.age - 161;
    }
  },

  calculateTDEE: () => {
    const bmr = get().calculateBMR();
    const profile = get().profile;
    
    const multipliers = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };
    
    const multiplier = multipliers[profile?.activity_level || 'moderate'];
    return Math.round(bmr * multiplier);
  },

  calculateDailyCalories: () => {
    const tdee = get().calculateTDEE();
    const profile = get().profile;
    
    if (!profile?.goal) return tdee;
    
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
    return Math.round(carbsCalories / 4);
  },

  calculateFatsTarget: () => {
    const calories = get().calculateDailyCalories();
    return Math.round((calories * 0.25) / 9);
  },
}));