// The checkout once it opens (switch forced open here; the real switch stays
// closed, see checkoutScreen.test.tsx): address, WhatsApp-verified phone,
// server-priced summary, promo code, and create_order() with the total the
// customer saw. The app sends ids, quantities, choices and notes only.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  classifyCreateOrderError,
  createOrder,
  describeInvalidCart,
  fetchActivePricing,
  previewCheckout,
  requestDeliveryQuote,
  toOrderLines,
} from '../src/services/checkoutApi';
import CheckoutScreen from '../app/(app)/checkout';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { useUserStore } from '../src/stores/userStore';
import { useCheckoutDraftStore } from '../src/stores/checkoutDraftStore';

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
jest.mock('../src/delivery/cities', () => ({
  ...jest.requireActual('../src/delivery/cities'),
  fetchServedCities: async () => ['casablanca'],
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `req-${++mockUuid}` }));
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a) } }));

const QUOTE = {
  quote_id: 'q1', kitchen_id: 'kQ', distance_km: 5, delivery_fee: '16.00', service_fee: '3.00',
  formula_version: 'v1_road_km', config_version: 'v1', expires_at: '2026-11-07T12:15:00Z',
};
const quoteOk = () => ({ data: { ok: true, quote: QUOTE }, error: null });
const refused = (reason: string) => ({ data: null, error: { context: { json: async () => ({ ok: false, reason }) } } });

// The server's preview (checkout_preview) for 2 x Bowl with Harissa + Fromage (+5).
const preview = (o: Partial<Record<string, unknown>> = {}) => ({
  kitchen_id: 'kQ',
  lines: [{ meal_id: 'meal-1', name: 'Bol', quantity: 2, unit_price: 65, line_total_ttc: 130, line_discount: 0,
            options: [{ name: 'Harissa', group: 'Sauce', price: 0 }, { name: 'Fromage', group: 'Suppléments', price: 5 }] }],
  products_subtotal: 130, promo: { code: null, status: 'none', discount: 0 }, first_order: false,
  service_fee: 3, service_fee_before_discount: 3, delivery_fee: 16, delivery_fee_before_discount: 16,
  distance_km: 5, total: 149, address: '12 Rue Test, Casablanca', city: 'casablanca',
  phone: { e164: '+212612345678', verified: true }, ...o,
});

function rpcHandler(overrides: Record<string, (args: any) => unknown> = {}) {
  mockRpc.mockImplementation(async (name: string, args: any) => {
    if (overrides[name]) return overrides[name](args);
    if (name === 'checkout_preview') return { data: preview(), error: null };
    if (name === 'create_order') return { data: 'order-9', error: null };
    return { data: null, error: { code: 'XX000', message: 'unexpected ' + name } };
  });
}

const verifiedProfile = { delivery_address: '12 Rue Test, Casablanca', delivery_city: 'casablanca', phone_e164: '+212612345678', phone_verified_at: '2026-11-07T10:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  useCheckoutDraftStore.getState().reset();
  mockPricing.rows = [{ kitchen_id: 'kA', service_fee: '3.00', delivery_min_fee: '10.00', delivery_max_fee: '25.00', config_version: 'v1' }];
  mockInvoke.mockImplementation(async (name: string) => (name === 'quote-delivery' ? quoteOk() : refused('other')));
  rpcHandler();
  useAuthStore.setState({ user: { id: 'u1' } as never });
  useUserStore.setState({ profile: { ...verifiedProfile } as never, loadProfile: jest.fn(async () => undefined) as never });
  useCartStore.setState({ ownerId: 'u1', items: [] });
  useCartStore.getState().addItem(
    { id: 'meal-1', name: 'Bol', price: 60, calories: 450, protein: 35, notes: ' sans oignon ',
      options: [{ id: 'o-har', name: 'Harissa', group: 'Sauce', price: 0 }, { id: 'o-fro', name: 'Fromage', group: 'Suppléments', price: 5 }] },
    2,
  );
});

