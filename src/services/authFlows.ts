// src/services/authFlows.ts
// Sign-in and sign-up flows on top of Supabase Auth.
//
//  * Google: Supabase-hosted OAuth (PKCE) in the system browser. The app
//    holds no Google credential; the client ID/secret are configured in the
//    Supabase Dashboard (see docs/v1/AUTH_PROVIDER_SETUP.md).
//  * Apple: native Sign in with Apple on iOS (identity token + nonce,
//    verified by Supabase); Supabase-hosted OAuth elsewhere.
//  * E-mail: sign-up sends a verification link; the account is not treated
//    as verified until Supabase reports the address confirmed.
//
// Every flow returns an AuthOutcome; none throws for expected conditions
// (cancelled, provider not configured, e-mail delivery not set up).
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { fetchAuthProviderSettings, OAuthProvider } from './authProviders';

export type AuthOutcome =
  | { kind: 'signed_in' }
  | { kind: 'cancelled' }
  | { kind: 'not_configured'; provider: OAuthProvider | 'email' }
  | { kind: 'unavailable'; provider: OAuthProvider }
  | { kind: 'verification_sent'; email: string }
  | { kind: 'verification_required'; email: string }
  | { kind: 'account_exists'; email: string }
  | { kind: 'email_delivery_unavailable' }
  | { kind: 'rate_limited' }
  | { kind: 'link_expired' }
  | { kind: 'link_other_device' }
  | { kind: 'invalid_input'; message: string }
  | { kind: 'error'; message: string };

export const AUTH_CALLBACK_PATH = 'auth-callback';
export const authRedirectUrl = () => Linking.createURL(AUTH_CALLBACK_PATH);

// ----------------------------------------------------------------------------
// Input validation (the Supabase project's password policy is the authority;
// configure it to at least these rules in Dashboard -> Auth -> Providers -> Email).
// ----------------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email);
  if (!value) return 'Saisissez votre adresse e-mail.';
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) return 'Cette adresse e-mail n’est pas valide.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  if (password.length > 72) return 'Le mot de passe ne peut pas dépasser 72 caractères.';
  return null;
}

// ----------------------------------------------------------------------------
// Error mapping
// ----------------------------------------------------------------------------
function isProviderNotConfigured(error: any): boolean {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');
  return (
    code === 'provider_disabled' ||
    code === 'oauth_provider_not_supported' ||
    code === 'unexpected_audience' ||
    /provider is not enabled|unsupported provider|unacceptable audience/i.test(message)
  );
}

function mapEmailError(error: any, email: string): AuthOutcome {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');
  const status = error?.status;
  if (code === 'email_address_not_authorized' || /error sending .*email|smtp|sending confirmation/i.test(message)) {
    return { kind: 'email_delivery_unavailable' };
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return { kind: 'rate_limited' };
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message)) {
    return { kind: 'account_exists', email };
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return { kind: 'verification_required', email };
  }
  if (code === 'weak_password') return { kind: 'invalid_input', message: 'Ce mot de passe est trop faible.' };
  if (code === 'email_address_invalid') return { kind: 'invalid_input', message: 'Cette adresse e-mail n’est pas acceptée.' };
  if (code === 'email_provider_disabled' || code === 'signup_disabled') return { kind: 'not_configured', provider: 'email' };
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return { kind: 'error', message: 'E-mail ou mot de passe incorrect.' };
  }
  return { kind: 'error', message: 'Une erreur est survenue. Vérifiez votre connexion et réessayez.' };
}

// ----------------------------------------------------------------------------
// Redirect handling (OAuth result and e-mail verification links)
// ----------------------------------------------------------------------------
function readParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const add = (part: string | undefined) => {
    if (!part) return;
    for (const [key, value] of new URLSearchParams(part)) params[key] = value;
  };
  const [beforeHash, hash] = url.split('#');
  add(beforeHash.split('?')[1]);
  add(hash);
  return params;
}

