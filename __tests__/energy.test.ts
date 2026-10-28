import {
  ACTIVITY_MULTIPLIERS,
  calculateBmr,
  estimateEnergy,
  parseNumberInput,
  validateAge,
  validateHeight,
  validateWeight,
} from '../src/nutrition/energy';

describe('Mifflin-St Jeor BMR', () => {
  it('uses +5 for the male equation', () => {
    // 10*70 + 6.25*175 - 5*30 + 5
    expect(calculateBmr({ sex: 'man', age: 30, weightKg: 70, heightCm: 175 })).toBeCloseTo(1648.75);
  });

  it('uses -161 for the female equation', () => {
    // 10*60 + 6.25*165 - 5*25 - 161
    expect(calculateBmr({ sex: 'woman', age: 25, weightKg: 60, heightCm: 165 })).toBeCloseTo(1345.25);
  });

  it('does not invent an estimate without a usable sex input', () => {
    expect(calculateBmr({ sex: 'unspecified', age: 30, weightKg: 70, heightCm: 175 })).toBeNull();
    expect(calculateBmr({ sex: null, age: 30, weightKg: 70, heightCm: 175 })).toBeNull();
  });

  it('returns null for missing or out-of-range inputs', () => {
    expect(calculateBmr({ sex: 'man', age: null, weightKg: 70, heightCm: 175 })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 30, weightKg: null, heightCm: 175 })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 30, weightKg: 70, heightCm: null })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 5, weightKg: 70, heightCm: 175 })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 30.5, weightKg: 70, heightCm: 175 })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 30, weightKg: 0, heightCm: 175 })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 30, weightKg: 70, heightCm: 400 })).toBeNull();
    expect(calculateBmr({ sex: 'man', age: 30, weightKg: Number.NaN, heightCm: 175 })).toBeNull();
  });
});

describe('TDEE', () => {
  it('multiplies the BMR by the activity factor (activity is not part of BMR)', () => {
    const sedentary = estimateEnergy({ sex: 'man', age: 30, weightKg: 70, heightCm: 175, activity: 'sedentary' })!;
    const veryActive = estimateEnergy({ sex: 'man', age: 30, weightKg: 70, heightCm: 175, activity: 'very_active' })!;
    expect(sedentary.bmrKcal).toBe(veryActive.bmrKcal);
    expect(sedentary.tdeeKcal).toBe(Math.round(1648.75 * 1.2));
    expect(veryActive.tdeeKcal).toBe(Math.round(1648.75 * 1.9));
  });

  it.each([
    ['sedentary', 1.2],
    ['light', 1.375],
    ['moderate', 1.55],
    ['active', 1.725],
    ['very_active', 1.9],
  ] as const)('uses the approved multiplier for %s', (level, factor) => {
    expect(ACTIVITY_MULTIPLIERS[level]).toBe(factor);
  });

  it('matches the database rounding (whole kcal, TDEE from the unrounded BMR)', () => {
    // Same cases as supabase/tests/v1_onboarding_offer_tests.sql N01/N02.
    expect(estimateEnergy({ sex: 'man', age: 30, weightKg: 70, heightCm: 175, activity: 'moderate' })).toEqual({
      bmrKcal: 1649,
      tdeeKcal: 2556,
    });
    expect(estimateEnergy({ sex: 'woman', age: 25, weightKg: 60, heightCm: 165, activity: 'sedentary' })).toEqual({
      bmrKcal: 1345,
      tdeeKcal: 1614,
    });
  });

  it('gives a BMR without TDEE when no activity level is chosen', () => {
    expect(estimateEnergy({ sex: 'woman', age: 40, weightKg: 65, heightCm: 160, activity: null })).toEqual({
      bmrKcal: 1289, // 650 + 1000 - 200 - 161
      tdeeKcal: null,
    });
  });
});

describe('input validation', () => {
  it('validates age as a whole number of years', () => {
    expect(validateAge(null)).toBe('required');
    expect(validateAge(Number.NaN)).toBe('not_a_number');
    expect(validateAge(29.5)).toBe('not_an_integer');
    expect(validateAge(12)).toBe('too_low');
    expect(validateAge(-1)).toBe('too_low');
    expect(validateAge(101)).toBe('too_high');
    expect(validateAge(30)).toBeNull();
  });

  it('validates weight and height ranges', () => {
    expect(validateWeight(29)).toBe('too_low');
    expect(validateWeight(301)).toBe('too_high');
    expect(validateWeight(72.5)).toBeNull();
    expect(validateHeight(99)).toBe('too_low');
    expect(validateHeight(251)).toBe('too_high');
    expect(validateHeight(170)).toBeNull();
  });

  it('parses numeric text, accepting a decimal comma', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('  ')).toBeNull();
    expect(parseNumberInput('72,5')).toBe(72.5);
    expect(parseNumberInput('180')).toBe(180);
    expect(parseNumberInput('-5')).toBeNaN();
    expect(parseNumberInput('7O')).toBeNaN();
    expect(parseNumberInput('1e3')).toBeNaN();
  });
});
