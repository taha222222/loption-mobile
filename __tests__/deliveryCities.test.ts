// City keys for delivery zones (Casablanca first). The server decides what is
// served (public.delivery_zones); these helpers only recognise the city.
import { cityKeyFromName, cityName, notServedMessage, CITY_OPTIONS, LAUNCH_CITY } from '../src/delivery/cities';
import { classifyCreateOrderError } from '../src/services/checkoutApi';

jest.mock('../src/lib/supabase', () => ({ supabase: {} }));

describe('delivery cities', () => {
  it('recognises Casablanca however the phone or the customer writes it', () => {
    for (const n of ['Casablanca', 'casablanca', ' CASABLANCA ', 'Casa', 'Dar El Beida', 'الدار البيضاء']) expect(cityKeyFromName(n)).toBe('casablanca');
    expect(cityKeyFromName('Fès')).toBe('fes');
    expect(cityKeyFromName('Fez')).toBe('fes');
    expect(cityKeyFromName('El Jadida')).toBe('el_jadida');
    expect(cityKeyFromName('Tangier')).toBe('tanger');
    expect(cityKeyFromName('Paris')).toBeNull();
    expect(cityKeyFromName('')).toBeNull();
    expect(cityKeyFromName(null)).toBeNull();
  });

  it('keys match the server rule and Casablanca is the launch city', () => {
    for (const c of CITY_OPTIONS) expect(c.key).toMatch(/^[a-z][a-z_]{1,39}$/);
    expect(LAUNCH_CITY).toBe('casablanca');
    expect(cityName('mohammedia')).toBe('Mohammédia');
  });

  it('tells the customer delivery is not available in their city yet', () => {
    expect(notServedMessage('rabat')).toMatch(/^La livraison n’est pas encore disponible à Rabat\. L’OPTION livre d’abord à Casablanca/);
    expect(notServedMessage('autre')).toMatch(/^La livraison n’est pas encore disponible dans votre ville\./);
  });

  it('maps the server zone refusals of create_order()', () => {
    expect(classifyCreateOrderError({ code: '22023', message: 'delivery is not available in your city yet' })).toBe('out_of_zone');
    expect(classifyCreateOrderError({ code: '22023', message: 'this kitchen does not deliver to your city' })).toBe('out_of_zone');
    expect(classifyCreateOrderError({ code: '22023', message: 'choose your delivery city' })).toBe('no_city');
    expect(classifyCreateOrderError({ code: '22023', message: 'meal x is not available' })).toBe('invalid');
  });
});
