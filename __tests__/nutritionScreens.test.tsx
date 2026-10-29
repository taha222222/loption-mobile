// Tracking store and screens with a mocked API layer. Proves what the app
// does with server answers (idempotent retries, no-log days, missing
// targets, meals without calories); the server rules themselves are tested
// in supabase/tests/run_v1_nutrition.sh.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NutritionScreen from '../app/(app)/nutrition';
import LogMealScreen from '../app/(app)/log-meal';
import { useNutritionStore } from '../src/stores/nutritionStore';
import { useUserStore } from '../src/stores/userStore';

const mockApi = {
  fetchSummary: jest.fn(),
  fetchEntries: jest.fn(),
  fetchStreak: jest.fn(),
  logMeal: jest.fn(),
  removeEntry: jest.fn(),
  fetchLoggableMeals: jest.fn(),
  fetchOrderedMeals: jest.fn(),
};
jest.mock('../src/services/nutritionApi', () => ({
  fetchSummary: (...a: any[]) => mockApi.fetchSummary(...a),
  fetchEntries: (...a: any[]) => mockApi.fetchEntries(...a),
  fetchStreak: (...a: any[]) => mockApi.fetchStreak(...a),
  logMeal: (...a: any[]) => mockApi.logMeal(...a),
  removeEntry: (...a: any[]) => mockApi.removeEntry(...a),
  fetchLoggableMeals: (...a: any[]) => mockApi.fetchLoggableMeals(...a),
  fetchOrderedMeals: (...a: any[]) => mockApi.fetchOrderedMeals(...a),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `req-${++mockUuid}` }));
jest.mock('../src/nutrition/dates', () => ({
  ...jest.requireActual('../src/nutrition/dates'),
  deviceTimeZone: () => 'Africa/Casablanca',
  localDate: () => '2026-10-29',
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(cb, [cb]);
  },
}));
jest.mock('../src/lib/supabase', () => ({ supabase: {} }));

const day = (date: string, consumed: number | null, target: number | null, source: any = 'snapshot') => ({
  date,
  entryCount: consumed === null ? 0 : 1,
  consumedKcal: consumed,
  hasLog: consumed !== null,
  targetKcal: target,
  targetSource: target === null ? null : source,
});
const week = () => [
  day('2026-10-23', 1800, 2200),
  day('2026-10-24', null, null),
  day('2026-10-25', 2100, 2200),
  day('2026-10-26', null, null),
  day('2026-10-27', 1350, 2200),
  day('2026-10-28', 2400, 2200),
  day('2026-10-29', 1350, 2200, 'current'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  useNutritionStore.getState().reset();
  useUserStore.setState({ profile: { id: 'p', user_id: 'u', gender: 'man', bmr_kcal: 1649, tdee_kcal: 2200 } as any });
  mockApi.fetchSummary.mockResolvedValue({ data: week(), error: null });
  mockApi.fetchEntries.mockResolvedValue({
    data: [{ id: 'e1', mealName: 'Bowl poulet', servings: 1.5, kcal: 1350, kcalPerServing: 900, orderItemId: null, loggedAt: '' }],
    error: null,
  });
  mockApi.fetchStreak.mockResolvedValue({
    data: { current: 4, longest: 6, lastLoggedDate: '2026-10-29', todayLogged: true, nextMilestone: 7 },
    error: null,
  });
  mockApi.logMeal.mockResolvedValue({ data: true, error: null });
});

describe('tracking store', () => {
  it('reuses the same idempotency key when a log is retried after a failure, and a new one afterwards', async () => {
    mockApi.logMeal.mockResolvedValueOnce({ data: null, error: { code: '08000', message: 'network' } });
    const first = await useNutritionStore.getState().logMeal({ mealId: 'm1', servings: 1 });
    expect(first.ok).toBe(false);
    await useNutritionStore.getState().logMeal({ mealId: 'm1', servings: 1 });
    await useNutritionStore.getState().logMeal({ mealId: 'm1', servings: 1 });
    const keys = mockApi.logMeal.mock.calls.map((c) => c[0].requestId);
    expect(keys).toEqual(['req-1', 'req-1', 'req-2']);
    expect(mockApi.logMeal.mock.calls[0][0]).toMatchObject({ localDate: '2026-10-29', timeZone: 'Africa/Casablanca', servings: 1 });
    expect(mockApi.logMeal.mock.calls[0][0]).not.toHaveProperty('kcal');
  });

  it('reports a load error with retry instead of showing stale or invented numbers', async () => {
    mockApi.fetchSummary.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await useNutritionStore.getState().refresh();
    expect(useNutritionStore.getState()).toMatchObject({ status: 'error' });
    await useNutritionStore.getState().refresh();
    expect(useNutritionStore.getState()).toMatchObject({ status: 'ready' });
  });
});