async function toSummary() {
  await render(<CheckoutScreen />);
  await fireEvent.press(screen.getByText('Livrer à cette adresse'));
  await waitFor(() => expect(screen.getByTestId('checkout-total')).toBeTruthy());
}

describe('order service', () => {
  it('sends meal ids, choice ids, quantities, notes, the promo code and the total shown; never a price or fee', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'order-1', error: null });
    const r = await createOrder({ kitchenId: 'kA', requestId: 'req', expectedTotal: 149, promoCode: ' test10 ',
      items: [{ mealId: 'm1', quantity: 2, notes: ' x ', optionIds: ['o2', 'o1'] }] });
    expect(r).toEqual({ ok: true, orderId: 'order-1' });
    expect(mockRpc).toHaveBeenCalledWith('create_order', {
      p_kitchen: 'kA', p_items: [{ meal_id: 'm1', quantity: 2, notes: 'x', option_ids: ['o2', 'o1'] }],
      p_client_request_id: 'req', p_note: null, p_promo_code: 'test10', p_expected_total: 149,
    });
    expect(JSON.stringify(toOrderLines([{ mealId: 'm', quantity: 1 }]))).not.toMatch(/price|total|fee|tax|distance/);
  });

  it('maps the server refusals, in the customer’s words', () => {
    expect(classifyCreateOrderError({ code: '55000', message: 'ordering is not open' })).toBe('closed');
    expect(classifyCreateOrderError({ code: '55000', message: 'delivery quote required: …' })).toBe('quote_required');
    expect(classifyCreateOrderError({ code: '40001', message: 'the order total changed' })).toBe('total_changed');
    expect(classifyCreateOrderError({ code: '22023', message: 'a verified phone number is required' })).toBe('phone_required');
    expect(classifyCreateOrderError({ code: '22023', message: 'promo code not accepted: expired' })).toBe('promo_rejected');
    expect(classifyCreateOrderError({ code: '22023', message: 'meal x is not available' })).toBe('invalid');
    expect(classifyCreateOrderError({ code: 'PGRST202', message: 'Could not find the function' })).toBe('not_available');
    expect(classifyCreateOrderError({ message: 'Network request failed' })).toBe('network');
    expect(describeInvalidCart('choose the required options for Bol')).toBe('Choisissez les options obligatoires de « Bol ».');
    expect(describeInvalidCart('meal 123 is not available')).toMatch(/n’est plus disponible/);
    expect(describeInvalidCart('anything else')).not.toMatch(/[a-z]+ [a-z]+ (is|are) /); // never English
  });

  it('reads the approved pricing, and nothing when none (or several kitchens) is approved', async () => {
    expect(await fetchActivePricing()).toEqual({ kitchenId: 'kA', serviceFee: 3, deliveryMinFee: 10, deliveryMaxFee: 25, configVersion: 'v1' });
    mockPricing.rows = [];
    expect(await fetchActivePricing()).toBeNull();
  });

  it('maps the server preview (no recomputation on the phone)', async () => {
    const r = await previewCheckout({ kitchenId: 'kQ', items: [{ mealId: 'meal-1', quantity: 2, optionIds: ['o-har'] }], promoCode: 'X' });
    expect(mockRpc).toHaveBeenCalledWith('checkout_preview', { p_kitchen: 'kQ', p_items: [{ meal_id: 'meal-1', quantity: 2, notes: null, option_ids: ['o-har'] }], p_promo_code: 'X' });
    expect(r.ok && r.preview.total).toBe(149);
    expect(r.ok && r.preview.lines[0].options.map((o) => o.name)).toEqual(['Harissa', 'Fromage']);
  });

  it('a delivery quote is asked with no body (no address, distance or fee is sent)', async () => {
    await requestDeliveryQuote();
    expect(mockInvoke).toHaveBeenCalledWith('quote-delivery', { method: 'POST' });
  });
});

