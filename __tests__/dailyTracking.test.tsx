// Daily Tracking: balance shaping, movement states, tab/cart navigation,
// the tracking screen and logging a meal from a delivered order, with the
// API layer mocked. The energy model and its no-double-counting rules are
// computed and tested on the server (supabase/tests/run_v1_activity.sh).
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  activityShareOfBudget,
  intakeShare,
  movementState,
  toDailyBalances,
  weekTotals,
} from '../src/activity/dailyBalance';
import { CUSTOMER_TABS } from '../src/navigation/customerTabs';
import { decideRoute } from '../src/navigation/routeDecision';
import { BasketButton, DailyBalanceCard } from '../src/components/v2';
import { useCartStore } from '../src/stores/cartStore';
import { useActivityStore } from '../src/stores/activityStore';
import { useTrackingStore } from '../src/stores/trackingStore';
import { useWorkoutStore } from '../src/stores/workoutStore';
import TrackingScreen from '../app/(app)/tracking';
import LogMealScreen from '../app/(app)/log-meal';

const mockApi = {
  fetchDailyBalance: jest.fn(),
  fetchEntries: jest.fn(),
  fetchWorkouts: jest.fn(),
  fetchLoggableMeals: jest.fn(),
  fetchOrderedMeals: jest.fn(),
};
jest.mock('../src/services/activityApi', () => ({
  ...jest.requireActual('../src/services/activityApi'),
  fetchDailyBalance: (...a: any[]) => mockApi.fetchDailyBalance(...a),
}));
jest.mock('../src/services/nutritionApi', () => ({
  ...jest.requireActual('../src/services/nutritionApi'),
  fetchEntries: (...a: any[]) => mockApi.fetchEntries(...a),
  fetchLoggableMeals: (...a: any[]) => mockApi.fetchLoggableMeals(...a),
  fetchOrderedMeals: (...a: any[]) => mockApi.fetchOrderedMeals(...a),
}));
jest.mock('../src/services/workoutApi', () => ({
  ...jest.requireActual('../src/services/workoutApi'),
  fetchWorkouts: (...a: any[]) => mockApi.fetchWorkouts(...a),
}));
jest.mock('../src/activity/providers', () => ({
  providersForPlatform: () => [],
  providerById: () => null,
  PROVIDER_LABEL: {},
  PROVIDER_SCOPE: {},
}));
jest.mock('../src/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'req-1' }));
jest.mock('../src/nutrition/dates', () => ({
  ...jest.requireActual('../src/nutrition/dates'),
  deviceTimeZone: () => 'Africa/Casablanca',
  localDate: () => '2026-10-29',
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(cb, [cb]);
  },
}));

const row = (date: string, over: Record<string, any> = {}) => ({
  local_date: date,
  entry_count: 1,
  consumed_kcal: 500,
  has_meal_log: true,
  bmr_kcal: 1649,
  tdee_kcal: 2556,
  activity_source: 'apple_health',
  steps: 7000,
  distance_m: 5100,
  active_energy_kcal: 350,
  total_energy_kcal: null,
  coverage: 'partial',
  synced_at: new Date().toISOString(),
  energy_estimate_kcal: 1999,
  energy_method: 'bmr_plus_active',
  remaining_kcal: 1499,
  workout_count: 1,
  workout_seconds: 1800,
  workout_kcal: 292,
  workout_kcal_estimated: true,
  ...over,
});
const week = () =>
  toDailyBalances(
    [
      row('2026-10-23', { activity_source: null, steps: null, distance_m: null, active_energy_kcal: null, energy_method: 'tdee_baseline', energy_estimate_kcal: 2556, remaining_kcal: 2056, workout_count: 0, workout_seconds: 0, workout_kcal: null }),
      row('2026-10-25', { has_meal_log: false, consumed_kcal: null, entry_count: 0, steps: 0, coverage: 'complete', energy_method: 'platform_total', energy_estimate_kcal: 2290, remaining_kcal: 2290 }),
      row('2026-10-29'),
    ],
    '2026-10-23',
    '2026-10-29'
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  useTrackingStore.getState().reset();
  useActivityStore.setState({ source: null, providers: [], permission: null, lastSync: null, syncing: false });
  useWorkoutStore.getState().reset();
  useCartStore.getState().reset();
  mockApi.fetchDailyBalance.mockResolvedValue({ data: week(), error: null });
  mockApi.fetchEntries.mockResolvedValue({
    data: [{ id: 'e1', mealName: 'Bowl poulet', servings: 1, kcal: 500, kcalPerServing: 500, orderItemId: 'oi1', loggedAt: '2026-10-29T12:10:00Z' }],
    error: null,
  });
  mockApi.fetchWorkouts.mockResolvedValue({
    data: [
      { id: 'w1', source: 'app', kind: 'run', startedAt: '2026-10-29T07:00:00Z', endedAt: '2026-10-29T07:30:00Z', activeSeconds: 1800, localDate: '2026-10-29', distanceM: 5000, distanceSource: 'gps', energyKcal: 292, energySource: 'met_estimate', met: 11, duplicateOf: 'w2' },
      { id: 'w2', source: 'apple_health', kind: 'run', startedAt: '2026-10-29T06:58:00Z', endedAt: '2026-10-29T07:31:00Z', activeSeconds: 1900, localDate: '2026-10-29', distanceM: 5100, distanceSource: 'provider', energyKcal: 330, energySource: 'provider_measured', met: null, duplicateOf: null },
    ],
    error: null,
  });
});

