// Supabase Edge Function: phone-otp (NOT deployed).
//
// Called by the signed-in customer at checkout with {"phone": "06…"}. Sends a
// 6-digit code by WhatsApp (otp.ts); the customer types it in the app, which
// calls public.phone_otp_verify. Secrets come from the function's
// environment only (never the app):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (provided by Supabase)
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OTP_TEMPLATE
//   (WhatsApp Business Platform; set by the owner. Missing = no code sent.)
//   WHATSAPP_OTP_LANGUAGE (default "fr"), WHATSAPP_GRAPH_VERSION (default "v21.0")
import { OtpError, sendCode, statusFor, whatsappConfig } from './otp.ts';
import { postgrestRpc } from '../quote-delivery/quote.ts';

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
  const auth = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return fail('not_signed_in', 401);
  const who = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } });
  if (!who.ok) return fail('not_signed_in', 401);
  const user = (await who.json()) as { id?: string };
  if (!user.id) return fail('not_signed_in', 401);
  let phone: unknown;
  try {
    phone = ((await request.json()) as { phone?: unknown }).phone;
  } catch {
    return fail('invalid_phone', 422);
  }
  if (typeof phone !== 'string') return fail('invalid_phone', 422);
  try {
    const issued = await sendCode(user.id, phone, {
      rpc: postgrestRpc(url, service, fetch),
      fetch,
      whatsapp: whatsappConfig((name) => Deno.env.get(name)),
    });
    return Response.json({ ok: true, ...issued });
  } catch (e) {
    const reason = e instanceof OtpError ? e.reason : 'other';
    return fail(reason, statusFor(reason));
  }
});
