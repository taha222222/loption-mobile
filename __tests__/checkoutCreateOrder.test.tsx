// Trusted order creation on the client: only meal ids, quantities and notes
// are sent to create_order(); a retry reuses the request id; the server's
// refusals are shown, never a fake success. The checkout switch is forced
// open here to test the path that opens once pricing is approved; the real
// switch stays closed (checkoutScreen.test.tsx).
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { classifyCreateOrderError, createOrder, fetchActivePricing, toOrderLines } from '../src/services/checkoutApi';
import CheckoutScreen from '../app/(app)/checkout';
import { useCartStore } from '../src/stores/cartStore';
import { useUserStore } from '../src/stores/userStore';

jest.mock('../src/checkout/checkoutAvailability', () => ({
  CHECKOUT_OPEN: true,
  CHECKOUT_CLOSED_TITLE: 'closed',
  CHECKOUT_CLOSED_MESSAGE: 'closed',
}));
const mockRpc = jest.fn();
const mockPricing: { rows: Record<string, unknown>[] } = { rows: [] };
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: async () => ({ data: mockPricing.rows, error: null }) }),
  },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `req-${++mockUuid}` }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a) } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  mockPricing.rows = [{ kitchen_id: 'kA', delivery_fee: '10.00', service_fee: '5.00', minimum_subtotal: '40.00' }];
  useUserStore.setState({ profile: { delivery_address: '12 Rue Test' } as never });
  useCartStore.setState({
    ownerId: 'u1',
    items: [{ id: 'meal-1', name: 'Bol', price: 60, calories: 450, protein: 35, quantity: 2, notes: ' sans oignon ' }],
  });
});

describe('create_order service', () => {
  it('sends meal ids, quantities and notes only (never a price)', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'order-1', error: null });
    const r = await createOrder({ kitchenId: 'kA', requestId: 'req', items: [{ mealId: 'm1', quantity: 2, notes: ' x ' }] });
    expect(r).toEqual({ ok: true, orderId: 'order-1' });
    expect(mockRpc).toHaveBeenCalledWith('create_order', {
      p_kitchen: 'kA', p_items: [{ meal_id: 'm1', quantity: 2, notes: 'x' }], p_client_request_id: 'req', p_note: null,
    });
    expect(JSON.stringify(toOrderLines([{ mealId: 'm', quantity: 1 }]))).not.toMatch(/price|total|fee/);
  });

  it('maps the server refusals', () => {
    expect(classifyCreateOrderError({ code: '55000', message: 'ordering is not open' })).toBe('closed');
    expect(classifyCreateOrderError({ code: '22023', message: 'meal x is not available' })).toBe('invalid');
    expect(classifyCreateOrderError({ code: '42501', message: 'staff accounts cannot place customer orders' })).toBe('not_allowed');
    expect(classifyCreateOrderError({ code: 'PGRST202', message: 'Could not find the function' })).toBe('not_available');
    expect(classifyCreateOrderError({ message: 'Network request failed' })).toBe('network');
  });

  it('reads the approved pricing, and nothing when none (or several kitchens) is approved', async () => {
    expect(await fetchActivePricing()).toEqual({ kitchenId: 'kA', deliveryFee: 10, serviceFee: 5, minimumSubtotal: 40 });
    mockPricing.rows = [];
    expect(await fetchActivePricing()).toBeNull();
    mockPricing.rows = [{ kitchen_id: 'kA' }, { kitchen_id: 'kB' }];
    expect(await fetchActivePricing()).toBeNull();
  });
});

describe('checkout once open', () => {
  it('shows the approved fees, orders through create_order and opens the tracking', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'order-9', error: null });
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByText('10 MAD')).toBeTruthy());
    expect(screen.getByText('5 MAD')).toBeTruthy();
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/order-tracking/order-9'));
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_kitchen: 'kA', p_items: [{ meal_id: 'meal-1', quantity: 2, notes: 'sans oignon' }] });
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('a retry after a lost answer reuses the request id (no second order); a refusal keeps the cart', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'the minimum order is 40 MAD' } });
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByText('10 MAD')).toBeTruthy());
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(screen.getByText(/elle ne sera pas doublée/)).toBeTruthy());
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(screen.getByText(/the minimum order is 40 MAD/)).toBeTruthy());
    expect(mockRpc.mock.calls[0][1].p_client_request_id).toBe(mockRpc.mock.calls[1][1].p_client_request_id);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('stays disabled without approved pricing', async () => {
    mockPricing.rows = [];
    await render(<CheckoutScreen />);
    await fireEvent.press(screen.getByText('Place Order'));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