describe('nutrition screen', () => {
  it('shows the real target, consumed and remaining values, the estimates and the streak', async () => {
    await render(<NutritionScreen />);
    await waitFor(() => expect(screen.getByTestId('calorie-today-card')).toBeTruthy());
    expect(screen.getByLabelText(/1350 kilocalories consommées sur un objectif de 2200\. 850 restantes/)).toBeTruthy();
    expect(screen.getByText('Bowl poulet')).toBeTruthy();
    expect(screen.getByText(/1,5 portions · 1\s350 kcal/)).toBeTruthy();
    expect(screen.getByText('Métabolisme de base (BMR)')).toBeTruthy();
    expect(screen.getByText(/aucun ajustement de perte ou de prise de poids/)).toBeTruthy();
    expect(screen.getByText('4 jours d’affilée')).toBeTruthy();
    expect(screen.getByText('Prochain palier : 7 jours (encore 3 jours)')).toBeTruthy();
  });

  it('draws no-log days as "no meal logged", distinct from logged days', async () => {
    await render(<NutritionScreen />);
    await waitFor(() => expect(screen.getByTestId('chart-nolog-2026-10-24')).toBeTruthy());
    expect(screen.getByTestId('chart-nolog-2026-10-26')).toBeTruthy();
    expect(screen.queryByTestId('chart-nolog-2026-10-25')).toBeNull();
    expect(screen.getByLabelText(/24 : aucun repas enregistré/)).toBeTruthy();
    expect(screen.getByLabelText(/25 : 2100 kcal consommées, objectif 2200 kcal/)).toBeTruthy();
  });

  it('explains that no estimate exists instead of showing a number', async () => {
    useUserStore.setState({ profile: { id: 'p', user_id: 'u', gender: 'unspecified', bmr_kcal: null, tdee_kcal: null } as any });
    mockApi.fetchSummary.mockResolvedValue({ data: [day('2026-10-29', null, null)], error: null });
    mockApi.fetchEntries.mockResolvedValue({ data: [], error: null });
    await render(<NutritionScreen />);
    await waitFor(() => expect(screen.getByText('Estimation personnalisée indisponible')).toBeTruthy());
    expect(screen.getByText(/nous ne calculons pas d’estimation/)).toBeTruthy();
    expect(screen.getByText('Aucun repas enregistré aujourd’hui.')).toBeTruthy();
    expect(screen.getByText(/Aucun repas enregistré sur cette période/)).toBeTruthy();
  });
});

describe('log meal screen', () => {
  beforeEach(() => {
    mockApi.fetchLoggableMeals.mockResolvedValue({
      data: [{ id: 'm1', name: 'Bowl poulet', calories: 600, protein: 40, carbs: 50, fat: 20 }],
      error: null,
    });
    mockApi.fetchOrderedMeals.mockResolvedValue({
      data: [
        { orderItemId: 'oi1', mealId: 'm1', mealName: 'Bowl poulet', quantity: 2, orderedAt: '2026-10-28T12:00:00Z' },
        { orderItemId: 'oi2', mealId: 'm-nocal', mealName: 'Jus maison', quantity: 1, orderedAt: '2026-10-28T12:00:00Z' },
      ],
      error: null,
    });
  });

  it('logs an ordered meal only when the customer chooses it, with the chosen servings', async () => {
    await render(<LogMealScreen />);
    await waitFor(() => expect(screen.getByText('Mes commandes récentes')).toBeTruthy());
    expect(screen.getByLabelText(/Jus maison\. Pas de valeur calorique fiable/).props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockApi.logMeal).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(/Bowl poulet\. 600 kcal \/ portion · commandé ×2/));
    await fireEvent.press(screen.getByLabelText('Augmenter Quantité'));
    expect(screen.getByText('≈ 750 kcal')).toBeTruthy();
    await fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(mockApi.logMeal).toHaveBeenCalled());
    expect(mockApi.logMeal.mock.calls[0][0]).toMatchObject({ mealId: 'm1', orderItemId: 'oi1', servings: 1.25 });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('shows the server refusal and retries with the same request key', async () => {
    mockApi.logMeal.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'more servings logged than were ordered' } });
    await render(<LogMealScreen />);
    await waitFor(() => expect(screen.getByText('Menu L’OPTION')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText(/^Bowl poulet\. 600 kcal \/ portion$/));
    await fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(screen.getByText(/Toutes les portions de cette commande/)).toBeTruthy());
    await fireEvent.press(screen.getByText('Réessayer'));
    await waitFor(() => expect(mockApi.logMeal).toHaveBeenCalledTimes(2));
    expect(mockApi.logMeal.mock.calls[0][0].requestId).toBe(mockApi.logMeal.mock.calls[1][0].requestId);
  });
});
