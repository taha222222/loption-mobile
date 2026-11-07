// supabase/functions/quote-delivery/quote.ts
// Runtime-independent core of the delivery quote (Deno Edge Function in
// production, Node/Jest in tests). It measures the ROAD distance from the
// kitchen that serves the customer's city to the customer's address and has
// the database record it (public.record_delivery_quote, which computes the
// fee from the approved pricing row). The app sends nothing: no address, no
// coordinates, no distance, no fee.
//
// Fail closed: no routing key, a provider error or timeout, an address the
// geocoder cannot place precisely, or no route => no quote, and without a
// quote create_order() refuses. A straight-line distance is never used.
//
// Destination: the server geocodes the customer's saved address text
// (Google Geocoding, restricted to Morocco). The map pin saved by the app is
// not used for pricing (client-supplied); see DECISIONS #38.
//
// Uses only standard fetch and plain types (no imports).

export type QuoteFailure =
  | 'closed' // no approved pricing, or the fees' tax treatment is not approved
  | 'no_address'
  | 'no_city'
  | 'out_of_zone'
  | 'invalid_address' // the geocoder cannot place the address precisely in Morocco
  | 'routing_unavailable' // no key, provider error or timeout, no route
  | 'retry' // the pricing changed while computing; ask again
  | 'other';

export class QuoteError extends Error {
  constructor(public reason: QuoteFailure, message?: string) {
    super(message ?? reason);
  }
}

export interface DeliveryQuote {
  quote_id: string;
  kitchen_id: string;
  distance_km: number;
  delivery_fee: number;
  service_fee: number;
  formula_version: string;
  config_version: string;
  expires_at: string;
}

interface QuoteContext {
  kitchen_id: string;
  pricing_policy_id: string;
  origin_latitude: number;
  origin_longitude: number;
  address_text: string;
  existing_quote: DeliveryQuote | null;
}

export interface RpcError {
  code?: string;
  message?: string;
}

export interface QuoteDeps {
  // Calls a Postgres function through PostgREST with the service role;
  // throws an RpcError-shaped object on a database refusal.
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch: typeof fetch;
  routingKey: string | undefined;
  timeoutMs?: number;
  geocodeUrl?: string;
  routesUrl?: string;
}

export const PROVIDER = 'google_routes_v2';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// A database refusal -> the reason shown to the customer.
export function classifyRpcError(e: unknown): QuoteFailure {
  const { code, message } = (e ?? {}) as RpcError;
  const m = String(message ?? '');
  if (code === '55000') return 'closed';
  if (code === '40001') return 'retry';
  if (code === '22023' && /confirmed delivery address/.test(m)) return 'no_address';
  if (code === '22023' && /choose your delivery city/.test(m)) return 'no_city';
  if (code === '22023' && /not available in your city/.test(m)) return 'out_of_zone';
  if (code === '22023') return 'invalid_address';
  return 'other';
}

async function withTimeout(deps: QuoteDeps, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000);
  try {
    return await deps.fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new QuoteError('routing_unavailable', 'routing provider unreachable or too slow');
  } finally {
    clearTimeout(timer);
  }
}

// Precise enough to price a delivery: not a city or district centroid.
const PRECISE = new Set(['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER']);

export async function geocode(deps: QuoteDeps, address: string): Promise<{ lat: number; lng: number }> {
  const url = `${deps.geocodeUrl ?? GEOCODE_URL}?address=${encodeURIComponent(address)}&components=country:MA&region=ma&key=${encodeURIComponent(deps.routingKey ?? '')}`;
  const res = await withTimeout(deps, url, { method: 'GET' });
  if (!res.ok) throw new QuoteError('routing_unavailable', `geocoding HTTP ${res.status}`);
  const body = (await res.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat?: number; lng?: number }; location_type?: string } }[];
  };
  if (body.status === 'ZERO_RESULTS') throw new QuoteError('invalid_address', 'address not found in Morocco');
  if (body.status !== 'OK') throw new QuoteError('routing_unavailable', `geocoding status ${body.status}`);
  const g = body.results?.[0]?.geometry;
  const lat = g?.location?.lat;
  const lng = g?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !PRECISE.has(String(g?.location_type))) {
    throw new QuoteError('invalid_address', 'address not precise enough');
  }
  return { lat, lng };
}

export async function roadDistanceMetres(
  deps: QuoteDeps,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<number> {
  const res = await withTimeout(deps, deps.routesUrl ?? ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': deps.routingKey ?? '',
      'X-Goog-FieldMask': 'routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
  });
  if (!res.ok) throw new QuoteError('routing_unavailable', `routes HTTP ${res.status}`);
  const body = (await res.json()) as { routes?: { distanceMeters?: number }[] };
  const metres = body.routes?.[0]?.distanceMeters;
  // No route: refuse. Never fall back to a straight line.
  if (typeof metres !== 'number' || !Number.isInteger(metres) || metres <= 0) {
    throw new QuoteError('routing_unavailable', 'no road route to this address');
  }
  return metres;
}

async function rpc<T>(deps: QuoteDeps, name: string, args: Record<string, unknown>): Promise<T> {
  try {
    return (await deps.rpc(name, args)) as T;
  } catch (e) {
    if (e instanceof QuoteError) throw e;
    throw new QuoteError(classifyRpcError(e), (e as RpcError)?.message);
  }
}

// The customer's quote: a still-valid one if it exists, otherwise a new
// road distance recorded by the database.
export async function runQuote(userId: string, deps: QuoteDeps): Promise<DeliveryQuote> {
  const ctx = await rpc<QuoteContext>(deps, 'delivery_quote_context', { p_user: userId });
  if (ctx.existing_quote) return ctx.existing_quote;
  if (!deps.routingKey) throw new QuoteError('routing_unavailable', 'routing is not configured');
  const destination = await geocode(deps, ctx.address_text);
  const metres = await roadDistanceMetres(deps, { lat: Number(ctx.origin_latitude), lng: Number(ctx.origin_longitude) }, destination);
  return rpc<DeliveryQuote>(deps, 'record_delivery_quote', {
    p_user: userId,
    p_pricing_policy: ctx.pricing_policy_id,
    p_address_text: ctx.address_text, // the address that was routed (refused if it changed meanwhile)
    p_destination_latitude: destination.lat,
    p_destination_longitude: destination.lng,
    p_distance_m: metres,
    p_provider: PROVIDER,
  });
}

// PostgREST RPC with the service role; a refusal is thrown as {code, message}.
export function postgrestRpc(baseUrl: string, serviceRoleKey: string, fetchImpl: typeof fetch) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) {
      let err: RpcError = { message: text };
      try {
        err = JSON.parse(text) as RpcError;
      } catch {
        /* not JSON */
      }
      throw { code: err.code, message: err.message } satisfies RpcError;
    }
    return text ? JSON.parse(text) : null;
  };
}

// HTTP status for a failure (the body always carries the reason).
export function statusFor(reason: QuoteFailure): number {
  switch (reason) {
    case 'routing_unavailable':
      return 503;
    case 'retry':
      return 409;
    case 'closed':
      return 423;
    case 'other':
      return 500;
    default:
      return 422;
  }
}
