export type Gender = 'man' | 'woman';
export type Goal = 'lose_fat' | 'gain_muscle' | 'maintain' | 'healthy_lifestyle';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Program = 'meals_only' | 'coaching' | 'transformation';

export interface OnboardingData {
  gender: Gender | null;
  goal: Goal | null;
  weight: number | null;
  height: number | null;
  age: number | null;
  activityLevel: ActivityLevel | null;
  program: Program | null;
}