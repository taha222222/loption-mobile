// Supabase Edge Function: dispatch-notifications (NOT deployed).
//
// Invoked every 15 minutes by the scheduler (pg_cron + pg_net, see
// docs/v1/CALORIE_TRACKING_AND_ENGAGEMENT.md). Plans due notifications in
// the database, delivers them through the Expo Push API and records the
// outcomes. Secrets come from the function's environment only:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (provided by Supabase)
//   NOTIFICATIONS_CRON_SECRET                (set by the owner; required)
//   EXPO_ACCESS_TOKEN                        (optional, Expo enhanced security)
// None of them is ever shipped in the mobile app.
import { postgrestRpc, runDispatch, secretsMatch } from './dispatch.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!secretsMatch(request.headers.get('x-cron-secret'), Deno.env.get('NOTIFICATIONS_CRON_SECRET'))) {
    return new Response('forbidden', { status: 403 });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('server not configured', { status: 500 });
  try {
    const summary = await runDispatch({
      rpc: postgrestRpc(url, key, fetch),
      fetch,
      expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN') || undefined,
    });
    return Response.json(summary);
  } catch (e) {
    return new Response(`dispatch failed: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
});
