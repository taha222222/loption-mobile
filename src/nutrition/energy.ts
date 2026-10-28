// src/nutrition/energy.ts
// Estimated energy needs from the onboarding answers.
//
// BMR — Mifflin-St Jeor (1990), resting energy:
//   man:   10 × weight(kg) + 6.25 × height(cm) − 5 × age + 5
//   woman: 10 × weight(kg) + 6.25 × height(cm) − 5 × age − 161
// Activity is NOT part of BMR. TDEE (estimated daily energy) = BMR × multiplier:
//   sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very_active 1.9
// Values are rounded to whole kcal; TDEE is computed from the unrounded BMR.
//
// The database computes the stored values with the same rules
// (public.estimate_energy in the V1 onboarding migration); this module
// validates input and previews the result. Both are estimates, not medical
// advice. With the sex input 'unspecified' no estimate is produced.

export type SexInput = 'man' | 'woman' | 'unspecified';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Accepted ranges (same as the database trigger).
export const LIMITS = {
  age: { min: 13, max: 100 },
  weightKg: { min: 30, max: 300 },
  heightCm: { min: 100, max: 250 },
} as const;

export interface EnergyInput {
  sex: SexInput | null;
  age: number | null;
  weightKg: number | null;
  heightCm: number | null;
  activity: ActivityLevel | null;
}

export interface EnergyEstimate {
  bmrKcal: number;
  tdeeKcal: number | null;
}

export type FieldError = 'required' | 'not_a_number' | 'not_an_integer' | 'too_low' | 'too_high';

const inRange = (value: number, range: { min: number; max: number }) =>
  value >= range.min && value <= range.max;

function checkNumber(
  value: number | null,
  range: { min: number; max: number },
  integer: boolean
): FieldError | null {
  if (value === null || value === undefined) return 'required';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'not_a_number';
  if (integer && !Number.isInteger(value)) return 'not_an_integer';
  if (value < range.min) return 'too_low';
  if (value > range.max) return 'too_high';
  return null;
}

export const validateAge = (age: number | null) => checkNumber(age, LIMITS.age, true);
export const validateWeight = (kg: number | null) => checkNumber(kg, LIMITS.weightKg, false);
export const validateHeight = (cm: number | null) => checkNumber(cm, LIMITS.heightCm, false);

// Parses a numeric text field. Accepts a decimal comma ("72,5"); returns
// null for empty input and NaN for anything that is not a plain number.
export function parseNumberInput(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export function calculateBmr(input: Omit<EnergyInput, 'activity'>): number | null {
  const { sex, age, weightKg, heightCm } = input;
  if (sex !== 'man' && sex !== 'woman') return null;
  if (age === null || weightKg === null || heightCm === null) return null;
  if (!Number.isInteger(age) || !inRange(age, LIMITS.age)) return null;
  if (!Number.isFinite(weightKg) || !inRange(weightKg, LIMITS.weightKg)) return null;
  if (!Number.isFinite(heightCm) || !inRange(heightCm, LIMITS.heightCm)) return null;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'man' ? 5 : -161);
}

export function estimateEnergy(input: EnergyInput): EnergyEstimate | null {
  const bmr = calculateBmr(input);
  if (bmr === null) return null;
  const multiplier = input.activity ? ACTIVITY_MULTIPLIERS[input.activity] : undefined;
  return {
    bmrKcal: roundHalfUp(bmr),
    tdeeKcal: multiplier === undefined ? null : roundHalfUp(bmr * multiplier),
  };
}

// PostgreSQL round(numeric) rounds halves away from zero; match it for positive values.
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}
