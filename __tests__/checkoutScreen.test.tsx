// Checkout is locked (owner decision 2026-11-05) until public.create_order()
// exists and pricing is approved: the screen writes nothing and shows no
// unapproved fee.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CheckoutScreen from '../app/(app)/checkout';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { CHECKOUT_CLOSED_TITLE, CHECKOUT_OPEN } from '../src/checkout/checkoutAvailability';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a), rpc: (...a: unknown[]) => mockRpc(...a) },
}));
const mockNotify = jest.fn();
jest.mock('../src/services/notificationService', () => ({
  notificationService: { sendToAllOnlineDrivers: (...a: unknown[]) => mockNotify(...a) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));
const mockServed: { list: string[] | null } = { list: ['casablanca'] };
jest.mock('../src/delivery/cities', () => ({
  ...jest.requireActual('../src/delivery/cities'),
  fetchServedCities: async () => mockServed.list,
}));

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: { id: 'user-1' } as never });
  useCartStore.setState({
    ownerId: 'user-1',
    items: [{ id: 'meal-1', name: 'Chicken Bowl', price: 60, calories: 450, protein: 35, quantity: 2 }],
  });
});

describe('Checkout lockdown', () => {
  it('is closed until the server creates orders', () => {
    expect(CHECKOUT_OPEN).toBe(false);
  });

  it('shows why ordering is closed, keeps cash on delivery as the only method, and shows no unapproved fee', async () => {
    await render(<CheckoutScreen />);
    expect(screen.getByTestId('checkout-closed')).toBeTruthy();
    expect(screen.getByText(CHECKOUT_CLOSED_TITLE)).toBeTruthy();
    expect(screen.getByTestId('payment-method-cod')).toBeTruthy();
    expect(screen.queryByText(/credit|debit/i)).toBeNull();
    expect(screen.getAllByText('120 MAD')).toHaveLength(2); // line and subtotal of menu prices, for information
    expect(screen.queryByText(/15 MAD/)).toBeNull(); // the old unapproved delivery fee
    expect(screen.getByText('À confirmer')).toBeTruthy();
  });

  it('tells a customer outside Casablanca that delivery is not available in their city yet', async () => {
    const { useUserStore } = jest.requireActual('../src/stores/userStore');
    useUserStore.setState({ profile: { delivery_city: 'marrakech', delivery_address: 'Gueliz' } });
    await render(<CheckoutScreen />);
    expect(await screen.findByTestId('checkout-out-of-zone')).toBeTruthy();
    expect(screen.getByText(/La livraison n’est pas encore disponible à Marrakech/)).toBeTruthy();
    useUserStore.setState({ profile: { delivery_city: 'casablanca', delivery_address: 'Maarif' } });
  });

  it('the Place Order button is disabled and pressing it writes nothing', async () => {
    await render(<CheckoutScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Enter your full address'), '12 Rue Test, Casablanca');
    const button = screen.getByText('Place Order');
    await fireEvent.press(button);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toHaveLength(1); // the cart is kept
  });
});
