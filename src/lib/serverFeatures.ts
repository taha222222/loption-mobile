// src/lib/serverFeatures.ts
// Tells "the server does not have this feature yet" (a database migration
// not applied: PostgREST cannot find the function, table or column) apart
// from a network or permission failure, so screens can say the right thing
// instead of "check your connection".
type ApiError = { code?: string; message?: string } | null | undefined;

const MISSING_CODES = new Set([
  'PGRST202', // function not found in the schema cache
  'PGRST205', // table not found in the schema cache
  'PGRST204', // column not found in the schema cache
  '42883', // undefined function
  '42P01', // undefined table
  '42703', // undefined column
]);

export function isMissingServerFeature(error: ApiError): boolean {
  if (!error) return false;
  if (error.code && MISSING_CODES.has(error.code)) return true;
  return /could not find the (function|table)|schema cache/i.test(String(error.message ?? ''));
}

export const SERVER_UPDATE_PENDING =
  'Cette fonctionnalité n’est pas encore activée sur le serveur L’OPTION (mise à jour de la base de données en attente). Le menu et les commandes fonctionnent normalement.';
