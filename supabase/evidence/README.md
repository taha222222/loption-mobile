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
