// Admin order list: the driver embed names one relationship (the hosted
// schema has two identical orders.driver_id foreign keys, so a plain embed is
// refused with PGRST201), and a failed request is shown, never "No orders".
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import AdminOrders from '../app/(admin)/orders';
import { ORDER_DRIVER_EMBED } from '../src/orders/orderQueries';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

const mockSelects: string[] = [];
const mockResult: { value: { data: unknown; error: unknown } } = { value: { data: [], error: null } };
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = (s: string) => {
        mockSelects.push(s);
        return builder;
      };
      builder.order = () => builder;
      builder.eq = () => builder;
      builder.then = (resolve: (r: unknown) => unknown) => Promise.resolve(mockResult.value).then(resolve);
      return builder;
    },
  },
}));

beforeEach(() => {
  mockSelects.length = 0;
});

it('names the driver relationship explicitly', async () => {
  expect(ORDER_DRIVER_EMBED).toBe('drivers:drivers!orders_driver_id_fkey (first_name, last_name)');
  mockResult.value = {
    data: [{ id: 'o1', order_number: 'LO-1', total: 74, status: 'pending', delivery_address: 'Rue', created_at: new Date().toISOString(),
             driver_id: null, workflow_version: 1, payment_status: 'pending', drivers: null }],
    error: null,
  };
  await render(<AdminOrders />);
  await screen.findByText('LO-1');
  expect(mockSelects[0]).toBe(`*, ${ORDER_DRIVER_EMBED}`);
});

it('shows a failed request instead of "No orders"', async () => {
  mockResult.value = { data: null, error: { code: 'PGRST201', message: 'Could not embed because more than one relationship was found' } };
  await render(<AdminOrders />);
  await screen.findByText('Orders unavailable');
  expect(screen.queryByText('No orders')).toBeNull();
});