describe('daily balance shaping', () => {
  it('fills days the server omitted as "no data", keeps measured zero steps as 0', () => {
    const days = week();
    expect(days.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
    expect(days[1]).toMatchObject({ activitySource: null, steps: null, consumedKcal: null, hasMealLog: false, budgetKcal: null });
    expect(days[2]).toMatchObject({ steps: 0, activitySource: 'apple_health', consumedKcal: null, method: 'platform_total' });
    expect(days[0]).toMatchObject({ activitySource: null, steps: null, method: 'tdee_baseline' });
  });

  it('shares for the energy path: intake capped at 1, earned part only for BMR + active', () => {
    const [d] = toDailyBalances([row('2026-10-29', { consumed_kcal: 2500, remaining_kcal: -501 })], '2026-10-29', '2026-10-29');
    expect(intakeShare(d)).toBe(1);
    expect(activityShareOfBudget(d)).toBeCloseTo(350 / 1999);
    const [t] = toDailyBalances([row('2026-10-29', { energy_method: 'tdee_baseline' })], '2026-10-29', '2026-10-29');
    expect(activityShareOfBudget(t)).toBe(0);
  });

  it('week totals count only real data', () => {
    expect(weekTotals(week())).toEqual({ daysWithMeals: 2, daysWithActivity: 2, steps: 7000, workoutCount: 2, workoutSeconds: 3600 });
    expect(weekTotals(toDailyBalances([], '2026-10-23', '2026-10-29')).steps).toBeNull();
  });
});

describe('movement states', () => {
  const ctx = { today: '2026-10-29', now: new Date(), connected: 'apple_health' as const, availability: 'available' as const, permission: 'requested' as const };
  const [today] = toDailyBalances([row('2026-10-29')], '2026-10-29', '2026-10-29');

  it('distinguishes every case the screen must explain', () => {
    expect(movementState(null, { ...ctx, connected: null, availability: null })).toBe('unsupported');
    expect(movementState(null, { ...ctx, connected: null, availability: 'needs_native_build' })).toBe('needs_build');
    expect(movementState(null, { ...ctx, connected: null, availability: 'needs_install' })).toBe('needs_install');
    expect(movementState(null, { ...ctx, connected: null, availability: 'available' })).toBe('not_connected');
    expect(movementState({ ...today, activitySource: null }, { ...ctx, permission: 'denied' })).toBe('denied');
    // data synced earlier (or from the phone) is shown even where nothing is connected
    expect(movementState(today, { ...ctx, connected: null, availability: 'unsupported' })).toBe('partial');
    expect(movementState({ ...today, activitySource: null }, ctx)).toBe('not_synced');
    expect(movementState({ ...today, steps: null, distanceM: null, activeKcal: null }, ctx)).toBe('no_data');
    expect(movementState(today, ctx)).toBe('partial');
    expect(movementState({ ...today, syncedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }, ctx)).toBe('stale');
    expect(movementState({ ...today, date: '2026-10-28', coverage: 'complete' }, ctx)).toBe('complete');
    expect(movementState({ ...today, steps: 0 }, ctx)).toBe('partial'); // a measured zero is data
  });
});

describe('navigation', () => {
  it('replaces the Cart tab with Daily Tracking (five tabs)', () => {
    expect(CUSTOMER_TABS.map((t) => t.name)).toEqual(['index', 'menu', 'tracking', 'orders', 'profile']);
    expect(CUSTOMER_TABS.find((t) => t.name === 'cart')).toBeUndefined();
  });

  it('keeps the basket reachable with a live count and does not touch its contents', async () => {
    useCartStore.getState().addItem({ id: 'm1', name: 'Bowl', price: 60, calories: 500, protein: 30 });
    useCartStore.getState().addItem({ id: 'm1', name: 'Bowl', price: 60, calories: 500, protein: 30 });
    useCartStore.getState().addItem({ id: 'm2', name: 'Salade', price: 45, calories: 300, protein: 12 });
    await render(<BasketButton />);
    expect(screen.getByTestId('basket-badge')).toHaveTextContent('3');
    await fireEvent.press(screen.getByLabelText('Panier, 3 articles'));
    expect(mockRouter.push).toHaveBeenCalledWith('/(app)/cart');
    expect(useCartStore.getState().items.map((i) => [i.id, i.quantity])).toEqual([['m1', 2], ['m2', 1]]);
  });

  it('the tracking tab is behind the customer route gate (signed-out and staff are redirected)', () => {
    const base = { authLoading: false, hasSession: true, emailVerified: true, role: 'customer' as const, roleStatus: 'resolved' as const, profileStatus: 'loaded' as const, onboardingComplete: true, setupStatus: 'done' as const, group: '(app)', screen: 'tracking' };
    expect(decideRoute(base)).toEqual({ kind: 'allow' });
    expect(decideRoute({ ...base, hasSession: false, role: null, roleStatus: 'idle' })).toEqual({ kind: 'redirect', href: '/(auth)/welcome' });
    expect(decideRoute({ ...base, role: 'driver' })).toMatchObject({ kind: 'redirect', href: '/(driver)' });
  });
});

describe('daily balance card', () => {
  it('reports over budget honestly (negative remaining, not clamped)', async () => {
    const [d] = toDailyBalances([row('2026-10-29', { consumed_kcal: 2000, remaining_kcal: -386, energy_estimate_kcal: 1614, energy_method: 'tdee_baseline' })], '2026-10-29', '2026-10-29');
    await render(<DailyBalanceCard day={d} title="Aujourd’hui" />);
    expect(screen.getByText('Au-delà du budget')).toBeTruthy();
    expect(screen.getByText('386')).toBeTruthy();
    expect(screen.getByText('+386')).toBeTruthy();
  });

  it('without BMR/TDEE shows consumed calories and asks to complete the profile', async () => {
    const onComplete = jest.fn();
    const [d] = toDailyBalances([row('2026-10-29', { bmr_kcal: null, tdee_kcal: null, energy_estimate_kcal: null, energy_method: null, remaining_kcal: null })], '2026-10-29', '2026-10-29');
    await render(<DailyBalanceCard day={d} title="Aujourd’hui" onCompleteProfile={onComplete} />);
    expect(screen.getAllByText('Consommées')).toHaveLength(2); // headline and stat
    expect(screen.getByText(/Budget personnalisé indisponible/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Compléter mon profil'));
    expect(onComplete).toHaveBeenCalled();
  });
});

describe('tracking screen', () => {
  it('shows today’s balance, method, timeline (duplicate not counted) and the week', async () => {
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByTestId('daily-balance-card')).toBeTruthy());
    expect(screen.getByText('Restantes')).toBeTruthy();
    expect(screen.getByText('1 499')).toBeTruthy();
    expect(screen.getAllByText('Métabolisme de base + activité mesurée').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Bowl poulet')).toBeTruthy());
    expect(screen.getByText('Doublon d’une autre source : non compté')).toBeTruthy();
    expect(screen.getByText(/330 kcal — mesurée par Apple Santé/)).toBeTruthy();
    expect(screen.getByTestId('week-summary')).toHaveTextContent(/2 jours avec repas, 2 avec activité, 7 000 pas, 2 séances/);
    expect(screen.getByTestId('balance-nolog-2026-10-25')).toBeTruthy(); // no meal ≠ 0 kcal
    expect(screen.getByTestId('balance-nosteps-2026-10-24')).toBeTruthy(); // no data ≠ 0 steps
    expect(mockApi.fetchDailyBalance).toHaveBeenCalledWith('2026-10-23', '2026-10-29', '2026-10-29');
  });

  it('works without any health connection (unsupported here) and offers workouts', async () => {
    mockApi.fetchDailyBalance.mockResolvedValue({
      data: toDailyBalances([row('2026-10-29', { activity_source: null, steps: null, distance_m: null, active_energy_kcal: null })], '2026-10-23', '2026-10-29'),
      error: null,
    });
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByText('Activité non disponible ici')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Démarrer : Vélo'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(app)/workout', params: { kind: 'cycle' } });
  });

  it('inspects a previous day', async () => {
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByTestId('balance-day-2026-10-25')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('balance-day-2026-10-25'));
    await waitFor(() => expect(mockApi.fetchEntries).toHaveBeenLastCalledWith('2026-10-25'));
    expect(mockApi.fetchWorkouts).toHaveBeenLastCalledWith('2026-10-25', '2026-10-25');
    expect(screen.getByText('Revenir à aujourd’hui')).toBeTruthy();
    expect(screen.getAllByText('Dépense totale mesurée').length).toBeGreaterThan(0);
  });

  it('shows an error state with retry', async () => {
    mockApi.fetchDailyBalance.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByText('Bilan indisponible')).toBeTruthy());
  });

  it('shows the empty timeline state', async () => {
    mockApi.fetchEntries.mockResolvedValue({ data: [], error: null });
    mockApi.fetchWorkouts.mockResolvedValue({ data: [], error: null });
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByText('Aucun repas ni séance enregistré ce jour-là.')).toBeTruthy());
  });
});

