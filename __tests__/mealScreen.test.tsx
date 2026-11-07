// Product page: meal, configured choices with their prices, required
// choices validated before "Ajouter", popularity only from the server count,
// cart line with choices, edit mode.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import MealScreen from '../app/(app)/meal/[id]';
import { useCartStore } from '../src/stores/cartStore';

const mockParams: { id: string; line?: string } = { id: 'bowl' };
const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: (...a: unknown[]) => mockBack(...a), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
const mockDetail = jest.fn();
const mockPopularity = jest.fn();
jest.mock('../src/services/menuApi', () => ({
  fetchMealDetail: (...a: unknown[]) => mockDetail(...a),
  fetchMealPopularity: (...a: unknown[]) => mockPopularity(...a),
}));
jest.mock('../src/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const MEAL = { id: 'bowl', name: 'Bol poulet', price: 50, description: 'Poulet grillé, riz complet.', imageUrl: null, calories: 500, protein: 30, carbs: 50, fat: 12, available: true };
const GROUPS = [
  { id: 'g-sauce', name: 'Sauce', minSelect: 1, maxSelect: 1, options: [{ id: 's1', name: 'Harissa', priceDelta: 0 }, { id: 's2', name: 'Algérienne', priceDelta: 0 }] },
  { id: 'g-extra', name: 'Suppléments', minSelect: 0, maxSelect: 2, options: [{ id: 'e1', name: 'Fromage', priceDelta: 5 }, { id: 'e2', name: 'Oeuf', priceDelta: 4.5 }] },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = 'bowl';
  delete mockParams.line;
  mockDetail.mockResolvedValue({ ok: true, meal: MEAL, groups: GROUPS });
  mockPopularity.mockResolvedValue(128);
  useCartStore.setState({ ownerId: 'u', items: [] });
});

describe('product page', () => {
  it('shows the meal, its description, real popularity and its configured choices with extra prices', async () => {
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Bol poulet')).toBeTruthy());
    expect(screen.getByText('Poulet grillé, riz complet.')).toBeTruthy();
    expect(screen.getByText('50 MAD')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('meal-popularity')).toHaveTextContent(/Déjà commandé par plus de 120 clients/));
    expect(screen.getByText('Obligatoire · 1 choix')).toBeTruthy();
    expect(screen.getByText('+5 MAD')).toBeTruthy();
    expect(screen.getByText('+4,50 MAD')).toBeTruthy();
    expect(mockPopularity).toHaveBeenCalledWith('bowl');
  });

  it('hides popularity when the server has no reliable count', async () => {
    mockPopularity.mockResolvedValue(3);
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Bol poulet')).toBeTruthy());
    expect(screen.queryByTestId('meal-popularity')).toBeNull();
  });

  it('a required choice is asked before adding; nothing is added without it', async () => {
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Ajouter · 50 MAD')).toBeTruthy());
    await fireEvent.press(screen.getByText('Ajouter · 50 MAD'));
    expect(screen.getByText('Choisissez : Sauce')).toBeTruthy();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('the price follows the choices and the quantity; the line keeps every choice and the note', async () => {
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Harissa')).toBeTruthy());
    await fireEvent.press(screen.getByText('Harissa'));
    await fireEvent.press(screen.getByText('Fromage'));
    await fireEvent.press(screen.getByText('Oeuf'));
    await fireEvent.press(screen.getByLabelText('Augmenter la quantité'));
    await fireEvent.changeText(screen.getByPlaceholderText('Ex. bien cuit, sauce à part'), 'Bien cuit');
    expect(screen.getByText('Ajouter · 119 MAD')).toBeTruthy(); // (50 + 5 + 4,50) x 2
    await fireEvent.press(screen.getByText('Ajouter · 119 MAD'));
    expect(screen.getByTestId('meal-added')).toHaveTextContent(/Ajouté au panier/);
    const [line] = useCartStore.getState().items;
    expect(line).toMatchObject({ mealId: 'bowl', quantity: 2, price: 59.5, notes: 'Bien cuit' });
    expect(line.options.map((o) => o.name)).toEqual(['Harissa', 'Fromage', 'Oeuf']);
    await fireEvent.press(screen.getByText('Voir le panier'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/cart');
  });

  it('a meal without choices is added directly', async () => {
    mockDetail.mockResolvedValue({ ok: true, meal: { ...MEAL, description: null }, groups: [] });
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Ajouter · 50 MAD')).toBeTruthy());
    await fireEvent.press(screen.getByText('Ajouter · 50 MAD'));
    expect(useCartStore.getState().items).toMatchObject([{ mealId: 'bowl', options: [], quantity: 1 }]);
  });

  it('edits an existing cart line in place', async () => {
    useCartStore.getState().addItem({ id: 'bowl', name: 'Bol poulet', price: 50, calories: 500, protein: 30, options: [{ id: 's1', name: 'Harissa', group: 'Sauce', price: 0 }] }, 1);
    mockParams.line = useCartStore.getState().items[0].id;
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Mettre à jour · 50 MAD')).toBeTruthy());
    await fireEvent.press(screen.getByText('Algérienne'));
    await fireEvent.press(screen.getByText('Mettre à jour · 50 MAD'));
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].options.map((o) => o.name)).toEqual(['Algérienne']);
    expect(mockBack).toHaveBeenCalled();
  });

  it('a meal that cannot be loaded shows a retry, not fake data', async () => {
    mockDetail.mockResolvedValue({ ok: false, reason: 'error' });
    await render(<MealScreen />);
    await waitFor(() => expect(screen.getByText('Impossible de charger ce plat')).toBeTruthy());
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });
});
