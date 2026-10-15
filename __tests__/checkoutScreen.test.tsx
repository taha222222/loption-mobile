import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CheckoutScreen from '../app/(app)/checkout';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';

const mockInserts: Record<string, any[]> = {};
const mockSupabase = {
  from: jest.fn((table: string) => ({
    insert: (payload: any) => {
      (mockInserts[table] ??= []).push(payload);
      const result = table === 'orders' ? { data: { id: 'order-1', ...payload }, error: null } : { error: null };
      return Object.assign(Promise.resolve(result), {
        select: () => ({ single: async () => result }),
      });
    },
  })),
};

// Lazy getter: jest.mock is hoisted above the mockSupabase declaration.
jest.mock('../src/lib/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));
jest.mock('../src/services/notificationService', () => ({
  notificationService: { sendToAllOnlineDrivers: jest.fn(async () => {}) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

beforeEach(() => {
  for (const key of Object.keys(mockInserts)) delete mockInserts[key];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useAuthStore.setState({ user: { id: 'user-1' } as any });
  useCartStore.setState({
    ownerId: 'user-1',
    items: [{ id: 'meal-1', name: 'Chicken Bowl', price: 60, calories: 450, protein: 35, quantity: 2 }],
  });
});

describe('Checkout (COD only)', () => {
  it('offers Cash on Delivery and no card option', async () => {
    await render(<CheckoutScreen />);
    expect(screen.getByTestId('payment-method-cod')).toBeTruthy();
    expect(screen.getByText('Cash on Delivery')).toBeTruthy();
    expect(screen.queryByText(/credit|debit/i)).toBeNull();
    expect(screen.queryByText('Credit/Debit Card')).toBeNull();
  });

  it('submits the order as COD and does not mark it paid', async () => {
    await render(<CheckoutScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Enter your full address'), '12 Rue Test, Casablanca');
    await fireEvent.press(screen.getByText(/Place Order/));

    await waitFor(() => expect(mockInserts.order_items).toHaveLength(1));
    expect(mockInserts.orders).toHaveLength(1);
    const order = mockInserts.orders[0];
    expect(order.payment_method).toBe('cash');
    expect(order.user_id).toBe('user-1');

    // The insert sent to Supabase has exactly these keys: no paid flag,
    // payment status or transaction field can be added without failing here.
    expect(Object.keys(order).sort()).toEqual(
      [
        'created_at',
        'delivery_address',
        'delivery_fee',
        'order_number',
        'payment_method',
        'status',
        'subtotal',
        'total',
        'user_id',
      ].sort()
    );
    for (const field of ['paid', 'is_paid', 'paid_at', 'payment_status', 'paymentStatus', 'payment_state', 'transaction_id']) {
      expect(order).not.toHaveProperty(field);
    }
    for (const key of Object.keys(order)) {
      expect(key).not.toMatch(/paid|pay(ment)?[_-]?(status|state)|transaction|settle/i);
    }
    expect(Alert.alert).toHaveBeenCalledWith('Order Placed!', expect.any(String), expect.any(Array));
  });
});