describe('“I ate this meal” from an order', () => {
  beforeEach(() => {
    mockApi.fetchLoggableMeals.mockResolvedValue({ data: [{ id: 'm1', name: 'Bowl poulet', calories: 500, protein: 30, carbs: 40, fat: 10 }], error: null });
  });

  it('lists only that delivered order’s meals; a meal without nutrition data is shown as unavailable', async () => {
    mockParams = { orderId: 'o1' };
    mockApi.fetchOrderedMeals.mockResolvedValue({
      data: [
        { orderItemId: 'oi1', mealId: 'm1', mealName: 'Bowl poulet', quantity: 2, orderedAt: '2026-10-29T11:00:00Z' },
        { orderItemId: 'oi2', mealId: 'mX', mealName: 'Jus maison', quantity: 1, orderedAt: '2026-10-29T11:00:00Z' },
      ],
      error: null,
    });
    await render(<LogMealScreen />);
    await waitFor(() => expect(screen.getByText('Cette commande')).toBeTruthy());
    expect(mockApi.fetchOrderedMeals).toHaveBeenCalledWith(expect.any(String), 'o1');
    expect(screen.getByText('J’ai mangé ce repas')).toBeTruthy();
    expect(screen.getByText('Valeurs nutritionnelles indisponibles : ne peut pas être enregistré')).toBeTruthy();
  });

  it('says so when the order is not delivered yet', async () => {
    mockParams = { orderId: 'o2' };
    mockApi.fetchOrderedMeals.mockResolvedValue({ data: [], error: null });
    await render(<LogMealScreen />);
    await waitFor(() => expect(screen.getByText('Commande pas encore livrée')).toBeTruthy());
  });
});

