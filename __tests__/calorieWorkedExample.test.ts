// The documented worked example (STANDALONE_TRACKING.md §4, SQL tests
// E01-E04) as the server returns it: the app only shapes these numbers and
// never recomputes or fills them.
import { budgetDetails, toDailyBalances } from '../src/activity/dailyBalance';

const row = {
  local_date: '2026-11-03',
  entry_count: 2,
  consumed_kcal: 2100,
  has_meal_log: true,
  bmr_kcal: 1649,
  tdee_kcal: 2556,
  activity_source: 'device_motion',
  steps: 8000,
  distance_m: 6000,
  energy_estimate_kcal: 2033,
  energy_method: 'bmr_plus_movement',
  remaining_kcal: -67,
  workout_count: 1,
  workout_seconds: 1800,
  workout_kcal: 88,
  workout_kcal_estimated: true,
  base_kcal: 1814,
  step_kcal: 131,
  counted_workout_kcal: 88,
  activity_kcal: 219,
  active_minutes: 30,
  walk_distance_m: 6000,
  walk_distance_estimated: false,
  confidence: 'estimated',
};

describe('calorie engine worked example (server values)', () => {
  const [d] = toDailyBalances([row], '2026-11-03', '2026-11-03');

  it('keeps the parts of the budget: 1 814 + 131 + 88 = 2 033', () => {
    expect(d.baseKcal).toBe(1814);
    expect(d.stepKcal).toBe(131);
    expect(d.countedWorkoutKcal).toBe(88);
    expect(d.budgetKcal).toBe(2033);
    expect((d.baseKcal ?? 0) + (d.stepKcal ?? 0) + d.countedWorkoutKcal).toBe(d.budgetKcal);
    expect(d.confidence).toBe('estimated');
  });

  it('keeps a negative remaining value (over budget) as is', () => {
    expect(d.remainingKcal).toBe(-67);
  });

  it('explains each part with the constants pending owner approval', () => {
    const lines = budgetDetails(d);
    expect(lines).toContain('Repos et digestion : 1814 kcal (métabolisme de base 1649 kcal × 1,1)');
    expect(lines).toContain('Pas : 131 kcal (0,5 kcal par kg et par km de marche)');
    expect(lines.some((l) => l.startsWith('Séances : 88 kcal'))).toBe(true);
    expect(lines.some((l) => l.includes('Distance estimée'))).toBe(false);
    expect(lines[lines.length - 1]).toBe('Ce sont des estimations, pas un avis médical.');
  });

  it('a day the server did not return has no budget (never invented)', () => {
    const [empty] = toDailyBalances([], '2026-11-02', '2026-11-02');
    expect(empty.budgetKcal).toBeNull();
    expect(empty.stepKcal).toBeNull();
    expect(empty.confidence).toBeNull();
    expect(budgetDetails(empty)).toEqual(['Ce sont des estimations, pas un avis médical.']);
  });
});
