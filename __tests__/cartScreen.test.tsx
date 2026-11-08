// Mon panier: lines with choices and notes, quantity and removal update the
// subtotal at once, fees are announced as calculated later (never a fake
// total), nutrition stays secondary, and "Continuer" leads to delivery details
// (cash on delivery: no payment wording).
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CartScreen from '../app/(app)/cart';
import { useCartStore } from '../src/stores/cartStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const bowl = { id: 'bowl', name: 'Bol poulet', price: 50, calories: 500, protein: 30, image: 'https://img.test/bowl.jpg' };
const sauce = { id: 's1', name: 'Harissa', group: 'Sauce', price: 0 };
const cheese = { id: 'e1', name: 'Fromage', group: 'Suppléments', price: 5 };

beforeEach(() => {
  jest.clearAllMocks();
  useCartStore.setState({ ownerId: 'u', items: [] });
});

const subtotal = () => screen.getByTestId('cart-subtotal');

describe('Mon panier', () => {
  it('empty: says so and leads to the menu', async () => {
    await render(<CartScreen />);
    expect(screen.getByText('Votre panier est vide')).toBeTruthy();
    await fireEvent.press(screen.getByText('Voir le menu'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/menu');
  });

  it('shows each line with its choices, note and total; the same meal with other choices is another line', async () => {
    useCartStore.getState().addItem({ ...bowl, options: [sauce], notes: 'Bien cuit' }, 1);
    useCartStore.getState().addItem({ ...bowl, options: [sauce, cheese] }, 2);
    await render(<CartScreen />);
    expect(screen.getByText('Mon panier (3)')).toBeTruthy();
    expect(screen.getAllByText('Bol poulet')).toHaveLength(2);
    expect(screen.getByText('Harissa')).toBeTruthy();
    expect(screen.getByText('Harissa · Fromage (+5 MAD)')).toBeTruthy();
    expect(screen.getByText('Note : Bien cuit')).toBeTruthy();
    expect(subtotal()).toHaveTextContent('160 MAD'); // 50 + 2 x 55
    expect(screen.getByText('dont options')).toBeTruthy();
    expect(screen.getByText('10 MAD')).toBeTruthy(); // 2 x 5 for the cheese
  });

  it('never presents the subtotal as the amount to pay; fees are announced as calculated later', async () => {
    useCartStore.getState().addItem(bowl, 2);
    await render(<CartScreen />);
    expect(screen.getByText('Sous-total produits')).toBeTruthy();
    expect(screen.getByText('Calculés à l’étape suivante')).toBeTruthy();
    expect(screen.getByText('Calculés après confirmation de l’adresse')).toBeTruthy();
    expect(screen.getByText('TVA incluse dans les prix affichés.')).toBeTruthy();
    expect(screen.queryByText(/Total produits|Total à payer/)).toBeNull();
    expect(screen.queryByText(/paiement/i)).toBeNull(); // cash on delivery: no payment step
    expect(screen.getByTestId('cart-nutrition')).toHaveTextContent('Apport estimé : 1 000 kcal · 60 g de protéines');
  });

  it('quantity changes update the line and the subtotal at once', async () => {
    useCartStore.getState().addItem({ ...bowl, options: [cheese] }, 1);
    const id = useCartStore.getState().items[0].id;
    await render(<CartScreen />);
    expect(subtotal()).toHaveTextContent('55 MAD');
    await fireEvent.press(screen.getByLabelText('Augmenter la quantité de Bol poulet'));
    expect(screen.getByTestId(`cart-line-total-${id}`)).toHaveTextContent('110 MAD');
    expect(subtotal()).toHaveTextContent('110 MAD');
    await fireEvent.press(screen.getByLabelText('Diminuer la quantité de Bol poulet'));
    expect(subtotal()).toHaveTextContent('55 MAD');
  });

  it('removes a line, edits a line on its product page, clears with confirmation', async () => {
    useCartStore.getState().addItem({ ...bowl, options: [sauce] }, 1);
    useCartStore.getState().addItem({ id: 'salad', name: 'Salade', price: 40, calories: 300, protein: 10 }, 1);
    const line = useCartStore.getState().items[0];
    await render(<CartScreen />);
    await fireEvent.press(screen.getByLabelText('Modifier Bol poulet'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/meal/[id]', params: { id: 'bowl', line: line.id } });
    await fireEvent.press(screen.getByLabelText('Retirer Salade'));
    expect(useCartStore.getState().items.map((i) => i.name)).toEqual(['Bol poulet']);
    expect(subtotal()).toHaveTextContent('50 MAD');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    await fireEvent.press(screen.getByLabelText('Vider le panier'));
    expect(alert).toHaveBeenCalledWith('Vider le panier', expect.any(String), expect.any(Array));
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('"Continuer" opens delivery details', async () => {
    useCartStore.getState().addItem(bowl, 1);
    await render(<CartScreen />);
    await fireEvent.press(screen.getByText('Continuer'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/checkout');
  });
});
