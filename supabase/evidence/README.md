# Staging schema evidence

## `catalog_2026-10-15.json`

| Field | Value |
|---|---|
| Project | `teppcfnpkoxkudajnvad` (confirmed **staging** by the owner) |
| Query | `phase1b_catalog_query.sql` (this folder). It reads system catalogs only: no table data, no changes. |
| Run by | Project owner, in Supabase Dashboard → SQL Editor |
| `generated_at` | `2026-10-15T19:40:30.381404+00:00` |
| Server | PostgreSQL 17.6 |
| Delivery | Pasted into the engineering chat on 2026-10-15 as a one-cell CSV export. It was not committed during Phase 1B. |
| Raw cell SHA-256 | `2bea08d43b9a3d28eb022e2fece7dbc13d67ee3d2dee84948f2f483463b31bd3` (the JSON text exactly as exported) |
| Committed file | The same JSON, re-serialised with sorted keys and 2-space indentation. **No values were changed.** |

A separate aggregate run by the owner on the same day (`select role, is_admin, count(*) from user_profiles group by 1,2`) returned:

| role | is_admin | count |
|---|---|---|
| admin | true | 1 |
| customer | false | 14 |
| customer | true | 1 |
| driver | false | 1 |

### Sanitisation review
The whole file was scanned for:
- JWTs (`eyJ…`);
- `sk_live`/`sk_test` keys;
- `sb_secret_` keys;
- `service_role` keys;
- `Bearer` tokens;
- e-mail addresses;
- URLs;
- the word "password";
- long digit runs.

**There were no matches.**

The file holds catalog metadata only: table, column, policy and function definitions. Bucket `owner`/`owner_id` were already removed by the query. Nothing needed redacting.

### Comparison scope of the baseline (what "identical" means)
`supabase/baseline/staging_schema_2026-10-15.sql` is rebuilt from this file. `supabase/baseline/compare_catalog.py` then re-runs the same catalog query on the rebuilt database and compares the results. "Identical" means identical **in these 13 sections only**:

| # | Section | Attributes compared |
|---|---|---|
| 1 | tables (public) | name, kind, RLS enabled, RLS forced |
| 2 | columns | table, position, name, `data_type`, `udt_name`, nullable, default expression |
| 3 | constraints | table, name, type, `pg_get_constraintdef` text |
| 4 | indexes | table, name, `pg_indexes.indexdef` text |
| 5 | policies (public) | table, name, permissive, roles, command, USING, WITH CHECK |
| 6 | functions (public) | name, identity arguments, full definition text, SECURITY DEFINER, `proconfig`, anon/authenticated EXECUTE |
| 7 | triggers (public) | table, name, enabled flag, definition |
| 8 | effective table privileges | SELECT/INSERT/UPDATE/DELETE for `anon` and `authenticated` only |
| 9 | column ACLs | any column-level grant |
| 10–12 | enums, views, Realtime publication | presence and definitions |
| 13 | extensions | name, version |

**The baseline is not a complete clone of staging.** These are **not compared**, because the evidence does not contain them:
- numeric precision/scale and other type modifiers;
- identity and generated-column flags;
- collations, storage parameters, comments and statistics;
- object **ownership**;
- `TRUNCATE`/`REFERENCES`/`TRIGGER` privileges;
- grants to roles other than `anon`/`authenticated`;
- function ACLs beyond `anon`/`authenticated` EXECUTE;
- sequences (none are referenced by column defaults);
- all platform-managed schemas: `auth`, `storage` (the 4 `storage.objects` policies and 2 buckets are captured, but the tables are not), `realtime`, `extensions`, `vault`;
- **roles, role memberships, event triggers, the `authenticator` configuration and schema ACLs** (U3–U6);
- Auth settings and Auth hooks;
- PostgREST exposed-schema settings;
- every table row, except the `user_profiles` aggregate above.

`default_privileges` is printed for information only. It comes from the Supabase image, not from the baseline.

### How U3–U6 and the ownership/grant gaps are handled
They cannot be answered from this 2026-10-15 snapshot. They are handled at deployment time instead, in two layers:

1. **Mandatory staging preflight** (`supabase/tests/preflight_staging_readonly.sql`, read-only). Each item has a required check that fails on an unsafe or unexplained state:
   - roles outside the Supabase allowlist;
   - unexpected SUPERUSER/BYPASSRLS roles;
   - elevated `anon`/`authenticated` attributes;
   - unexpected memberships in privileged or client roles;
   - functions granted to `supabase_auth_admin` (Auth-hook candidates);
   - event triggers whose function is not one of Supabase's six or `public.rls_auto_enable()`;
   - `authenticator` being SUPERUSER, BYPASSRLS or INHERIT;
   - `authenticator` not preloading `safeupdate`;
   - CREATE on platform schemas for `PUBLIC`/`anon`/`authenticated`/`authenticator`;
   - `public` tables not owned by `postgres`, RLS disabled, unexpected grantees or column grants;
   - storage policies or buckets differing from the evidence;
   - the migration role being unable to manage `storage.objects` policies.
2. **The migration's own guard.** `public.containment_violations()`, category `drift`, re-checks every DB-visible item above at apply time and aborts with nothing applied. The single exception is the `safeupdate` preload, which only the preflight checks.

The allowlists are the platform defaults observed in `supabase/postgres:17.6.1.178` (Supabase's PostgreSQL 17.6 image), plus documented hosted-only roles. Anything else fails and has to be explained, and the allowlist can only be extended through a reviewed commit.

**Not DB-visible, so it is a manual mandatory check:** Dashboard → Authentication → Hooks (no enabled hook), and Dashboard → API settings (exposed schemas only `public` and `graphql_public`).

### What it does not contain
These are evidence gaps. Each is listed in `docs/v1/PHASE1C_DATABASE_SECURITY_PLAN.md`.
- Numeric precision and scale, and varchar lengths.
- Grants to `service_role`/`postgres`, and `TRUNCATE`/`REFERENCES`/`TRIGGER` privileges.
- Event triggers. It is unknown whether `rls_auto_enable()` is attached.
- Auth settings and Auth hooks.
- The `authenticator` role configuration.
- The `public` schema ACL.
- Custom Postgres roles other than the four queried.
- Table data. The only exception is the `user_profiles` aggregate above.

**Drift:** this is a point-in-time snapshot. Any staging change after `2026-10-15T19:40:30Z` is not reflected here. The read-only preflight (`supabase/tests/preflight_staging_readonly.sql`) and the migration's own guards exist to detect drift before anything is applied.
