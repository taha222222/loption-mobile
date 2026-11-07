// src/services/phoneApi.ts
// Phone verification by WhatsApp code. The code is sent by the phone-otp
// Edge Function (provider credentials server-side only) and checked by
// public.phone_otp_verify; the app never sees the code and never marks a
// number verified itself.
import { supabase } from '../lib/supabase';

export type SendFailure = 'invalid_phone' | 'rate_limited' | 'provider_unavailable' | 'provider_failed' | 'network' | 'other';
export type SendResult = { ok: true; verificationId: string; phoneE164: string; expiresAt: string } | { ok: false; reason: SendFailure; message: string };
export type VerifyFailure = 'wrong_code' | 'expired' | 'too_many_attempts' | 'not_sent' | 'network' | 'other';
export type VerifyResult = { ok: true; phoneE164: string } | { ok: false; reason: VerifyFailure; message: string; attemptsLeft?: number };

const SEND_MESSAGES: Record<SendFailure, string> = {
  invalid_phone: 'Saisissez un numéro de mobile marocain (06 ou 07).',
  rate_limited: 'Trop de demandes de code. Patientez un peu avant de réessayer.',
  provider_unavailable: 'La vérification par WhatsApp n’est pas encore disponible. Réessayez plus tard.',
  provider_failed: 'Le code WhatsApp n’a pas pu être envoyé. Vérifiez le numéro et réessayez.',
  network: 'Pas de connexion : le code n’a pas été envoyé.',
  other: 'Le code n’a pas pu être envoyé.',
};
const VERIFY_MESSAGES: Record<VerifyFailure, string> = {
  wrong_code: 'Code incorrect.',
  expired: 'Ce code a expiré. Demandez un nouveau code.',
  too_many_attempts: 'Trop d’essais. Demandez un nouveau code.',
  not_sent: 'Ce code n’a pas été envoyé. Demandez un nouveau code.',
  network: 'Pas de connexion : le code n’a pas été vérifié.',
  other: 'Le code n’a pas pu être vérifié.',
};
const SEND_REASONS = new Set(Object.keys(SEND_MESSAGES));

const sendFailure = (reason: SendFailure): SendResult => ({ ok: false, reason, message: SEND_MESSAGES[reason] });

export async function requestPhoneCode(phone: string): Promise<SendResult> {
  try {
    const { data, error } = await supabase.functions.invoke('phone-otp', { method: 'POST', body: { phone } });
    if (error) {
      let reason: SendFailure = 'other';
      try {
        const body = (await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.()) as { reason?: string } | undefined;
        if (body?.reason && SEND_REASONS.has(body.reason)) reason = body.reason as SendFailure;
        else if (!body) reason = 'network';
      } catch {
        reason = 'network';
      }
      return sendFailure(reason);
    }
    const d = data as { ok?: boolean; verification_id?: string; phone_e164?: string; expires_at?: string } | null;
    if (!d?.ok || typeof d.verification_id !== 'string' || typeof d.phone_e164 !== 'string') return sendFailure('other');
    return { ok: true, verificationId: d.verification_id, phoneE164: d.phone_e164, expiresAt: String(d.expires_at) };
  } catch {
    return sendFailure('network');
  }
}

export async function verifyPhoneCode(verificationId: string, code: string): Promise<VerifyResult> {
  try {
    const { data, error } = await supabase.rpc('phone_otp_verify', { p_verification: verificationId, p_code: code.trim() });
    if (error) return { ok: false, reason: /^[0-9A-Z]{5}$/.test(String(error.code ?? '')) ? 'other' : 'network', message: VERIFY_MESSAGES.other };
    const d = data as { ok?: boolean; phone_e164?: string; reason?: string; attempts_left?: number } | null;
    if (d?.ok && d.phone_e164) return { ok: true, phoneE164: d.phone_e164 };
    const reason = (d?.reason && d.reason in VERIFY_MESSAGES ? d.reason : 'other') as VerifyFailure;
    const left = typeof d?.attempts_left === 'number' ? d.attempts_left : undefined;
    return {
      ok: false,
      reason,
      attemptsLeft: left,
      message: reason === 'wrong_code' && left !== undefined ? `${VERIFY_MESSAGES.wrong_code} ${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}.` : VERIFY_MESSAGES[reason],
    };
  } catch {
    return { ok: false, reason: 'network', message: VERIFY_MESSAGES.network };
  }
}
