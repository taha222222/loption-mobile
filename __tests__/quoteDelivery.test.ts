// quote-delivery core with a fake database (rpc) and fake Google APIs.
// Proves the fail-closed logic and what is sent to the database; the real
// Google Geocoding/Routes APIs are NOT called by these tests.
import { classifyRpcError, PROVIDER, QuoteError, runQuote, statusFor } from '../supabase/functions/quote-delivery/quote';

const USER = '00000000-0000-0000-0000-000000000f04';
const CONTEXT = {
  kitchen_id: 'kitchen-a',
  pricing_policy_id: 'policy-1',
  origin_latitude: 33.589,
  origin_longitude: -7.603,
  address_text: '12 Rue Test, Casablanca',
  address_latitude: 1,
  address_longitude: 1,
  existing_quote: null as unknown,
};
const QUOTE = {
  quote_id: 'q1',
  kitchen_id: 'kitchen-a',
  distance_km: 5,
  delivery_fee: 16,
  service_fee: 3,
  formula_version: 'v1_road_km',
  config_version: 'v1',
  expires_at: '2026-11-07T12:15:00Z',
};

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;
const geocodeOk = (type = 'ROOFTOP') => json(200, { status: 'OK', results: [{ geometry: { location: { lat: 33.57, lng: -7.59 }, location_type: type } }] });
const routeOk = (m: number) => json(200, { routes: [{ distanceMeters: m }] });

function setup(opts: { context?: object; contextError?: object; recordError?: object; geocode?: any; route?: any; key?: string | null } = {}) {
  const rpc = jest.fn(async (name: string, args: any) => {
    if (name === 'delivery_quote_context') {
      if (opts.contextError) throw opts.contextError;
      return { ...CONTEXT, ...(opts.context ?? {}) };
    }
    if (name === 'record_delivery_quote') {
      if (opts.recordError) throw opts.recordError;
      return { ...QUOTE, distance_km: args.p_distance_m / 1000 };
    }
    throw new Error('unexpected rpc ' + name);
  });
  const fetch = jest.fn(async (url: string, init?: any) => {
    if (url.includes('geocode')) {
      if (opts.geocode instanceof Error) throw opts.geocode;
      return opts.geocode ?? geocodeOk();
    }
    if (url.includes('computeRoutes')) {
      if (opts.route instanceof Error) throw opts.route;
      return opts.route ?? routeOk(5000);
    }
    throw new Error('unexpected url ' + url + JSON.stringify(init));
  });
  const deps = { rpc, fetch: fetch as any, routingKey: opts.key === null ? undefined : (opts.key ?? 'server-key'), timeoutMs: 50 };
  return { rpc, fetch, deps };
}

async function reason(p: Promise<unknown>) {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return e instanceof QuoteError ? e.reason : 'not a QuoteError';
  }
}

describe('quote-delivery', () => {
  it('routes from the kitchen origin to the server-geocoded address and lets the database price it', async () => {
    const { deps, rpc, fetch } = setup();
    const q = await runQuote(USER, deps);
    expect(q.delivery_fee).toBe(16);
    const geocodeUrl = String(fetch.mock.calls[0][0]);
    expect(geocodeUrl).toContain('address=12%20Rue%20Test%2C%20Casablanca');
    expect(geocodeUrl).toContain('components=country:MA');
    const [routesUrl, init] = fetch.mock.calls[1] as any[];
    expect(routesUrl).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(init.headers['X-Goog-Api-Key']).toBe('server-key');
    expect(init.headers['X-Goog-FieldMask']).toBe('routes.distanceMeters');
    const body = JSON.parse(init.body);
    expect(body.origin.location.latLng).toEqual({ latitude: 33.589, longitude: -7.603 });
    expect(body.destination.location.latLng).toEqual({ latitude: 33.57, longitude: -7.59 }); // not the client pin (1, 1)
    expect(body.travelMode).toBe('DRIVE');
    const record = rpc.mock.calls.find((c) => c[0] === 'record_delivery_quote')![1];
    // Only the user, the pricing row, the destination, the road metres and
    // the provider: never a fee, price or total.
    expect(record).toEqual({
      p_user: USER,
      p_pricing_policy: 'policy-1',
      p_address_text: '12 Rue Test, Casablanca',
      p_destination_latitude: 33.57,
      p_destination_longitude: -7.59,
      p_distance_m: 5000,
      p_provider: PROVIDER,
    });
  });

  it('reuses a still-valid quote without calling the routing provider', async () => {
    const { deps, fetch, rpc } = setup({ context: { existing_quote: QUOTE } });
    await expect(runQuote(USER, deps)).resolves.toEqual(QUOTE);
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed without a routing key (no straight-line fallback, nothing recorded)', async () => {
    const { deps, fetch, rpc } = setup({ key: null });
    expect(await reason(runQuote(USER, deps))).toBe('routing_unavailable');
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some((c) => c[0] === 'record_delivery_quote')).toBe(false);
  });

  it.each([
    ['provider HTTP error', { route: json(500, {}) }],
    ['provider down', { route: new Error('ECONNRESET') }],
    ['no route', { route: json(200, { routes: [] }) }],
    ['zero distance', { route: routeOk(0) }],
    ['geocoder over quota', { geocode: json(200, { status: 'OVER_QUERY_LIMIT' }) }],
    ['geocoder unreachable', { geocode: new Error('timeout') }],
  ])('routing unavailable (%s): no quote, nothing recorded', async (_label, opts) => {
    const { deps, rpc } = setup(opts as any);
    expect(await reason(runQuote(USER, deps))).toBe('routing_unavailable');
    expect(rpc.mock.calls.some((c) => c[0] === 'record_delivery_quote')).toBe(false);
  });

  it('times out a slow provider and fails closed', async () => {
    const { deps } = setup();
    deps.fetch = jest.fn(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    ) as any;
    expect(await reason(runQuote(USER, deps))).toBe('routing_unavailable');
  });

  it.each([
    ['not found in Morocco', json(200, { status: 'ZERO_RESULTS', results: [] })],
    ['only a city or district centroid', geocodeOk('APPROXIMATE')],
  ])('invalid address (%s): no quote', async (_label, geocode) => {
    const { deps, fetch } = setup({ geocode });
    expect(await reason(runQuote(USER, deps))).toBe('invalid_address');
    expect(fetch).toHaveBeenCalledTimes(1); // no routing call
  });

  it.each([
    [{ code: '55000', message: 'ordering is not open: pricing is not approved for this kitchen' }, 'closed', 423],
    [{ code: '22023', message: 'choose your delivery city' }, 'no_city', 422],
    [{ code: '22023', message: 'delivery is not available in your city yet' }, 'out_of_zone', 422],
    [{ code: '22023', message: 'a confirmed delivery address is required' }, 'no_address', 422],
  ])('database refusal %j -> %s (no routing call)', async (err, why, status) => {
    const { deps, fetch } = setup({ contextError: err });
    expect(await reason(runQuote(USER, deps))).toBe(why);
    expect(fetch).not.toHaveBeenCalled();
    expect(statusFor(why as any)).toBe(status);
  });

  it('a pricing or address change during routing asks for a new quote', async () => {
    const { deps } = setup({ recordError: { code: '40001', message: 'the pricing changed' } });
    expect(await reason(runQuote(USER, deps))).toBe('retry');
  });

  it('classifies unknown errors as other', () => {
    expect(classifyRpcError({ code: 'XX000' })).toBe('other');
    expect(classifyRpcError(null)).toBe('other');
    expect(statusFor('routing_unavailable')).toBe(503);
  });
});
