// supabase/functions/phone-otp/otp.ts
// Runtime-independent core of the phone verification (Deno Edge Function in
// production, Node/Jest in tests). The database issues the code
// (public.phone_otp_issue: rate limits, normalisation, only the hash is
// stored); this module sends it through the WhatsApp Business Platform
// (Cloud API, an approved "authentication" template) and records the
// provider's answer (public.phone_otp_mark). The customer then types the code
// in the app (public.phone_otp_verify).
//
// Never simulated: without provider credentials no code is issued; a
// provider error or timeout marks the code failed, and a failed code can
// never verify the number. The code is never returned to the app or logged.
//
// Uses only standard fetch and plain types (no imports).

export type OtpFailure =
  | 'provider_unavailable' // WhatsApp credentials not configured
  | 'invalid_phone'
  | 'rate_limited'
  | 'provider_failed' // the provider refused or did not answer
  | 'other';

export class OtpError extends Error {
  constructor(public reason: OtpFailure, message?: string) {
    super(message ?? reason);
  }
}

export interface WhatsAppConfig {
  accessToken: string; // WHATSAPP_ACCESS_TOKEN (system-user token)
  phoneNumberId: string; // WHATSAPP_PHONE_NUMBER_ID (the sending number)
  template: string; // WHATSAPP_OTP_TEMPLATE (approved authentication template)
  language: string; // WHATSAPP_OTP_LANGUAGE, e.g. "fr"
  graphVersion: string; // WHATSAPP_GRAPH_VERSION, e.g. "v21.0"
}

export interface OtpDeps {
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch: typeof fetch;
  whatsapp: WhatsAppConfig | null;
  timeoutMs?: number;
  graphBaseUrl?: string;
}

export interface IssuedCode {
  verification_id: string;
  phone_e164: string;
  expires_at: string;
}

export const PROVIDER = 'whatsapp_cloud_api';

// The configuration from the function's secrets; null when incomplete.
export function whatsappConfig(env: (name: string) => string | undefined): WhatsAppConfig | null {
  const accessToken = env('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
  const template = env('WHATSAPP_OTP_TEMPLATE');
  if (!accessToken || !phoneNumberId || !template) return null;
  return {
    accessToken,
    phoneNumberId,
    template,
    language: env('WHATSAPP_OTP_LANGUAGE') || 'fr',
    graphVersion: env('WHATSAPP_GRAPH_VERSION') || 'v21.0',
  };
}

export function classifyRpcError(e: unknown): OtpFailure {
  const { code } = (e ?? {}) as { code?: string };
  if (code === '22023') return 'invalid_phone';
  if (code === '54000') return 'rate_limited';
  return 'other';
}

// Authentication template: the code is the body parameter and the
// "copy code" button parameter.
export function templateMessage(cfg: WhatsAppConfig, phoneE164: string, code: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneE164.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: cfg.template,
      language: { code: cfg.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
}

async function sendWhatsApp(deps: OtpDeps, cfg: WhatsAppConfig, phoneE164: string, code: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10000);
  let res: Response;
  try {
    res = await deps.fetch(`${deps.graphBaseUrl ?? 'https://graph.facebook.com'}/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(templateMessage(cfg, phoneE164, code)),
      signal: controller.signal,
    });
  } catch {
    throw new OtpError('provider_failed', 'WhatsApp did not answer');
  } finally {
    clearTimeout(timer);
  }
  let body: { messages?: { id?: string }[]; error?: { message?: string; code?: number } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  const id = body.messages?.[0]?.id;
  if (!res.ok || !id) {
    throw new OtpError('provider_failed', `WhatsApp HTTP ${res.status}${body.error?.code ? ` code ${body.error.code}` : ''}`);
  }
  return id;
}

export async function sendCode(userId: string, rawPhone: string, deps: OtpDeps): Promise<IssuedCode> {
  // No provider, no code: nothing is issued that could never be delivered.
  if (!deps.whatsapp) throw new OtpError('provider_unavailable', 'WhatsApp is not configured');
  if (typeof rawPhone !== 'string' || rawPhone.length > 40) throw new OtpError('invalid_phone');
  let issued: { verification_id: string; phone_e164: string; code: string; expires_at: string };
  try {
    issued = (await deps.rpc('phone_otp_issue', { p_user: userId, p_phone: rawPhone })) as typeof issued;
  } catch (e) {
    throw new OtpError(classifyRpcError(e), (e as { message?: string })?.message);
  }
  try {
    const messageId = await sendWhatsApp(deps, deps.whatsapp, issued.phone_e164, issued.code);
    await deps.rpc('phone_otp_mark', { p_verification: issued.verification_id, p_sent: true, p_provider: PROVIDER, p_detail: messageId });
  } catch (e) {
    const reason = e instanceof OtpError ? e.message : 'send failed';
    await deps
      .rpc('phone_otp_mark', { p_verification: issued.verification_id, p_sent: false, p_provider: PROVIDER, p_detail: reason })
      .catch(() => undefined);
    throw e instanceof OtpError ? e : new OtpError('provider_failed');
  }
  // The code itself never leaves the server.
  return { verification_id: issued.verification_id, phone_e164: issued.phone_e164, expires_at: issued.expires_at };
}

export function statusFor(reason: OtpFailure): number {
  switch (reason) {
    case 'provider_unavailable':
    case 'provider_failed':
      return 503;
    case 'rate_limited':
      return 429;
    case 'invalid_phone':
      return 422;
    default:
      return 500;
  }
}
