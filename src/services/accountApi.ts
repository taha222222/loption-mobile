// src/services/accountApi.ts
// In-app account deletion (App Store 5.1.1(v), Google Play). The server
// function deletes the caller's own account only; staff, driver and
// partner accounts are refused and closed by support.
import { supabase } from '../lib/supabase';
import { isMissingServerFeature } from '../lib/serverFeatures';

export const DELETE_CONFIRMATION = 'SUPPRIMER';

export type DeleteResult = { ok: true } | { ok: false; reason: 'not_available' | 'staff' | 'confirmation' | 'network' | 'other'; message: string };

export async function deleteMyAccount(confirmation: string): Promise<DeleteResult> {
  let error: { code?: string; message?: string } | null = null;
  try {
    ({ error } = await supabase.rpc('delete_my_account', { p_confirmation: confirmation }));
  } catch (e: any) {
    error = { message: String(e?.message ?? e) };
  }
  if (!error) return { ok: true };
  const msg = String(error.message ?? '');
  if (isMissingServerFeature(error)) {
    return { ok: false, reason: 'not_available', message: 'La suppression depuis l’application n’est pas encore activée sur le serveur. Écrivez au support L’OPTION : votre compte sera supprimé manuellement.' };
  }
  if (/staff, driver and partner/.test(msg)) {
    return { ok: false, reason: 'staff', message: 'Ce compte a un rôle professionnel (équipe, livreur ou partenaire) : sa fermeture se fait avec le support L’OPTION.' };
  }
  if (/confirmation required/.test(msg)) return { ok: false, reason: 'confirmation', message: `Tapez ${DELETE_CONFIRMATION} pour confirmer.` };
  if (!/^[0-9A-Z]{5}$/.test(String(error.code ?? '')) && !String(error.code ?? '').startsWith('PGRST')) {
    return { ok: false, reason: 'network', message: 'Pas de connexion. Rien n’a été supprimé ; réessayez.' };
  }
  return { ok: false, reason: 'other', message: 'La suppression n’a pas abouti. Rien n’a été supprimé ; réessayez ou contactez le support.' };
}