describe('server without the tracking migrations (hosted project before the V1 rollout)', () => {
  const missing = { code: 'PGRST202', message: 'Could not find the function public.activity_daily_summary(p_from, p_to, p_today) in the schema cache' };

  it('recognises a missing function, table or column, and nothing else', () => {
    const { isMissingServerFeature } = jest.requireActual('../src/lib/serverFeatures');
    expect(isMissingServerFeature(missing)).toBe(true);
    expect(isMissingServerFeature({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(isMissingServerFeature({ code: '42703' })).toBe(true);
    expect(isMissingServerFeature({ message: 'Network request failed' })).toBe(false);
    expect(isMissingServerFeature({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingServerFeature(null)).toBe(false);
  });

  it('Suivi says the feature is not enabled yet: no "check your connection", no "complete your profile"', async () => {
    mockApi.fetchDailyBalance.mockResolvedValue({ data: null, error: missing });
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByText('Suivi quotidien pas encore disponible')).toBeTruthy());
    expect(screen.queryByText(/Vérifiez votre connexion/)).toBeNull();
    expect(screen.queryByText(/Compléter mon profil/)).toBeNull();
    expect(screen.queryByTestId('daily-balance-card')).toBeNull();
  });

  it('a network failure without data shows the retry message and no placeholder balance', async () => {
    mockApi.fetchDailyBalance.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await render(<TrackingScreen />);
    await waitFor(() => expect(screen.getByText('Bilan indisponible')).toBeTruthy());
    expect(screen.queryByTestId('daily-balance-card')).toBeNull();
    expect(screen.queryByText(/Compléter mon profil/)).toBeNull();
  });

  it('the home card is not stuck loading: it says calorie tracking is not available yet', async () => {
    const { CalorieTodayCard } = jest.requireActual('../src/components/v2');
    await render(<CalorieTodayCard targetKcal={null} consumedKcal={null} unavailable />);
    expect(screen.getByText('Suivi des calories')).toBeTruthy();
    expect(screen.getByText(/mise à jour du serveur L’OPTION est en attente/)).toBeTruthy();
    expect(screen.queryByText('…')).toBeNull();
  });
});
