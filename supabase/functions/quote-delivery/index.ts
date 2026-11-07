// Supabase Edge Function: quote-delivery (NOT deployed).
//
// Called by the signed-in customer at checkout (supabase.functions.invoke,
// no body). Measures the road distance from the kitchen serving the
// customer's city to their saved address and records a quote the database
// prices (quote.ts). The request carries nothing but the user's JWT.
// Secrets come from the function's environment only:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (provided by Supabase)
//   ROUTING_API_KEY  (Google Maps Platform key restricted to the Geocoding
//                     and Routes APIs; set by the owner. Missing = no quote.)
// None of them is ever shipped in the mobile app.
import { postgrestRpc, QuoteError, runQuote, statusFor } from './quote.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const fail = (reason: string, status: number) => Response.json({ ok: false, reason }, { status });

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return fail('other', 500);
  // The caller is the user of the JWT, checked by Auth (never a body field).
  const auth = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return fail('not_signed_in', 401);
  const who = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } });
  if (!who.ok) return fail('not_signed_in', 401);
  const user = (await who.json()) as { id?: string };
  if (!user.id) return fail('not_signed_in', 401);
  try {
    const quote = await runQuote(user.id, {
      rpc: postgrestRpc(url, service, fetch),
      fetch,
      routingKey: Deno.env.get('ROUTING_API_KEY') || undefined,
    });
    return Response.json({ ok: true, quote });
  } catch (e) {
    const reason = e instanceof QuoteError ? e.reason : 'other';
    return fail(reason, statusFor(reason));
  }
});