// One exchange per code: on Android the redirect can arrive both as the
// auth-session result and as a deep link to the callback route.
const exchanges = new Map<string, Promise<AuthOutcome>>();

export function completeAuthFromUrl(url: string): Promise<AuthOutcome> {
  const params = readParams(url);
  if (params.error || params.error_code) {
    if (params.error_code === 'otp_expired' || /expired/i.test(params.error_description ?? '')) {
      return Promise.resolve({ kind: 'link_expired' });
    }
    if (params.error === 'access_denied') return Promise.resolve({ kind: 'cancelled' });
    return Promise.resolve({ kind: 'error', message: 'La connexion n’a pas abouti. Réessayez.' });
  }
  if (params.code) {
    const code = params.code;
    const existing = exchanges.get(code);
    if (existing) return existing;
    const request = (async (): Promise<AuthOutcome> => {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data?.session) {
        // The code verifier lives on the device that started the flow. An
        // e-mail link opened elsewhere still confirms the address.
        if (error?.code === 'bad_code_verifier' || /code verifier|flow state/i.test(String(error?.message ?? ''))) {
          return { kind: 'link_other_device' };
        }
        return { kind: 'error', message: 'La connexion n’a pas abouti. Réessayez.' };
      }
      await useAuthStore.getState().adoptSession(data.session as Session);
      return { kind: 'signed_in' };
    })();
    exchanges.set(code, request);
    return request;
  }
  return Promise.resolve({ kind: 'error', message: 'Lien de connexion incomplet.' });
}

// ----------------------------------------------------------------------------
// OAuth (Google; Apple outside iOS)
// ----------------------------------------------------------------------------
async function providerEnabled(provider: OAuthProvider): Promise<boolean | null> {
  const result = await fetchAuthProviderSettings();
  return result.status === 'loaded' ? result.settings[provider] : null;
}

export async function signInWithOAuthProvider(provider: OAuthProvider): Promise<AuthOutcome> {
  try {
    if ((await providerEnabled(provider)) === false) return { kind: 'not_configured', provider };
    const redirectTo = authRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return isProviderNotConfigured(error)
        ? { kind: 'not_configured', provider }
        : { kind: 'error', message: 'Impossible de démarrer la connexion. Réessayez.' };
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return { kind: 'cancelled' };
    const description = readParams(result.url).error_description ?? '';
    if (isProviderNotConfigured({ message: description })) return { kind: 'not_configured', provider };
    return completeAuthFromUrl(result.url);
  } catch {
    return { kind: 'error', message: 'Impossible de démarrer la connexion. Réessayez.' };
  }
}

export const signInWithGoogle = () => signInWithOAuthProvider('google');

// ----------------------------------------------------------------------------
// Apple
// ----------------------------------------------------------------------------
export async function signInWithApple(): Promise<AuthOutcome> {
  if (Platform.OS !== 'ios') return signInWithOAuthProvider('apple');
  try {
    if (!(await AppleAuthentication.isAvailableAsync())) return { kind: 'unavailable', provider: 'apple' };
    if ((await providerEnabled('apple')) === false) return { kind: 'not_configured', provider: 'apple' };

    // Apple receives the SHA-256 of the nonce; Supabase checks the raw value.
    const rawNonce = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return { kind: 'cancelled' };
      return { kind: 'error', message: 'La connexion avec Apple n’a pas abouti.' };
    }
    if (!credential.identityToken) return { kind: 'error', message: 'Apple n’a pas renvoyé d’identifiant.' };

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error || !data?.session) {
      return isProviderNotConfigured(error)
        ? { kind: 'not_configured', provider: 'apple' }
        : { kind: 'error', message: 'La connexion avec Apple n’a pas abouti.' };
    }

    // Apple shares the name only on the first authorization. Keep it if the
    // profile does not exist yet (never overwrites an existing profile).
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    if (fullName) {
      await supabase
        .from('user_profiles')
        .upsert({ user_id: data.session.user.id, full_name: fullName }, { onConflict: 'user_id', ignoreDuplicates: true });
    }
    await useAuthStore.getState().adoptSession(data.session);
    return { kind: 'signed_in' };
  } catch {
    return { kind: 'error', message: 'La connexion avec Apple n’a pas abouti.' };
  }
}

