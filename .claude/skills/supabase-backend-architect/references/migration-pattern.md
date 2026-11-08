# Migration pattern (as used by every V1 migration)

Copy the structure of the latest migration (`supabase/migrations/20261109120000_v1_checkout_experience.sql`):

1. Header: purpose, status "NOT applied to any hosted database", predecessor, rollback path, owner decisions applied,
   what is deliberately not decided.
2. `begin;` `set local lock_timeout = '10s';` role check (`current_user = 'postgres'`, else 42501).
3. Deferred commit gate: two temp tables (`…_gate_ok`, `…_gate` with a deferrable FK); rows `precondition`,
   `postcondition`. A failed check makes COMMIT impossible even under `ON_ERROR_ROLLBACK`.
4. Precondition: predecessor objects exist; monitor md5 equals the predecessor's recorded value; no violations;
   refuse a re-run (new objects already present); data preconditions (e.g. no workflow orders).
5. Objects: tables with checks, RLS enabled, `revoke all … from public, anon, authenticated, service_role`, then the
   minimal grants; policies; definer functions with `set search_path = ''`; triggers for immutability and audit.
6. Generated monitor block (`-- BEGIN GENERATED MONITOR` … `-- END`) when client policies or client definer functions
   change; fill the postcondition md5 from the generator output.
7. Postcondition: 0 violations, monitor md5, privileges per role (`has_function_privilege`, `has_table_privilege`,
   `has_column_privilege`), no seeded data that needs owner approval.
8. `commit;`

Rollback (`supabase/rollback/v1_<feature>_rollback.sql`): role check, gate, archive into a private schema
`v1_<feature>_rollback_archive` (no client access), drop/restore objects, restore replaced functions from
**generated** blocks (`function_from()` in the generator), restore the previous monitor, postcondition.

Error codes used by the app (`src/services/*Api.ts` classifiers): 42501 not allowed, 22023 invalid input,
55000 not open / prerequisite missing, 40001 changed meanwhile (retry/review), 54000 rate limit.

Edge Functions: pure module (`quote.ts`, `otp.ts`, `dispatch.ts`) with injected `rpc`/`fetch`, tested by Jest; `index.ts`
verifies the user JWT via `/auth/v1/user`, reads secrets from `Deno.env` only, fails closed when a secret is missing.
Secrets live in Supabase Edge Function secrets, never in the app or git.