describe('checkout steps', () => {
  it('address -> (verified phone) -> summary priced by the server; confirming sends the total shown', async () => {
    await render(<CheckoutScreen />);
    expect(screen.getByTestId('checkout-address')).toHaveTextContent(/12 Rue Test, Casablanca/);
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toHaveTextContent('149 MAD'));
    expect(screen.getByText('Récapitulatif de votre commande')).toBeTruthy();
    expect(screen.getByText('Harissa · Fromage (+5 MAD)')).toBeTruthy();
    expect(screen.getByText('TVA incluse dans les prix affichés. Livraison calculée sur 5,0 km.')).toBeTruthy();
    expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('16 MAD');
    expect(screen.getByText('Paiement à la livraison')).toBeTruthy();
    expect(screen.getByText('Montant à payer : 149 MAD')).toBeTruthy();
    expect(screen.getByText('06 12 34 56 78 · vérifié')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirmer ma commande · 149 MAD'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/order-tracking/order-9'));
    const call = mockRpc.mock.calls.find((c) => c[0] === 'create_order')![1];
    expect(call).toMatchObject({ p_kitchen: 'kQ', p_expected_total: 149, p_promo_code: null,
      p_items: [{ meal_id: 'meal-1', quantity: 2, notes: 'sans oignon', option_ids: ['o-har', 'o-fro'] }] });
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('first qualifying order: service and delivery shown as offered (struck through), total = products', async () => {
    rpcHandler({ checkout_preview: () => ({ data: preview({ first_order: true, service_fee: 0, delivery_fee: 0, total: 130 }), error: null }) });
    await toSummary();
    expect(screen.getAllByText('Offerts')).toHaveLength(2);
    expect(screen.getByText('3 MAD')).toBeTruthy(); // struck-through service fee
    expect(screen.getByText('16 MAD')).toBeTruthy(); // struck-through delivery fee
    expect(screen.getByTestId('checkout-delivery-fee')).toHaveTextContent('Offerts');
    expect(screen.getByText('Première commande : service et livraison offerts.')).toBeTruthy();
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('130 MAD');
  });

  it('a changed total is not ordered: the new server total is shown before the customer confirms again', async () => {
    let previews = 0;
    rpcHandler({
      checkout_preview: () => ({ data: previews++ === 0 ? preview() : preview({ total: 152, delivery_fee: 19 }), error: null }),
      create_order: () => ({ data: null, error: { code: '40001', message: 'the order total changed' } }),
    });
    await toSummary();
    await fireEvent.press(screen.getByText('Confirmer ma commande · 149 MAD'));
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toHaveTextContent('152 MAD'));
    expect(screen.getByTestId('checkout-order-message')).toHaveTextContent(/Le total de votre commande a changé/);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('a retry after a lost answer reuses the request id (no duplicate order)', async () => {
    let calls = 0;
    rpcHandler({ create_order: () => (calls++ === 0 ? Promise.reject(new Error('Network request failed')) : { data: 'order-9', error: null }) });
    await toSummary();
    await fireEvent.press(screen.getByText('Confirmer ma commande · 149 MAD'));
    await waitFor(() => expect(screen.getByTestId('checkout-order-message')).toHaveTextContent(/elle ne sera pas doublée/));
    await fireEvent.press(screen.getByText('Confirmer ma commande · 149 MAD'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const ids = mockRpc.mock.calls.filter((c) => c[0] === 'create_order').map((c) => c[1].p_client_request_id);
    expect(ids).toEqual(['req-1', 'req-1']);
  });

  it('routing unavailable: no fee is guessed and nothing can be confirmed', async () => {
    mockInvoke.mockImplementation(async () => refused('routing_unavailable'));
    await render(<CheckoutScreen />);
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    await waitFor(() => expect(screen.getByTestId('checkout-quote-message')).toHaveTextContent(/distance de livraison est indisponible/));
    expect(screen.queryByText(/Confirmer ma commande/)).toBeNull();
    expect(mockRpc).not.toHaveBeenCalledWith('create_order', expect.anything());
  });

  it('promo code: refused codes are explained; a valid one shows its discount and is sent with the order', async () => {
    rpcHandler({
      checkout_preview: (a) =>
        a.p_promo_code === 'NOPE'
          ? { data: preview({ promo: { code: 'NOPE', status: 'invalid', discount: 0 } }), error: null }
          : a.p_promo_code === 'TEST10'
            ? { data: preview({ promo: { code: 'TEST10', status: 'valid', discount: 8 }, total: 141 }), error: null }
            : { data: preview(), error: null },
    });
    await toSummary();
    await fireEvent.changeText(screen.getByLabelText('Code promo'), 'nope');
    await fireEvent.press(screen.getByText('Appliquer'));
    await waitFor(() => expect(screen.getByTestId('checkout-promo-message')).toHaveTextContent('Ce code promo n’existe pas ou n’est plus actif.'));
    await fireEvent.changeText(screen.getByLabelText('Code promo'), 'test10');
    await fireEvent.press(screen.getByText('Appliquer'));
    await waitFor(() => expect(screen.getByText('Réduction (TEST10)')).toBeTruthy());
    expect(screen.getByText('-8 MAD')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirmer ma commande · 141 MAD'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockRpc.mock.calls.find((c) => c[0] === 'create_order')![1]).toMatchObject({ p_promo_code: 'TEST10', p_expected_total: 141 });
  });

  it('going back to the cart keeps the step and the accepted promo code; a changed basket is priced again', async () => {
    rpcHandler({
      checkout_preview: (a) =>
        a.p_promo_code === 'TEST10'
          ? { data: preview({ promo: { code: 'TEST10', status: 'valid', discount: 8 }, total: 141 }), error: null }
          : { data: preview(), error: null },
    });
    await toSummary();
    await fireEvent.changeText(screen.getByLabelText('Code promo'), 'test10');
    await fireEvent.press(screen.getByText('Appliquer'));
    await waitFor(() => expect(screen.getByText('Réduction (TEST10)')).toBeTruthy());
    await fireEvent.press(screen.getByText('Modifier le panier'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/cart');
    expect(useCheckoutDraftStore.getState()).toMatchObject({ step: 'summary', promoCode: 'TEST10' });
    const count = () => mockRpc.mock.calls.filter((c) => c[0] === 'checkout_preview').length;
    const before = count();
    useCartStore.getState().updateQuantity(useCartStore.getState().items[0].id, 3);
    await waitFor(() => expect(count()).toBe(before + 1));
    const last = mockRpc.mock.calls.filter((c) => c[0] === 'checkout_preview').pop()![1];
    expect(last).toMatchObject({ p_promo_code: 'TEST10', p_items: [expect.objectContaining({ quantity: 3 })] });
  });

  it('a double tap sends one order; after the order the checkout starts over', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    rpcHandler({ create_order: () => new Promise((r) => (resolve = r)) });
    await toSummary();
    const button = screen.getByText('Confirmer ma commande · 149 MAD');
    await fireEvent.press(button);
    await fireEvent.press(button);
    resolve({ data: 'order-9', error: null });
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockRpc.mock.calls.filter((c) => c[0] === 'create_order')).toHaveLength(1);
    expect(useCheckoutDraftStore.getState()).toMatchObject({ step: 'address', promoCode: null });
  });

  it('without an address the customer must add one first (manual entry or position, confirmed)', async () => {
    useUserStore.setState({ profile: { delivery_address: null, delivery_city: null } as never });
    await render(<CheckoutScreen />);
    expect(screen.getByText('Ajoutez votre adresse de livraison pour continuer.')).toBeTruthy(); // why the button is disabled
    await fireEvent.press(screen.getByText('Ajouter une adresse de livraison'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/delivery-address');
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('WhatsApp phone verification', () => {
  beforeEach(() => {
    useUserStore.setState({ profile: { delivery_address: '12 Rue Test, Casablanca', delivery_city: 'casablanca', phone: '06 12 34 56 78' } as never });
  });

  it('sends the code to the normalised number, verifies it on the server, then shows the summary', async () => {
    mockInvoke.mockImplementation(async (name: string, opts: any) =>
      name === 'phone-otp'
        ? { data: { ok: true, verification_id: 'v1', phone_e164: '+212612345678', expires_at: 'x' }, error: null }
        : quoteOk(),
    );
    const loadProfile = jest.fn(async () => useUserStore.setState({ profile: { ...verifiedProfile } as never }));
    useUserStore.setState({ loadProfile: loadProfile as never });
    rpcHandler({ phone_otp_verify: () => ({ data: { ok: true, phone_e164: '+212612345678' }, error: null }) });
    await render(<CheckoutScreen />);
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    await fireEvent.press(screen.getByText('Recevoir le code sur WhatsApp'));
    await waitFor(() => expect(screen.getByText(/Code envoyé sur WhatsApp au 06 12 34 56 78/)).toBeTruthy());
    expect(mockInvoke).toHaveBeenCalledWith('phone-otp', { method: 'POST', body: { phone: '+212612345678' } });
    expect(screen.getByText('Renvoyer le code (60 s)')).toBeTruthy(); // resend is rate-limited
    await fireEvent.changeText(screen.getByPlaceholderText('123456'), '482913');
    await fireEvent.press(screen.getByText('Vérifier'));
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toBeTruthy());
    expect(mockRpc).toHaveBeenCalledWith('phone_otp_verify', { p_verification: 'v1', p_code: '482913' });
    expect(loadProfile).toHaveBeenCalledWith('u1');
  });

  it('a wrong code is refused with the attempts left; the number is not verified', async () => {
    mockInvoke.mockImplementation(async () => ({ data: { ok: true, verification_id: 'v1', phone_e164: '+212612345678', expires_at: 'x' }, error: null }));
    rpcHandler({ phone_otp_verify: () => ({ data: { ok: false, reason: 'wrong_code', attempts_left: 3 }, error: null }) });
    await render(<CheckoutScreen />);
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    await fireEvent.press(screen.getByText('Recevoir le code sur WhatsApp'));
    await waitFor(() => expect(screen.getByPlaceholderText('123456')).toBeTruthy());
    await fireEvent.changeText(screen.getByPlaceholderText('123456'), '000000');
    await fireEvent.press(screen.getByText('Vérifier'));
    await waitFor(() => expect(screen.getByTestId('checkout-phone-message')).toHaveTextContent('Code incorrect. 3 essais restants.'));
    expect(screen.queryByTestId('checkout-total')).toBeNull();
  });

  it('WhatsApp not configured: explained, never treated as verified', async () => {
    mockInvoke.mockImplementation(async () => refused('provider_unavailable'));
    await render(<CheckoutScreen />);
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    await fireEvent.press(screen.getByText('Recevoir le code sur WhatsApp'));
    await waitFor(() => expect(screen.getByTestId('checkout-phone-message')).toHaveTextContent(/pas encore disponible/));
    expect(screen.queryByPlaceholderText('123456')).toBeNull();
    expect(mockRpc).not.toHaveBeenCalledWith('phone_otp_verify', expect.anything());
  });

  it('a number that is not a Moroccan mobile is refused before any code is sent', async () => {
    await render(<CheckoutScreen />);
    await fireEvent.press(screen.getByText('Livrer à cette adresse'));
    expect(screen.getByLabelText('Numéro de mobile').props.value).toBe('6 12 34 56 78'); // prefilled after +212
    await fireEvent.changeText(screen.getByLabelText('Numéro de mobile'), '5 22 12 34 56');
    await fireEvent.press(screen.getByText('Recevoir le code sur WhatsApp'));
    expect(screen.getByTestId('checkout-phone-message')).toHaveTextContent('Saisissez un numéro de mobile marocain (06 ou 07).');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