// ----------------------------------------------------------------------------
// E-mail and password
// ----------------------------------------------------------------------------
export async function signUpWithEmail(emailInput: string, password: string): Promise<AuthOutcome> {
  const email = normalizeEmail(emailInput);
  const invalid = validateEmail(email) ?? validatePassword(password);
  if (invalid) return { kind: 'invalid_input', message: invalid };

  try {
    // No profile, role or other data is sent from here: the profile is
    // created as a customer after the first verified sign-in.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) return mapEmailError(error, email);
    if (data?.session) {
      // Project confirms e-mails automatically: no e-mail was sent.
      await useAuthStore.getState().adoptSession(data.session);
      return { kind: 'signed_in' };
    }
    // Existing confirmed address: Supabase returns a user without identities
    // and sends nothing (so as not to reveal that the account exists).
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { kind: 'account_exists', email };
    }
    return { kind: 'verification_sent', email };
  } catch {
    return { kind: 'error', message: 'Une erreur est survenue. Vérifiez votre connexion et réessayez.' };
  }
}

export async function resendVerificationEmail(emailInput: string): Promise<AuthOutcome> {
  const email = normalizeEmail(emailInput);
  const invalid = validateEmail(email);
  if (invalid) return { kind: 'invalid_input', message: invalid };
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) return mapEmailError(error, email);
    return { kind: 'verification_sent', email };
  } catch {
    return { kind: 'error', message: 'Une erreur est survenue. Vérifiez votre connexion et réessayez.' };
  }
}

export async function signInWithEmail(emailInput: string, password: string): Promise<AuthOutcome> {
  const email = normalizeEmail(emailInput);
  const invalid = validateEmail(email);
  if (invalid) return { kind: 'invalid_input', message: invalid };
  if (!password) return { kind: 'invalid_input', message: 'Saisissez votre mot de passe.' };
  const { error } = await useAuthStore.getState().signIn(email, password);
  if (error) return mapEmailError(error, email);
  return { kind: 'signed_in' };
}

// User-facing text for outcomes that need a message.
export function describeOutcome(outcome: AuthOutcome): { title: string; message: string } | null {
  switch (outcome.kind) {
    case 'not_configured':
      if (outcome.provider === 'email') {
        return { title: 'Inscription indisponible', message: 'L’inscription par e-mail n’est pas encore ouverte.' };
      }
      return {
        title: `${outcome.provider === 'google' ? 'Google' : 'Apple'} n’est pas encore configuré`,
        message: 'Cette méthode de connexion sera bientôt disponible. Utilisez votre e-mail en attendant.',
      };
    case 'unavailable':
      return { title: 'Indisponible', message: 'Sign in with Apple n’est pas disponible sur cet appareil.' };
    case 'email_delivery_unavailable':
      return {
        title: 'E-mail non envoyé',
        message:
          'L’envoi des e-mails de vérification n’est pas encore configuré. Aucun e-mail n’a été envoyé ; réessayez plus tard.',
      };
    case 'rate_limited':
      return { title: 'Trop de tentatives', message: 'Patientez quelques minutes avant de réessayer.' };
    case 'link_expired':
      return { title: 'Lien expiré', message: 'Ce lien n’est plus valide. Demandez un nouvel e-mail de vérification.' };
    case 'link_other_device':
      return {
        title: 'Adresse confirmée ?',
        message: 'Ce lien a été ouvert sur un autre appareil. Si votre adresse est confirmée, connectez-vous avec votre mot de passe.',
      };
    case 'invalid_input':
      return { title: 'Vérifiez vos informations', message: outcome.message };
    case 'error':
      return { title: 'Connexion impossible', message: outcome.message };
    default:
      return null;
  }
}
