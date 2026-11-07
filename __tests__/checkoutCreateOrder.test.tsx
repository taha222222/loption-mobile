// Trusted order creation on the client: only meal ids, quantities and notes
// are sent to create_order(), with the kitchen of the server's delivery
// quote; a retry reuses the request id; the server's refusals are shown,
// never a fake success. The fees shown come from the server only. The checkout switch is forced
// open here to test the path that opens once pricing is approved; the real
// switch stays closed (checkoutScreen.test.tsx).
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  classifyCreateOrderError,
  createOrder,
  fetchActivePricing,
  requestDeliveryQuote,
  toOrderLines,
} from '../src/services/checkoutApi';
import CheckoutScreen from '../app/(app)/checkout';
import { useCartStore } from '../src/stores/cartStore';
import { useUserStore } from '../src/stores/userStore';

jest.mock('../src/checkout/checkoutAvailability', () => ({
  CHECKOUT_OPEN: true,
  CHECKOUT_CLOSED_TITLE: 'closed',
  CHECKOUT_CLOSED_MESSAGE: 'closed',
}));
const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockPricing: { rows: Record<string, unknown>[] } = { rows: [] };
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: async () => ({ data: mockPricing.rows, error: null }) }),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
  },
}));
const QUOTE = {
  quote_id: 'q1', kitchen_id: 'kQ', distance_km: 5, delivery_fee: '16.00', service_fee: '3.00',
  formula_version: 'v1_road_km', config_version: 'v1', expires_at: '2026-11-07T12:15:00Z',
};
const quoteOk = () => ({ data: { ok: true, quote: QUOTE }, error: null });
const quoteRefused = (reason: string) => ({ data: null, error: { context: { json: async () => ({ ok: false, reason }) } } });
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `req-${++mockUuid}` }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a) } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  mockPricing.rows = [{ kitchen_id: 'kA', service_fee: '3.00', delivery_min_fee: '10.00', delivery_max_fee: '25.00', config_version: 'v1' }];
  mockInvoke.mockResolvedValue(quoteOk());
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
    expect(classifyCreateOrderError({ code: '55000', message: 'ordering is not open: the tax treatment of the service and delivery fees is not approved' })).toBe('closed');
    expect(classifyCreateOrderError({ code: '55000', message: 'delivery quote required: the road distance to your address must be calculated first' })).toBe('quote_required');
    expect(classifyCreateOrderError({ code: '22023', message: 'meal x is not available' })).toBe('invalid');
    expect(classifyCreateOrderError({ code: '42501', message: 'staff accounts cannot place customer orders' })).toBe('not_allowed');
    expect(classifyCreateOrderError({ code: 'PGRST202', message: 'Could not find the function' })).toBe('not_available');
    expect(classifyCreateOrderError({ message: 'Network request failed' })).toBe('network');
  });

  it('reads the approved pricing, and nothing when none (or several kitchens) is approved', async () => {
    expect(await fetchActivePricing()).toEqual({ kitchenId: 'kA', serviceFee: 3, deliveryMinFee: 10, deliveryMaxFee: 25, configVersion: 'v1' });
    mockPricing.rows = [];
    expect(await fetchActivePricing()).toBeNull();
    mockPricing.rows = [{ kitchen_id: 'kA' }, { kitchen_id: 'kB' }];
    expect(await fetchActivePricing()).toBeNull();
  });
});

describe('delivery quote service', () => {
  it('asks the server with no body (no address, distance or fee is sent) and reads the server quote', async () => {
    const r = await requestDeliveryQuote();
    expect(mockInvoke).toHaveBeenCalledWith('quote-delivery', { method: 'POST' });
    expect(r).toEqual({
      ok: true,
      quote: { quoteId: 'q1', kitchenId: 'kQ', distanceKm: 5, deliveryFee: 16, serviceFee: 3, expiresAt: '2026-11-07T12:15:00Z' },
    });
  });

  it.each([
    ['routing_unavailable', /distance de livraison est indisponible/],
    ['invalid_address', /ne trouvons pas précisément votre adresse/],
    ['out_of_zone', /pas encore disponible dans votre ville/],
    ['closed', /pas encore ouverte/],
  ])('shows the server refusal %s', async (reason, text) => {
    mockInvoke.mockResolvedValueOnce(quoteRefused(reason));
    const r = await requestDeliveryQuote();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(reason);
      expect(r.message).toMatch(text);
    }
  });

  it('a lost connection or an unknown answer is never a quote', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Network request failed'));
    expect((await requestDeliveryQuote()).ok).toBe(false);
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, quote: { delivery_fee: 0 } }, error: null });
    expect(await requestDeliveryQuote()).toMatchObject({ ok: false, reason: 'other' });
    mockInvoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ reason: 'free_delivery' }) } } });
    expect(await requestDeliveryQuote()).toMatchObject({ ok: false, reason: 'other' });
  });
});

describe('checkout once open', () => {
  it('shows subtotal, service fee, delivery fee and total from the server, orders with the quote kitchen and opens the tracking', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'order-9', error: null });
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('16 MAD'));
    expect(screen.getByText('Frais de livraison (5.0 km)')).toBeTruthy();
    expect(screen.getByText('3 MAD')).toBeTruthy();
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('139 MAD'); // 120 + 3 + 16
    expect(screen.getByText('TVA incluse dans les prix affichés.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/order-tracking/order-9'));
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_kitchen: 'kQ', p_items: [{ meal_id: 'meal-1', quantity: 2, notes: 'sans oignon' }] });
    expect(JSON.stringify(mockRpc.mock.calls[0][1])).not.toMatch(/price|total|fee|tax|distance/);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('a retry after a lost answer reuses the request id (no second order); a refusal keeps the cart', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'meal x is not available' } });
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('16 MAD'));
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(screen.getByText(/elle ne sera pas doublée/)).toBeTruthy());
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(screen.getByText(/meal x is not available/)).toBeTruthy());
    expect(mockRpc.mock.calls[0][1].p_client_request_id).toBe(mockRpc.mock.calls[1][1].p_client_request_id);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a used or stale quote is refused by the server: the quote is asked again', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '55000', message: 'delivery quote required: the road distance to your address must be calculated first' } });
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('16 MAD'));
    await fireEvent.press(screen.getByText('Place Order'));
    await waitFor(() => expect(screen.getByText(/doivent être recalculés/)).toBeTruthy());
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
  });

  it('stays disabled without a server quote (routing down: fail closed, no fee invented)', async () => {
    mockInvoke.mockResolvedValue(quoteRefused('routing_unavailable'));
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByTestId('checkout-quote-message')).toBeTruthy());
    expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('À confirmer');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('Calculé à la commande');
    await fireEvent.press(screen.getByText('Place Order'));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('stays disabled without a confirmed address', async () => {
    useUserStore.setState({ profile: { delivery_address: null } as never });
    await render(<CheckoutScreen />);
    await waitFor(() => expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('16 MAD'));
    expect(screen.getByText('Aucune adresse confirmée')).toBeTruthy();
    await fireEvent.press(screen.getByText('Place Order'));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
