# L'OPTION V1 — Phase 1C (amended, revision 7): Database Security Containment

**Status: implementation package for CTO review. CTO verdict of 2026-10-25: NOT READY FOR STAGING.** Revision 6 fixes the three medium findings of the 2026-10-25 review of revision 5 (section 0e), as assigned by the CTO on 2026-10-26. It does not change that verdict by itself; deployment stays blocked pending separate approval. Revision 7 addresses the findings of the independent review of revision 6 (section 0g), as assigned by the CTO on 2026-10-26. **M2 (existing `meal-images` objects) is not closed**: it needs staging evidence and a mitigation decision through a separately authorized task. Revision 7 is not staging-ready and does not declare Phase 1C complete.
- **Not applied** to any remote database. Nothing was sent to Supabase.
- **No production change.**
- **No pricing or fee rule** was implemented.
- **Checkout stays disabled.**

**Deployment is blocked** until all of the following are done (section 10):
1. The owner supplies the id of the one authorized initial administrator, and it is committed in a reviewed commit (section "Deployment prerequisite: initial administrator"). Until then the committed migration refuses to run.
2. The CTO approves a staging compatibility test plan for the app flows that stop working (section 7). A proposal is in section 7b.
3. The read-only staging preflight passes, and the CTO approves PR #1.

Branch: `claude/phase-1c-amended-containment`, cut from `main` (`0cb0fe0`). It contains only this package. Review PR: taha222222/loption-mobile#1 (draft). Revisions 5 and 6 are on `phase-1c-revision-5-review` (draft PR #2, based on that branch). Revisions 6 and 7 are on `phase-1c-revision-6` (draft PR #3, based on `phase-1c-revision-5-review`).

## Review status
- **Not independently reviewed.** Codex never responded on PR #1.
- 2026-10-25: **adversarial self-review by the implementing engineer** of commit `e781bc9` (the PR head at that time; `f62d0e7` was an earlier head and is an ancestor of it). It is not an independent review. Its findings M1–M3, L1–L6 and P2 items are remediated in revision 5 (section 0d).
- After the remediation, the final commit was re-reviewed adversarially by the same engineer. **That is again a self-review, not an independent approval.** The result is recorded in the PR update for revision 5.
- 2026-10-25: **review of revision 5 (`855b96f`)** in the project thread (findings only). Three medium findings: the last-admin protection fails under REPEATABLE READ (reproduced), no supported way to run the rollback, a pre-existing `staff_roles` skips the initial-admin check. Revision 6 remediates them (section 0e). The low-severity findings of that review are not part of this assignment and remain open (section 11).
- 2026-10-26: revision 6 re-reviewed adversarially by the implementing engineer: **a self-review, not an independent approval** (section 0f).
- 2026-10-26: **independent review of revision 6** (PR #3 head `02023a6`). Findings M1, M2 (medium) and L1–L8 (low). Revision 7 fixes M1 and L2–L8, documents L1 as a limitation and leaves M2 open, blocked on staging evidence and an owner/CTO decision (section 0g). Revision 7 has **not** been independently reviewed yet.

## 0g. Revision 7: findings of the independent review of revision 6 (CTO assignment of 2026-10-26)
Starting point: `phase-1c-revision-6` at `02023a6943493f6bab95de502e1a4c4eff05f4f0` (PR #3). Everything below was tested only in disposable local containers. **Nothing was sent to hosted Supabase; no staging or production database was contacted; nothing was deployed or merged.** Local tests do not verify hosted behaviour.

**Disposition:**

| Finding | Disposition | Change | Regression evidence (local) |
|---|---|---|---|
| **M1** Unapproved or revoked drivers can read their assigned orders | **Fixed** | The legacy policy `Drivers can view assigned orders` (any account whose id is in `orders.driver_id`) is replaced by `drivers_read_assigned_orders`: `driver_id = auth.uid() AND has_staff_role('driver')`. The policy is in the reviewed list, the pre-existing-object validation, the preflight allowlist and the postcondition; the rollback restores the legacy policy verbatim. | SQL tests T25a–T25d: an approved driver reads exactly their own order, not another driver's; an unapproved driver reads nothing; a revoked driver reads nothing and is forced offline (T13b unchanged); admin reads all, the customer reads their own. Mutation m1. |
| **M2** Existing `meal-images` objects may be unsafe and are publicly served | **Blocked on staging evidence and a mitigation decision (not closed)** | Tooling verified and runbook completed (section 6, "Status of review finding M2"). No object was inventoried, scanned, moved or deleted. | Scenario S: inventory, scan of 21 objects, per-object quarantine with refusals, restore outcomes (local fixtures only). |
| **L1** Revocation and a stale REPEATABLE READ snapshot | **Documented limitation** | Section 11, item 17. No claim of immediate revocation across existing database sessions. | — (behaviour of PostgreSQL snapshots; not changed) |
| **L2** `assign_staff_role` grants roles without checking the account | **Fixed** | Refuses (SQLSTATE 22023) an unknown account, a deleted account (`deleted_at`), a currently banned account (`banned_until > now()`) and an anonymous account (`is_anonymous`), for every role; for `admin` also an unconfirmed account (`email_confirmed_at`, else `confirmed_at`) and the flagged `customer` + `is_admin` profile. Columns are read from the row as JSON, so a check whose column the local schema lacks is skipped, except the admin confirmation: if neither confirmation column exists, the admin grant is refused (fail closed). A refused grant writes no role row and no audit record (the function raises before any write). | T26a–T26d (bare local schema); `staff_account_checks_hosted_shape.sql` H1–H10 adds the hosted Auth columns in a rolled-back transaction (eligible, unconfirmed, deleted, banned, expired ban, anonymous, support vs admin, no confirmation column). Mutation m2. |
| **L3** A rewrite rule could suppress audit inserts unnoticed | **Fixed** | `containment_violations()` reports every rule other than `_RETURN` on a `public` table (`unexpected rewrite rule`). The pre-existing-object snapshot includes rules, so the postcondition refuses one that appears. | Scenario M: a `DO INSTEAD NOTHING` rule on `security_audit_log` makes a role grant leave no audit row; the monitor reports it; removed afterwards. Scenario X: a pre-existing rule is refused with the state digest unchanged. Mutation m6. |
| **L4** The monitor cannot vouch for itself | **Fixed** | The reviewed fingerprint of `containment_violations()` is checked by the read-only staging preflight (`containment_monitor_absent_or_reviewed`) and by the new read-only `postdeploy_verify_readonly.sql`, which runs the monitor only after its definition matches. The value and the update process are in section 10. | Scenario B: all three copies of the fingerprint equal the clean application. Scenario L: a weakened monitor fails both checks and is not run. Mutation m6. |
| **L5** Profile guard and lock-order claims not proven | **Fixed** | No code change. Test T27 grants `UPDATE(role, is_admin, user_id)` on `user_profiles` to `authenticated` inside a subtransaction that is always rolled back, shows the guard trigger still refuses each column, and verifies the privileges are restored. The lock-order claim is kept because a test proves it: without the statement-level lock, a write that holds a row lock while its trigger is pending deadlocks with a concurrent writer. The REPEATABLE READ tests stay. | T27; `admin_concurrency_tests.sh` `lock_order` cases (READ COMMITTED and REPEATABLE READ): pass with the lock, **deadlock** with `trg_staff_roles_serialize` dropped (mutation m4). |
| **L6** The two migration files through the CLI | **Fixed** (procedure and tests; hosted CLI still unverified) | Section "Supported migration procedure" documents that the files are **not all-or-nothing** and the recovery procedure. | Scenario L with Supabase CLI 2.122.0: clean push; push under a non-`postgres` login refused; storage failure after the core file committed; diagnosis; re-run after the fix applies only the storage file. |
| **L7** Rollback could overwrite a later driver status | **Fixed** | A normalised driver is restored only when there is trustworthy evidence that nothing changed: status still `offline`, no `staff_roles` driver row in any state, and no audited approval or forced-offline record. Every other driver is kept as is and listed with the reason in `<archive>.drivers_status_reconciliation` for manual reconciliation. Claims corrected (section 9). | Scenario G: a driver approved, online, offline and revoked after the migration keeps `offline` and is listed for reconciliation; untouched drivers are restored. |
| **L8** Rollback took the password in the database URL | **Fixed** | `phase1c_rollback.sh` refuses a URL that contains a password (userinfo, empty or percent-encoded, or a `password`/`passfile` query key) without printing it, and never prompts (`psql -w`). The password comes from `PGPASSFILE`/`~/.pgpass` (preferred) or `PGPASSWORD`. | Scenario G t14–t19: four URL forms refused without echoing the secret; `PGPASSFILE` with `PGPASSWORD` unset connects; no password fails with "cannot connect" and no prompt. Mutation m7. |

**Mutation tests** (`supabase/tests/mutation_tests.sh`): each control is removed in a disposable database and the matching test must fail; an unmodified control run must pass. Results are in the revision-7 test log.

## 0e. Revision 6: remediation of the medium review findings (CTO assignment of 2026-10-26)
Starting point verified: `phase-1c-revision-5-review` at `855b96f085108ec356fb65843ca2edef0111d848`, clean working tree; the unchanged revision-5 harness was re-run first and passed (same pinned image digests). Each failure below was reproduced on disposable PostgreSQL 17.6 **before** the fix; the regression tests now run in every harness run.

| Finding | Root cause | Remediation | Regression evidence (local, `run_phase1c.sh`) |
|---|---|---|---|
| **M1** Concurrent administrator revocation can leave zero admins | `trg_staff_roles_require_admin` re-checked "an active admin remains" with a plain `SELECT`. Under REPEATABLE READ (and for the functions' authority check, also SERIALIZABLE) that read comes from the transaction snapshot, so two overlapping removals each saw the other admin as active. The rev-5 test only used READ COMMITTED. | Every write statement on `staff_roles` first takes one advisory lock (`trg_staff_roles_serialize`, BEFORE … FOR EACH STATEMENT, all writers; same lock and order as the functions, so no deadlock). After a row stops being an active admin, `staff_roles_require_admin()` (now SECURITY DEFINER, so RLS never hides a row) reads the remaining active admins **`FOR SHARE`**: READ COMMITTED sees the latest committed rows; REPEATABLE READ / SERIALIZABLE get a serialization failure (40001) instead of a stale read. `assign_staff_role`/`revoke_staff_role` check the caller's own admin row the same way, so a just-revoked admin cannot act on a stale snapshot. Paths inspected: the two functions, `service_role`/operator INSERT/UPDATE/DELETE (incl. role change and `INSERT … ON CONFLICT DO UPDATE`), `ON DELETE CASCADE` from `auth.users`, TRUNCATE (blocked). | **Before the fix (rev-5 code, PG 17.6):** 6 of 22 cases committed both removals and left **0 active admins** (functions, direct UPDATE, DELETE vs UPDATE, role change vs DELETE, function vs direct UPDATE, auth-user cascade, all REPEATABLE READ), and a revoked admin assigned a role from a stale snapshot. **After:** `admin_concurrency_tests.sh`, run twice per harness run: two admins revoking each other and every delete/update/role-change/cascade combination under READ COMMITTED, REPEATABLE READ and SERIALIZABLE; a failed (rolled-back) removal; removing every admin in one statement or one transaction; stale authority. Each case asserts the **committed** state (exactly one transaction committed, exactly one active admin, and which one). |
| **M2** No supported way to run the rollback | The two `.down.sql` files were outside `supabase/migrations/` (so `db push` never runs them), the SQL Editor was prohibited, psql was "not a supported procedure", the files had no commit gate, and storage and core were two separate transactions. | One generated file `supabase/rollback/phase1c_rollback.sql` (storage part, then core part) in **one** transaction with role check, preflight, postcondition and deferred commit gate (the role check is itself a gate step and is repeated in the preflight and postcondition: a revision-6 harness run showed that a separate role check skipped under `ON_ERROR_ROLLBACK=on` let a login role inheriting `postgres` commit; the same binding was added to both migrations), run only by `supabase/rollback/phase1c_rollback.sh` (section 9): target allowlist (staging project or local only), confirmation phrase, role `postgres`, database identity (seed record = `--expected-admin`), migration history, 0 violations, approval and backup references, audit export with checksums before any change, archive with an approval record, history rows removed, preserved data proven unchanged. | Scenario G: wrong targets (other project, remote host for `local`, `production`), missing/incorrect confirmation, unexpected database, missing backup reference or approval, existing or in-repo export directory, wrong login role, missing or newer migration history, the SQL run directly without the procedure, as a wrong role, and under `ON_ERROR_ROLLBACK=on` — each refused with the **complete database state digest unchanged**. Injected failure at the very end of the core part (a dependent view blocks the last `DROP FUNCTION`): exit 1, database unchanged. Success: exit 0, export verified, archive complete with approval record, history rows removed, exact BEFORE matrix, legacy driver statuses restored, orders and kiosk records unchanged. Repeat invocation (procedure and SQL): refused, unchanged. Scenario S: a failure in the core part leaves the storage part unapplied too (one transaction); success restores bucket limits and storage policies; every Storage object row unchanged. |
| **M3** An existing roles table skips a safety check | The preflight ran the initial-admin verification only when `staff_roles` had **no** admin row, and the seed returned early in the same case; `CREATE TABLE IF NOT EXISTS` accepted a table of any shape. Other conditional paths could also accept or overwrite unknown objects: `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` (12), `DROP … IF EXISTS` + `CREATE` for triggers and policies (incl. 11 on existing tables and 4 storage policies), the availability constraint added only when absent, `INSERT … ON CONFLICT DO NOTHING` for Kitchen A. | Section 0a2: the state of every such object **before any change** is captured. The preflight validates pre-existing new tables against the reviewed definition (49 entries: columns, constraints, indexes, triggers incl. enabled state, policies, RLS, owner; no column ACLs; grants by rule) and refuses a partial set; on a re-run every admin row needs its seed or assign audit record, there must be exactly one seed record and an active admin, every active admin must pass the initial-admin account checks, and Kitchen A must be the reviewed row; an existing availability constraint must be the reviewed definition. The postcondition requires the new tables to be exactly the reviewed definition and **every pre-existing object to be byte-for-byte what the migration defines**; otherwise the whole migration aborts (never a silent repair). The storage migration does the same for its 4 policies. The embedded definition is checked against a clean application in every run. | Scenario X (25 cases): first application with malformed tables plus a flagged admin row, a partial table set, an unknown `has_staff_role`, an unknown trigger, constraint or policy of a migration name; re-run with a dropped or disabled trigger, RLS off, an extra column, a dropped constraint, an extra index, extra grants (authenticated INSERT, anon SELECT, service_role TRUNCATE, a column grant), an extra or altered policy, an unaudited admin row, an audited admin with the flagged profile pattern, a changed Kitchen A, a removed seed record — **each refused with the complete database state digest unchanged**. A valid re-run is accepted and changes nothing. Scenario M: re-applying over a weakened `has_staff_role` is refused instead of silently repairing it. Storage: a pre-existing `staff_admin_insert_meal_images` of another definition is refused. |

## 0f. Revision 6: adversarial self-review (implementing engineer; **not an independent approval**)
Written by the engineer who implemented revision 6, after the final harness run. It is a self-review only; it does not replace the CTO's independent review and does not change the deployment verdict.

**What the self-review found and fixed before the commit:**
- **Role check not bound to the commit gate.** The first full rev-6 run showed that the rollback SQL, run directly with `psql -v ON_ERROR_ROLLBACK=on` by a login role that merely inherits `postgres`, **committed**: the separate role-check block failed, the runner ignored the error, and the preflight and postcondition still marked the gate. The same pattern existed in both migrations. Fixed: the role check is a gate step of the rollback and is repeated next to every gate step of the rollback and both migrations. Regression tests: scenario P (migration, wrong role, `ON_ERROR_ROLLBACK=on`, nothing applied) and scenario G (rollback SQL, wrong role, state digest unchanged).
- **State digest false positive.** The digest counted per-session `pg_temp_N` namespaces, so a valid re-run looked like a change. Excluded `pg_*` namespaces; the test would still catch any real schema, table, column, grant, policy, function or data change.

**Residual risks the engineer could not close (also in section 11):**
1. **M1, retries:** under REPEATABLE READ or SERIALIZABLE the losing admin change now fails with SQLSTATE 40001 instead of committing. A client that does not retry shows an error; no client uses those levels today. Admin writes are serialised by one advisory lock key (`hashtextextended('phase1c.staff_roles.admin', 0)`); unrelated code using the same key would wait, not corrupt.
2. **M1, privileged bypass:** a role that can disable triggers (table owner `ALTER TABLE … DISABLE TRIGGER`, or `session_replication_role = replica`) can still remove every admin. `containment_violations()` reports a disabled trigger, not a one-off replica session. This is outside the API roles' reach and is unchanged from revision 5.
3. **M2, local validation only:** the procedure was never run against hosted staging (by instruction). The pooler host form, `\copy` over the network and the hosted `postgres` login are unverified. The audit export is taken before the rollback transaction, so rows written in between are in the archive schema but not in the CSV export; the archive keeps every row.
4. **M2, not a complete restoration:** the rollback intentionally keeps the audit data (archived, not deleted), Storage objects, orders, kiosk records and any later driver status change; it does not touch hosted settings or Auth. It re-opens C1-C4, H2-H4 and the upload/listing holes. Forward recovery remains the preferred path.
5. **M3, fail-closed on platform drift:** the reviewed definition (49 entries) and the 12 function fingerprints come from the local 17.6 image and the evidence. Different default privileges, owners or policy text on staging make the migration abort (never repair). That is safe but could block deployment until the definition is re-reviewed.
6. **Low findings of the 2026-10-25 review** are not part of this assignment and remain open (section 11, item 15).

**Checked and not found:** no new SECURITY DEFINER function without `search_path = ''`; the new definer function `staff_roles_require_admin()` has EXECUTE revoked from `public`, `anon` and `authenticated`, returns `trigger` (PostgreSQL refuses a direct call) and is in the reviewed-function list with its fingerprint; no change to fee policy, kitchen rules, checkout (still disabled), historical orders, kiosk records or Storage objects; the initial-admin UUID is still the placeholder.

## 0d. Revision 5: remediation of the self-review findings (CTO decision of 2026-10-25)

| Finding | Remediation | Regression evidence (local, `run_phase1c.sh`) |
|---|---|---|
| **M1** The initial admin was derived from `user_profiles.role`/`is_admin`; a non-atomic run failed open and printed "nothing was changed" | **The initial admin is never derived from `user_profiles`.** The owner supplies one `auth.users` id. It is written into the marked line of section 0b of the core migration in a reviewed commit, and verified: it exists, its e-mail is confirmed, it is not deleted, banned or anonymous, and it does not have the illegitimate profile pattern `role=customer, is_admin=true`. The verification runs in the preflight **and again, independently, in the seed**. The seed inserts exactly one row and only when `staff_roles` has no admin row at all. The committed file still holds a placeholder, so **it refuses to run**. Each migration and rollback file has its own `BEGIN … COMMIT`. A **deferred commit gate** (two temporary tables linked by a deferred foreign key) makes `COMMIT` fail unless the preflight **and** the postcondition both completed. The messages no longer claim "nothing was changed" or "rolled back"; they say "aborting the migration transaction (its COMMIT cannot succeed)". One supported procedure is documented (section "Supported migration procedure"). | Scenario P: committed file refused ("initial administrator not supplied"); flagged, unknown and unconfirmed ids refused; with a customer's own profile set to `role=admin, is_admin=true` (the reproduced attack), a guard failure **and** a postcondition-only failure commit nothing under plain `psql -f`, `ON_ERROR_STOP` without `--single-transaction`, `--single-transaction`, and `ON_ERROR_ROLLBACK=on` (there the commit gate is what refuses the COMMIT). A clean plain `psql -f` run seeds only the supplied id; the customer-controlled admin profiles are not admins. Supabase CLI 2.122.0 `db push` (local container): failing guard → nothing applied, not recorded; clean push → applied and recorded, 0 violations. |
| **M2** `containment_violations()` matched write policies by name, SELECT exposure only as literal `true`, ignored views, unlisted definer functions, storage SELECT policies and PUBLIC-executable hooks | Rewritten (section "Monitoring"). Every policy in `public` and `storage` must equal a **reviewed definition**: table, name, mode, roles, command, `USING`, `WITH CHECK`. No view, materialized view or foreign table in `public`/`graphql_public` may be client-accessible. No client-accessible relation may exist in an unreviewed schema. No client-executable `SECURITY DEFINER` function in any schema except the 4 reviewed ones. Every migration function is fingerprinted (body MD5, definer flag, configuration). Auth hooks are checked by **effective** EXECUTE on `jsonb → jsonb` functions as well as explicit grants. Documentation states what it checks and **does not** check. | Scenario M: altered `USING` on `staff_admin_all_orders` and on the profile-update policy; role change on an owner-read policy; broad SELECT `USING (auth.uid() IS NOT NULL)` and `USING (1 = 1)`; view, `security_invoker` view, materialized view, foreign table; unreviewed client schema; extra `SECURITY DEFINER` function (public and other schema); `has_staff_role` replaced by `select true`; PUBLIC-executable hook in a custom schema. **Every one is reported**; the revert returns to 0. Scenario S: weakened storage INSERT policy (`… or true`), SELECT policy on the private `src` bucket, re-added `Public Access`, write policy on `storage.buckets` — all reported. |
| **M3** Staging-impact table incomplete | Section 7 lists every affected existing app flow with file and line, including those that fail **silently**. Section 7b proposes a staging compatibility test plan; **deployment waits for its approval**. | Code inspection (not executable locally) |
| **L1** `anon`/`authenticated` kept TRUNCATE, REFERENCES, TRIGGER (and PostgreSQL 17 MAINTAIN) | Revoked on every `public` table. `service_role` loses TRUNCATE on `staff_roles`, `security_audit_log`, `kitchens`. Both tables have a statement-level TRUNCATE-blocking trigger. Monitored. | T21: customer `TRUNCATE public.meals` denied, rows intact, no such privilege left on any table. Scenario M: re-granting TRUNCATE, TRIGGER/REFERENCES or audit TRUNCATE is reported. The matrix now shows MAINTAIN (`m`). |
| **L2** Two admins revoking each other at once left zero admins | `assign_staff_role`/`revoke_staff_role` take a transaction-level advisory lock **before** the authority check. Trigger `trg_staff_roles_require_admin` (after UPDATE/DELETE, same lock, fresh snapshot) refuses any change by **any writer** that leaves no active admin. Postcondition requires an active admin; monitored. | Scenario M: concurrent mutual revocation → exactly one succeeds, the other is refused, 1 active admin remains. T22: `service_role` UPDATE/DELETE of the last admin and owner TRUNCATE are refused. Scenario M reports "no active admin staff role" when forced with triggers bypassed. |
| **L3** A driver could stay online when approval was removed outside `revoke_staff_role` | Trigger `trg_staff_roles_driver_offline` (after UPDATE/DELETE on `staff_roles`, every writer) sets the driver offline and audits it (`drivers.status.forced_offline`). Monitoring check "driver online without an active driver approval". | T23: approval revoked by a direct `service_role` UPDATE → offline; approval row DELETED → offline; 2 audit rows. T13b (revocation through the function) still passes. Scenario M reports an unapproved online driver when forced. |
| **L4** Quarantine: removal of the whole suspicious set, CDN-dependent verification, restore failures reported as success | `remove` takes **one** `--path` and that object's `--sha256`. An entry whose only reason is the provenance flag needs `--allow-provenance-only`. Deletion is verified through the **authenticated** Storage API. A still-served public URL is recorded and printed as a WARNING. `restore` distinguishes `restored`, `refused_by_bucket_limits` (413/415) and `failed` (anything else, incl. target exists, unknown path). Exit 0 / 3 / 1. Nothing is removed without a verified SHA-256-matching copy and `--confirm-remove` + `--approved-by`. | Scenario S: missing confirm flag, missing `--sha256`, a scan-clean image, a wrong hash and a provenance-only entry without its flag are each refused with the bucket unchanged. One removal removes exactly one object of a mixed set. Behind a local caching proxy (CDN stand-in) the removal is verified via the authenticated API and the cached public URL is reported. Restore: valid PNG → 0; SVG → 3 (refused by limits); existing target → 1, not overwritten; valid + unknown path → 1, valid one restored. |
| **L5** Scan used unencoded object names in URLs | Every path segment percent-encoded (`public_url()`); the unencoded `public_url_path` field was removed from the inventory. | Offline unit tests (space, `?`, `#`, `%`, `/`, unicode). End to end: objects named `seed space.png` and `seed?q.png` are hashed exactly (equal to the authenticated download). The Storage API v1.79.30 rejects `#` and `%` in new keys (recorded). |
| **L6** No execution-role check | Every migration and rollback first aborts unless `current_user = 'postgres'`, before any change. | Scenario P: a login role that has not switched to `postgres` is refused, nothing applied. |
| Hygiene | Accidentally committed `supabase/tools/__pycache__/*.pyc` removed; `.gitignore` ignores `__pycache__/` and `*.pyc`. | `git ls-files` |
| P2: `drivers.status` nullable | `NOT NULL` after normalisation. A legacy NULL is accepted by the preflight, normalised to `offline`, audited with old value JSON `null`, and restored as NULL by the rollback. | T24; scenario G (NULL normalised, audited, restored). |
| P2: rollback dropped the audit trail | The core rollback **archives** `kitchens`, `staff_roles`, `security_audit_log` (rows unchanged) into a new private schema `phase1c_archive_<UTC timestamp>` with no access for `anon`, `authenticated` or `service_role`. It drops their triggers and policies, and the `staff_roles → auth.users` foreign key so an account deletion cannot change archived rows. Section 9 states exactly which dimensions the rollback comparison covers. | Scenario G: every row present in the archive; the archive is not usable by client roles or `service_role`; BEFORE matrix restored. |
| P2: image-content limitation, browser claims | Unchanged and still explicit (section 6). Browser results are stated for Chromium 141 and the local Storage API v1.79.30 only. | `LIMIT` line; browser test |
| P2: anonymous listing | **Restricted.** `Public Access` (SELECT for anyone) is replaced by an admin-only SELECT policy. Public object URLs do not use RLS and keep working. | S23 anon list → 0 objects; S24 customer → 0; S25 admin lists; S21 public URL read still 200; S12 admin upsert still works. BEFORE: anon and customer list all 17 objects. |
| P2: no automatic deletion or quarantine | Unchanged: no migration touches objects; quarantine is reversible and every write step is a separate approval. | "existing objects preserved" |

## Deployment prerequisite: initial administrator
**Why:** `user_profiles.role` and `is_admin` are writable by any customer on staging today (C1), so they cannot identify a trusted administrator.

**Steps (owner and CTO; nothing here is done by this package):**
1. The owner confirms **in writing** which account is the initial administrator. They give its `auth.users` id (UUID), not an e-mail or a profile.
2. Read-only check in the staging SQL Editor: replace the marked value in `supabase/tests/verify_initial_admin_readonly.sql` and run it. Every required check must be `true`: the id is a UUID, the user exists, its e-mail is confirmed, it is not deleted, banned or anonymous, and it is not the illegitimate profile pattern. It prints only the e-mail **domain**, for recognition.
3. A reviewed commit replaces **only** the quoted value on the line marked `-- PHASE1C_INITIAL_ADMIN_USER_ID` in section 0b of `supabase/migrations/20261016170000_phase1c_security_containment.sql`. Nothing else in the file may change in that commit.
4. The migration repeats the same checks in its preflight and, independently, in the seed. It aborts if any fails.

**Never** guess the id, take it from `user_profiles`, or seed the account with `role=customer, is_admin=true`. That account is preserved unchanged for investigation.

## Supported migration procedure
- **Supported:** `supabase db push` from a checkout of the reviewed commit (section 10, step 6).
  - Verified locally with **Supabase CLI 2.122.0** against a local container (`--db-url postgresql://…@127.0.0.1`). A failing guard applies nothing and the migration is not recorded. A clean push applies it and records it in `supabase_migrations.schema_migrations`.
  - **Not verified:** `--linked` against hosted staging, including which login role the CLI uses there. If it does not run as `postgres`, the role check aborts before any change. That fails closed and blocks deployment until it is resolved.
- **Each file runs as one transaction by itself:** its own `BEGIN … COMMIT`, a role check, and the deferred commit gate.
  - Locally, plain `psql -f`, `psql -v ON_ERROR_STOP=1 -f`, `psql --single-transaction` and `psql -v ON_ERROR_ROLLBACK=on` were all shown to commit nothing when a guard or the postcondition fails.
  - These psql invocations are test evidence, **not a supported procedure for staging**.
- **The two files are not all-or-nothing (revision 7, L6).** `supabase db push` applies and records each file separately. If the storage file fails after the core file committed, the core containment stays applied and recorded, the storage file is neither applied nor recorded, and `meal-images` keeps its earlier policies and limits. Checkout stays blocked either way. Tested with CLI 2.122.0 (scenario L).
  - **Diagnosis (read-only):** `select version from supabase_migrations.schema_migrations where version like '2026101617%';` (expect only `20261016170000`); `select * from public.containment_violations();` (expect only `storage` rows); the CLI error names the failing check.
  - **Recovery:** fix the cause the error names (for example a bucket limit changed by hand), confirm the read-only checks, then run `supabase db push` again from the same reviewed commit; it applies only the storage file. Never roll back the core migration automatically and never re-enable checkout as a recovery step; a rollback needs the separate CTO-approved procedure (section 9).
  - **Login role:** the CLI switches to `postgres` (`SET SESSION ROLE postgres`) only for `supabase_admin` and `cli_login_*` logins; any other login runs as itself and the role check refuses it before any migration change (tested with a non-`postgres` login). The CLI still creates its own history schema `supabase_migrations` first, owned by that login; hand it to `postgres` (`reassign owned by <login> to postgres`) before retrying with the right login. Which login the hosted `--linked` path uses is not verified.
- **Rollback (supported, revision 6):** only `supabase/rollback/phase1c_rollback.sh`, with written CTO approval (section 9). It runs `supabase/rollback/phase1c_rollback.sql` with psql as **one** transaction for both migrations.
- **Prohibited:**
  - the Dashboard SQL Editor: its transaction behaviour for these files is not verified;
  - splitting a file, or removing its `BEGIN`/`COMMIT`, role check or gate;
  - running the rollback SQL in any other way than through `phase1c_rollback.sh` (run directly, it lacks the variables it requires and fails before any change; tested);
  - running the rollback without CTO approval.

## 1. Repository state
- `main`: `0cb0fe0`. Nothing is merged.
- This branch contains only `supabase/`, `docs/v1/` and `.gitignore` changes. The unmerged Phase 0, 1A and 1B branches are not included.
- The older unapproved 1C files (`0c979ec`) are superseded and not used.

## 2. Confirmed decisions applied
| Decision | Applied as |
|---|---|
| Internal kitchen/cashier model | `kitchens` (Kitchen A, code `A`, active; no limit on count). `staff_roles` holds `admin`, `support`, `cashier`, `kitchen_staff`, `driver`. Cashier and kitchen staff need a kitchen; admin and support are global; drivers may be kitchen-scoped. |
| One server-managed staff-role table | `staff_roles` is the **only** database authority. Every `is_admin` and JWT-role policy is removed. The reviewed-policy check rejects any that return. |
| Initial administrator | Owner-supplied `auth.users` id only (prerequisite above). Never derived from `user_profiles`. |
| Partner model retired | No partner write policy remains (rows preserved, own-row reads kept). |
| Staging only | No remote access from this work. The harness cannot connect to a remote database. |
| Kiosk off; history kept | Kiosk policies and grants retired. **No kiosk, product, stock, closing or order row is changed.** |
| Illegitimate `customer` + `is_admin` account | No authority (T03e, T19, S06); refused as initial admin (scenario P). Profile row kept unchanged (T03f). |
| Fees not approved | Nothing implemented; checkout disabled. |

## 3. Evidence and baseline
- **Evidence:** `supabase/evidence/catalog_2026-10-15.json`, owner-run and read-only, PostgreSQL 17.6, with provenance and SHA-256. Scanned: no secrets or personal data.
- **Baseline:** `supabase/baseline/staging_schema_2026-10-15.sql`.
  - Generated by `generate_baseline.py`, verbatim from catalog text.
  - **Test fixture only.** It is not a migration, sits outside `supabase/migrations/`, and refuses to run on a database that already has the schema.
- **Round-trip:** rebuilt on `supabase/postgres:17.6.1.178`, then compared with the owner's own query. Identical in **13 named sections** (24 tables, 278 columns, 66 constraints, 52 indexes, 56 public policies, 5 functions, 2 triggers, 48 client privilege rows, extensions; no enums, views, Realtime publication or column ACLs).
  - The full scope and the omitted dimensions are listed in `supabase/evidence/README.md`.
  - **This proves fidelity in those sections only. It does not prove a complete clone, and it does not prove the state of live staging today.**

## 4. What is verified where
| Item | Migration guard (aborts; commit impossible) | Mandatory staging preflight (read-only) | Neither: manual mandatory check |
|---|---|---|---|
| Execution role is `postgres` | yes (first statement) | yes | — |
| Initial administrator | yes (preflight + seed): owner-supplied id, exists, confirmed, not deleted/banned/anonymous, not the illegitimate pattern | separate read-only check `verify_initial_admin_readonly.sql` | **owner's written confirmation of the id** |
| Pre-existing `kitchens`/`staff_roles`/`security_audit_log` (rev 6) | yes: none or all three; exactly the reviewed definition (preflight and postcondition); admin rows with audit provenance, one seed record, active admins pass the account checks, Kitchen A as reviewed | `phase1c_not_yet_applied (U9)` | — |
| Pre-existing objects with a migration name (functions, triggers, policies, availability constraint, storage policies) (rev 6) | yes: must be byte-for-byte what the migration defines, else abort (never overwritten) | no | — |
| Table set; public policy names; public policy text (MD5 `d2cb0f4d…`) | names before the change; **exact definitions after** (postcondition) | yes (set + MD5) | — |
| Policies the migration keeps are unchanged from the evidence | postcondition (exact definitions) | MD5 | — |
| Required columns; `create_order_transaction` signature | yes | signature | — |
| `drivers.status` values (`online`/`offline`/`pending`/`rejected`/NULL) | yes | yes | — |
| U3: unexpected roles, SUPERUSER/BYPASSRLS, client-role attributes, memberships | yes | yes | — |
| U3: Auth hooks | DB side: explicit grants to `supabase_auth_admin`, and `jsonb → jsonb` functions it can effectively execute | yes (same two checks) | **Dashboard → Authentication → Hooks: none enabled** |
| U4: event triggers (allowlist of 6 Supabase functions + `public.rls_auto_enable()`) | yes | yes | — |
| U5: `authenticator` NOSUPERUSER, NOBYPASSRLS, NOINHERIT | yes | yes | — |
| U5: `authenticator` preloads `safeupdate` | **no** | yes | — |
| U6: no CREATE for `PUBLIC`/`anon`/`authenticated`/`authenticator` on platform schemas | yes | yes | — |
| `public` relations owned by `postgres`; RLS on; only expected grantees | yes | yes (tables); also no column grants | — |
| Storage policies equal evidence (MD5 `8aa1ab5d…`); bucket set `meal-images:public, src:private`; migration role can manage `storage.objects` policies | storage migration: unknown policies, bucket state, permission | yes | — |
| PostgREST exposed schemas | no | no | **Dashboard → API settings: `public`, `graphql_public` only** |
| Column types and modifiers beyond the evidence; data outside the guarded tables | **no** | **no** | not verified by this package |

## Monitoring: what `containment_violations()` checks and does not check
`select * from public.containment_violations();` (run as `postgres`; not executable by clients). **Zero rows means only that none of these checks found a problem. It is not a proof that the database is safe.**

**Checks:**
- **drift:**
  - roles, SUPERUSER/BYPASSRLS, client-role attributes, memberships (allowlists);
  - event-trigger functions;
  - `authenticator` attributes;
  - schema CREATE for client roles/PUBLIC;
  - Auth hooks: explicit grants to `supabase_auth_admin`, and `jsonb → jsonb` functions it can effectively execute;
  - `public` relations (tables, views, materialized views, foreign tables): owner, RLS on tables, grantees, PUBLIC grants.
- **containment:**
  - every `public` policy equals a reviewed definition (33 entries: mode, roles, command, `USING`, `WITH CHECK`), and no reviewed one is missing;
  - anon privileges other than SELECT on `meals`;
  - `authenticated` TRUNCATE/REFERENCES/TRIGGER/MAINTAIN;
  - TRUNCATE on `staff_roles`/`security_audit_log`/`kitchens` for `service_role` or clients;
  - client-accessible views, materialized views, foreign tables in `public`/`graphql_public`;
  - client-accessible relations in any unreviewed, non-platform schema;
  - privileged `UPDATE` columns;
  - retired and server-managed tables;
  - unsafe or anon-executable functions;
  - client-executable `SECURITY DEFINER` functions (any schema) other than `has_staff_role`, `assign_staff_role`, `revoke_staff_role`, `set_driver_availability`;
  - definer functions without `search_path`;
  - fingerprints of the 11 migration functions (revision 6 adds `staff_roles_serialize`);
  - 8 guard triggers present and enabled (revision 6 adds `trg_staff_roles_serialize`);
  - no rewrite rule other than `_RETURN` on any `public` table (revision 7, L3: a rule could silently discard audit inserts);
  - driver availability CHECK (exact definition) and `NOT NULL`;
  - at least one active admin;
  - no online driver without approval;
  - default privileges of `postgres`.
- **storage:**
  - every policy on every `storage` table (all commands, including SELECT/listing) equals a reviewed definition (4 entries), and none is missing;
  - no public bucket other than `meal-images`;
  - `meal-images` exists with the approved limits.

**Does not check (limitations):**
- hosted configuration that SQL cannot see: Auth hook settings, PostgREST exposed schemas, JWT settings, Storage/CDN headers, Realtime authorization;
- the bodies of functions it does not fingerprint (platform functions such as `auth.uid()`, and the pre-existing `create_order_transaction` and trigger functions, which are only checked for client EXECUTE);
- grants and policies in platform schemas other than `storage` (`auth`, `extensions`, `graphql`, `realtime`, `vault`, …), including the platform's own client-readable views there (e.g. `extensions.pg_stat_statements`);
- whether a reviewed policy is *semantically* right (it detects change, not correctness), data-level mistakes (e.g. a wrong person granted admin by a legitimate admin), and anything done by a role that can replace this function (`postgres` or a superuser): `containment_violations()` does not fingerprint itself (revision 7: the read-only preflight and `postdeploy_verify_readonly.sql` check its fingerprint before trusting it, section 10);
- a reviewed function that was **dropped** (the fingerprint check only compares functions that exist; dropping one fails closed, e.g. `set_driver_availability` stops working);
- reviewed definitions are compared as PostgreSQL 17 prints them. A different major version may print them differently, which fails closed (reports every policy).

Run it after every deployment and regularly. Treat any row as an incident.

## 5. Migrations

### `20261016170000_phase1c_security_containment.sql` (core)
| § | Change | Closes |
|---|---|---|
| — | `BEGIN`; `lock_timeout` | atomicity |
| 0a | Role check (`postgres` only), deferred commit gate | M1, L6 |
| 0a2 | State of every conditionally created object captured before any change; reviewed definition of the new tables (rev 6) | rev 6 M3 |
| 0b | **Owner-supplied initial-admin id (placeholder: refuses)**; temporary verification helper | M1 |
| 00 | `containment_violations()` (read-only; not client-executable) | monitoring |
| 0 | Preflight: schema match, driver statuses, initial admin, **all drift rows**; marks the gate | drift, M1 |
| 1 | Default privileges of `postgres` revoked from clients; no PUBLIC EXECUTE on new functions | M2 (orig.) |
| 2–3 | `kitchens`; `staff_roles`; append-only, non-truncatable `security_audit_log`; `has_staff_role`; audited admin-only `assign_staff_role`/`revoke_staff_role` (serialized, locking authority check, last-admin protection); triggers on `staff_roles`: one advisory lock per write statement (every writer), at least one active admin with a locking read (every writer, every isolation level), driver offline on revoked/deleted approval, no TRUNCATE; seed of the **owner-supplied** admin | C1, L2, L3, rev 6 M1 |
| 4 | `user_profiles` guard trigger (raises 42501); column-level UPDATE only on 10 profile columns | C1 |
| 5 | 9 `is_admin` policies → `has_staff_role('admin')`. **No admin read of profiles.** | C1, least privilege |
| 5b | `collaborators_update_own_orders` dropped (partner writes retired) | partner |
| 6–8 | Drivers read assigned orders only while they hold an active `driver` role (rev 7 M1); all client INSERT/UPDATE on `orders`/`order_items` dropped; `daily_closings` service-only; `order_status_updates` owner/admin read only | C2, C3, C4, H2 |
| 9 | Driver approval = active `staff_roles` `driver` row; `drivers.status` availability only (CHECK, **NOT NULL**), set through `set_driver_availability()`, enforced for every writer; legacy values (incl. NULL) audited, then normalised to `offline` | H3, P2 |
| 10 | `create_order_transaction` and `calculate_driver_weekly_earnings`: no client EXECUTE; `search_path=''` (not reactivated) | H4 |
| 11–12 | 11 kiosk policies retired; `anon` keeps only SELECT on `meals`; `authenticated` loses kiosk and financial tables; **TRUNCATE/REFERENCES/TRIGGER/MAINTAIN revoked from clients** | defence in depth, L1 |
| 13 | **Postcondition:** zero `drift` and zero `containment` rows; an active admin exists; new tables exactly as reviewed; Kitchen A as reviewed; every pre-existing object unchanged by the migration (rev 6); marks the gate | rev 6 M3 |
| — | `COMMIT` (fails unless the gate is complete) | M1 |

### `20261016171000_phase1c_storage_meal_images.sql` (storage)
- **Execution:** own `BEGIN … COMMIT`, role check, deferred commit gate.
- **Preflight:**
  - the core migration is applied;
  - `storage.objects` and `storage.buckets` exist;
  - the `meal-images` bucket exists;
  - no unreviewed `storage.objects` policies;
  - **the migration role can manage `storage.objects` policies**: it owns the table or is covered by `supautils.policy_grants`. Locally, `storage.objects` is owned by `supabase_storage_admin` and `postgres` gets policy rights only through `supautils.policy_grants`;
  - no drift.
- **Change:**
  - drops the 3 staging write policies **and `Public Access`**;
  - a pre-existing policy with one of its 4 names must already be the reviewed definition, otherwise the postcondition aborts (rev 6; never overwritten);
  - creates admin-staff-only SELECT, INSERT, UPDATE and DELETE policies for `meal-images`. Public object URLs keep working because they do not use RLS. Listing the bucket becomes admin-only;
  - sets `file_size_limit = 5242880` and `allowed_mime_types = {image/jpeg,image/png,image/webp}`. The previous values are logged first; `public` is untouched. A re-run on an approved bucket changes and logs nothing;
  - no object row is changed.
- **Bucket guard:** aborts if the bucket is missing, not public, or has limits other than the evidence values (NULL) or the approved values.
- **Postcondition:** `containment_violations()` returns **zero rows of every category**.

**Rows the package changes:**
- `drivers.status` of unapproved drivers → `offline` (the old value, including NULL, is logged first);
- new rows in `kitchens`, `staff_roles` and `security_audit_log`;
- the `meal-images` row of `storage.buckets` (limits only).

Historical orders, card orders and kiosk records are untouched (T11, T15).

## 6. Storage investigation and verification
- **Evidence:**
  - Bucket `meal-images`: public, no size limit, no MIME limit.
  - Bucket `src`: private, no policies.
  - `storage.objects` policies: "Authenticated users can upload" (INSERT, any signed-in user), "Users can update own uploads" and "Users can delete own uploads" (owner), "Public Access" (SELECT for anyone, which also allows listing).
  - `storage.buckets` has no policies, so clients cannot create buckets.
- **Real-API reproduction:**
  - Ran `ghcr.io/supabase/storage-api:v1.79.30` against the 17.6 database; its own 74 migrations created the `storage` schema.
  - JWTs were signed with a throwaway local secret.
  - With the staging policies:
    - a **customer can upload, overwrite, upsert and delete in `meal-images`**, and so can the flagged account;
    - **anonymous users and customers can list every object** (names, ids, metadata);
    - anonymous uploads were already refused.
- **After the migrations:** **25/25 HTTP checks pass.** Each asserts the Storage API's own status code: `403` policy denial, `415` invalid MIME type, `413` too large. Policy checks upload a valid PNG, so they cannot pass because a limit rejected the request.

  | Check | Result |
  |---|---|
  | anon upload | 403 |
  | customer upload, overwrite, upsert, delete | 403 |
  | flagged account upload | 403 |
  | customer creates a bucket | 403 |
  | customer writes `src` | 403 |
  | admin upload `image/png`, `image/jpeg`, `image/webp`; admin upsert | 200 |
  | admin upload `image/svg+xml`, `image/gif`, `text/html`, `application/octet-stream`; overwrite to SVG | 415 |
  | exactly 5,242,880 bytes | 200 |
  | 5,242,881 bytes | 413 |
  | bucket configuration read from the API | public, 5242880, jpeg/png/webp |
  | public read; admin delete | 200 |
  | anon / customer list the bucket | 0 objects returned |
  | admin staff list the bucket | objects returned |

  The app's admin upload path (`upsert: true`) keeps working. The app reads images by public URL only. No `list()` call exists in the app, so restricting listing breaks nothing in the app.
- **Also verified locally (self-review probes, 2026-10-25):** after the migrations a customer is denied:
  - signed upload URL creation;
  - TUS/resumable upload;
  - copy;
  - move;
  - delete;
  - bucket update.
  
  The S3 protocol endpoint was **not** tested.
- **Per-object info endpoint:** `GET /object/info/public/meal-images/<name>` still returns metadata for a known name. That is not enumeration: it needs the exact name.
- **How to verify against hosted staging:**
  1. Preflight checks `storage_*` must pass.
  2. After deployment, `select * from public.containment_violations()` must return 0 rows.
  3. Run the same HTTP checks with `supabase/tests/storage_api_tests.sh`, using staging's Storage URL and **test accounts only**. **Not done** (no access, by design).
- **Bucket limits (CTO-approved):** 5 MiB and `jpeg`/`png`/`webp` only.
  - The size limit is the **bucket's own** setting. The test container's global `FILE_SIZE_LIMIT` is 50 MiB, so the 413 at 5,242,881 bytes can only come from the bucket.
  - Before the migration, the same requests (SVG, GIF, HTML, octet-stream, over-size) all succeed with HTTP 200.

### Limitation: the MIME allowlist does not validate image bytes
The Storage API compares the **declared** `Content-Type` header with `allowed_mime_types`, and the body length with `file_size_limit`. It does not inspect or decode the bytes.

The harness proves this on every run: an SVG body with a `<script>` element, uploaded by an admin with `Content-Type: image/png`, is **accepted** (`LIMIT … -> 200`). Copying an object to a `.svg` name is also allowed for admins. **The bucket can therefore hold bytes that are not a valid image.**

### Serving behaviour: measured, not assumed
Measured by `supabase/tests/browser_serving_tests.js`, which runs in every harness run.

**Setup:** Storage API `v1.79.30` (local); Chromium `141.0.7390.37` (Playwright). Each object is opened by direct navigation to its public URL and embedded as `<img>`.

| Object (as stored) | Served `Content-Type` | `X-Content-Type-Options` | Direct navigation | Inside `<img>` |
|---|---|---|---|---|
| Real SVG with `<script>`, declared `image/svg+xml` | `image/svg+xml` | **absent** | **script EXECUTES** | no execution (image decodes) |
| SVG bytes declared `image/png` | `image/png` | **absent** | no execution in this Chromium | not decoded |
| HTML declared `text/html` | `text/plain` (the API rewrites it) | **absent** | no execution | not decoded |
| Valid PNG | `image/png` | **absent** | no execution | decodes |

**What this does and does not show:**
- **These results hold only for Chromium 141 and the local Storage API v1.79.30.** Not for Safari, Firefox, old browsers, mail clients, download handlers, or hosted Supabase. Hosted Storage serves through a CDN whose headers were not observed.
- **`nosniff` is not returned.** Not sending it is not a proof of safety for mislabelled content.
- **Real SVGs are actively dangerous.** Any SVG already in the bucket runs script when its URL is opened directly, on the Storage origin.
- **Conclusion:** every existing object that has not been content-validated is treated as **potentially unsafe** until the scan has classified it. New uploads are limited to `jpeg`/`png`/`webp` by declared type, but their bytes are still unvalidated.

Only admin staff can upload, which limits the exposure. If byte-level verification is required, the proposal is a trusted server-side path (**not implemented; CTO decision**):
1. **Admins stop writing `meal-images` directly.** The admin app uploads to a **private** `meal-images-incoming` bucket (admin staff only, same limits as an early filter).
2. **A trusted Edge Function** (service role, invoked with the admin's JWT; it re-checks `has_staff_role('admin')`) checks the object:
   - magic bytes against the declared type;
   - **fully decodes** it with a real decoder, rejecting anything that does not decode;
   - enforces maximum pixel dimensions;
   - **re-encodes** to WebP or JPEG, which strips EXIF/GPS and embedded payloads;
   - writes the result to `meal-images` under a server-generated name;
   - deletes the incoming object and audits the action.
3. **Admin-staff INSERT/UPDATE on `meal-images` is then removed.**
4. **Tests:** polyglot and mislabelled files rejected; oversize pixel counts rejected; output always decodes; EXIF removed.

### Existing objects: inventory, content scan and reversible quarantine
- **No migration deletes, changes or quarantines any existing object** (tested: "existing objects preserved"). Nothing is quarantined automatically.
- The new limits apply to uploads from now on. Objects already in staging's bucket stay served until the CTO approves each step below.

**Step 1: per-object inventory (read-only, SQL Editor).** `supabase/evidence/meal_images_inventory_readonly.sql` returns, for every object:
- id and path;
- declared MIME type and size;
- created, updated and last-accessed timestamps;
- cache control and the backend ETag (not a verified hash);
- extension;
- flags;
- uploader **class** only. **No user id, e-mail, name or phone.**

**Step 2: content scan (read-only; staging run needs approval).** `supabase/tools/meal_images_scan.py`:
- downloads each object over its **public** URL, with every path segment percent-encoded, without credentials, into a fresh directory with index-based file names;
- records SHA-256;
- detects the real format from signatures;
- **fully decodes** JPEG/PNG/WebP with Pillow in a limited child process. **Nothing is rendered or executed.**

It reports every reason an object is suspicious:

| Reason | Meaning |
|---|---|
| `fetch_failed` | Object could not be downloaded |
| `size_mismatch_inventory` | Downloaded size differs from the inventory |
| `over_5_mib` | Larger than 5 MiB |
| `declared_type_not_approved` | Declared type is not jpeg/png/webp |
| `detected_format_not_approved` | Real format is not jpeg/png/webp |
| `type_mismatch` | Declared and real format differ |
| `extension_mismatch` | Extension does not match the declared type |
| `decode_failure` | Image does not decode |
| `pixel_limit_exceeded` | Decompression-bomb guard triggered |
| `embedded_markup` | Script or markup bytes inside a decodable image |
| `non_staff_uploader` | Provenance only: uploaded by a non-staff account |

- **Recommended for staging:** run the fetch, then run `--offline` inside a disposable container with `--network none --read-only --memory 2g`.
- **Local result:** 21 objects classified exactly as expected, including names with a space and a `?`.

**Step 3: reversible quarantine (each write step needs explicit CTO approval, per object for removal).** `supabase/tools/meal_images_quarantine.py`. The service key is read from the environment and never printed or stored.
1. **`plan`** (read-only): manifest of suspicious objects. Entries whose only reason is `non_staff_uploader` are marked `provenance_only`.
2. **`copy --confirm-copy`:**
   - creates the **private** bucket `meal-images-quarantine`; aborts if it exists and is public;
   - downloads each object with the service key and requires its SHA-256 to equal the scan;
   - stores the bytes as inert `application/octet-stream` plus a JSON sidecar;
   - reads both back and verifies them.
3. **`verify`** (read-only): re-checks every copy.
4. **`remove --path P --sha256 H --approved-by NAME --confirm-remove [--allow-provenance-only]`:**
   - acts on **one** object, which must be a manifest entry with a verified copy;
   - requires the stated SHA-256 to equal the manifest, the quarantine copy and the live object;
   - deletes through the Storage API and **verifies through the authenticated API** that the object is gone;
   - checks the public URL as well. If a CDN or cache still serves it, the tool prints a WARNING and records `public_url_still_served: true` (purge, or wait for expiry);
   - records who approved it and when.
5. **`restore --path … --confirm-restore`:**
   - puts the exact bytes back with the original `Content-Type` and verifies SHA-256 through the authenticated API;
   - `refused_by_bucket_limits` (413/415) leaves the copy in quarantine;
   - any other outcome is a failure: target already exists (not overwritten), unknown path, missing copy, other errors;
   - exit codes: 0 restored, 3 refused by limits only, 1 any failure.

**Nothing has been run against staging.**

### Status of review finding M2 (2026-10-26): **not closed**
Blocked on staging evidence and a mitigation decision. **This finding must not be marked closed until the required staging evidence and the mitigation decision are supplied through a separately authorized task.**

**Verified in revision 7 (local only):**
- **Inventory** (`meal_images_inventory_readonly.sql`): read-only SELECT on `storage.objects`/`storage.buckets`; no user identities in the output. Run against the local Storage fixture in scenario S.
- **Scan** (`meal_images_scan.py`): downloads bytes only; **never renders or executes content**. SVG, HTML and other formats are read as bytes and never passed to a browser, renderer or interpreter; only approved image formats are decoded, with Pillow, in a separate `python3 -I` process limited to 1.5 GiB of memory and 20 s of CPU, with a decompression-bomb pixel limit. The fetch and the analysis can be split; run the analysis with `--offline` in a disposable container without network (`--network none --read-only --memory 2g`). Local result: 21 fixture objects classified as expected.
- **Quarantine** (`meal_images_quarantine.py`): a separate tool, never invoked by a migration, the scan or the rollback; **nothing is quarantined or deleted automatically**. `copy` only copies (originals stay served); removal acts on one object at a time and requires `--path`, the matching `--sha256`, `--approved-by` and `--confirm-remove`; every step is reversible with `restore` from the private quarantine copy. Each write step needs explicit CTO approval.

**Public-serving risk (unchanged by Phase 1C):** the bucket is public, and public object URLs bypass RLS. Any object already in it, including a real SVG with script (measured to execute on direct navigation in Chromium 141), stays publicly served until it is classified and, with approval, quarantined. The local Storage API returns **no `X-Content-Type-Options: nosniff`** header.

**Decision needed (owner/CTO, not taken here):** either (a) serve images with protective headers (`nosniff`, a restrictive `Content-Security-Policy` / `Content-Disposition` for non-image types) if hosted Storage or a proxy can set them, or (b) serve meal images from a **separate image origin** (a CDN or proxy domain with no session cookies and no app on it) so that active content cannot run on an origin that matters, combined with the byte-validating upload path above. Neither is implemented.

**Unverified (no hosted access by instruction):** the actual content of staging's `meal-images` objects; the staging inventory itself; the headers and caching of the hosted Storage CDN; whether `nosniff` is sent there.

**Required to close (separately authorized task):** the staging inventory and scan output reviewed; observed hosted/CDN response headers for each object class; the CTO's mitigation decision (headers or separate origin) and, if chosen, per-object quarantine approvals.

## 7. Expected staging impact (existing, unchanged client app)
**The client app on `main` is unchanged by this package.** After deployment it will not behave correctly in the flows below. Existing **open orders** cannot be advanced by drivers; only an admin staff account (admin orders screen) or a trusted server (`service_role`) can change them. **Do not deploy until a staging compatibility test plan is approved (7b).**

| Flow | Code | Behaviour after deployment | Silent? | Unblocked by |
|---|---|---|---|---|
| Checkout (customer creates an order) | `app/(app)/checkout.tsx:55`, `:87` | INSERT denied (no policy) | no (error) | Trusted `create_order`, blocked on the **fee decision** |
| Driver accepts an order | `app/(driver)/index.tsx:263-284` | UPDATE matches 0 rows | **yes**: the app shows "Order Taken" | A trusted server function for driver transitions (not implemented) |
| Driver location on the active order | `app/(driver)/index.tsx:116-124`, `src/services/locationService.ts:121-128` | UPDATE matches 0 rows; the location on `drivers` itself still works | **yes** | same |
| Pickup / on the way / delivered | `app/(driver)/orders/[id].tsx:130-140` | UPDATE matches 0 rows, no error | **yes: the app shows "Success" although nothing changed** | same |
| Driver reads assigned orders (active orders, history, earnings, profile stats, order detail) | `app/(driver)/index.tsx:173`, `:196`; `history.tsx:45`; `earnings.tsx:67`; `profile.tsx:52`; `orders/[id].tsx:52` | 0 rows unless the driver holds an active `driver` role (rev 7 M1); a revoked driver loses access to past deliveries | **yes (empty lists)** | Admin approves with `assign_staff_role` |
| Cash collection | `app/(driver)/orders/[id].tsx:161-170` | INSERT into `cash_collections` denied (no policy) | no (error) | a trusted server function |
| Driver goes online/offline | `app/(driver)/index.tsx:230-234` | permission denied on column `status` | partly: the toggle does not change | Admin approves with `assign_staff_role`; the app calls `set_driver_availability()` |
| Admin approve / reject driver | `app/(admin)/drivers.tsx:72-75`, `:94-97`; `src/stores/adminStore.ts:269`, `:289` | permission denied on column `status` (`rejected` is no longer a valid value) | no (error) | Admin UI calls `assign_staff_role`/`revoke_staff_role` |
| Admin "pending drivers" list | `app/(admin)/drivers.tsx:52-58`; `adminStore.ts:149`, `:190` | **empty**: every legacy driver becomes `offline`, so no row is `pending` any more; all drivers appear in the "approved" list (`status in (online, offline)`) although **none is approved** | **yes (misleading)** | Admin UI reads approval from `staff_roles` |
| Admin dashboard counts | `app/(admin)/index.tsx:84-92` | customer count = 1 (the admin's own profile; no admin read of profiles); driver count includes unapproved drivers | **yes (wrong numbers)** | a narrow, reviewed admin statistics function (not implemented) |
| Admin collaborator lookup by profile | `app/(admin)/collaborators.tsx:84-90` | finds no other user's profile | yes | partner model retired; not planned |
| Admin login logging | `src/stores/adminStore.ts:110` | INSERT into `admin_logs` denied; result not checked | **yes: no log written** | server-side audit (`security_audit_log`) |
| Admin screens shown to an account | `src/stores/authStore.ts:118-126`, `adminStore.ts:97-104` | the app still decides from `user_profiles.role`/`is_admin`. The flagged account still sees admin screens; the database denies its actions. If the owner-supplied admin's profile is not `admin`, that admin will not see admin screens. | yes | routing from `staff_roles` (client change) |
| Partner order updates | `src/stores/collaboratorStore.ts:212-215`, `:226-233` | UPDATE matches 0 rows | **yes** | — (partner model retired) |
| Uploads by non-admin accounts; non-jpeg/png/webp or > 5 MiB images | `app/(admin)/meals.tsx:111-125` | 403 / 415 / 413 | no | — (intended; the admin app uploads `.jpg`) |
| Listing `meal-images` | none in the app | anon/customer get an empty list | — | — (intended) |
| Kiosk | — | policies retired | — | not planned |

**Still working (tested locally):**
- sign-up profile insert (customer);
- onboarding and profile updates of the granted columns;
- public menu and meal images by URL;
- customers reading their own orders, items and status history;
- admin staff: orders (read and status update), meals, driver rows, meal-image uploads;
- driver location on `drivers`;
- `service_role` writes;
- existing triggers.

**Not changed by this package, already broken before:**
- push-token `upsert` (`src/services/notificationService.ts:69-75`) has an INSERT policy but no UPDATE policy;
- a profile insert at sign-up runs without a session when e-mail confirmation is on (`authStore.ts:44-56`). Onboarding covers it.

### 7b. Proposed staging compatibility test plan (for CTO approval; not executed)
1. **Before deployment:**
   - record a list of open orders (ids and status only) and of drivers (ids, legacy status), without personal data;
   - agree that open orders are completed or cancelled first, or are advanced only by admin staff after deployment.
2. **Test accounts only:** one customer, one driver, one admin staff (the owner-supplied admin or a second admin assigned by it), one anonymous client. No real customer data is used.
3. **After deployment,** with the unchanged app (expected results from section 7, each recorded as observed):
   - customer: sign-up, onboarding, menu, own orders; checkout must fail;
   - driver: toggle, accept, pickup and deliver are expected to fail or do nothing; the location update on `drivers` works;
   - admin: orders list and status update, meals and image upload (jpeg/png/webp ≤ 5 MiB); driver approve/reject fails; the dashboard numbers are wrong (expected);
   - anonymous: menu and images by URL work; listing the bucket returns nothing;
   - containment: `containment_violations()` returns 0 rows; the API smoke tests in section 10.
4. **Driver approval path without the app:** the admin calls `assign_staff_role(<driver id>, 'driver')` through the API or SQL as that admin; the driver calls `set_driver_availability(true)`; verify online, then revoke and verify offline.
5. **Exit criteria:** every observation matches section 7, and no unexpected failure appears in a flow listed as "still working". Any surprise stops further steps and is reported.
6. **Client follow-up (separate phase):** availability RPC, admin approval RPCs, routing and pending list from `staff_roles`, a trusted server function for driver transitions and cash collection, and checkout after the fee decision.

## 8. Tests (all local and disposable; **nothing ran against staging or the hosted API**)
**Command:** `PHASE1C_SUPABASE_CLI=<path to supabase CLI> KEEP_OUTPUT=<dir> supabase/tests/run_phase1c.sh`
- Requires Docker, `psql`, `python3`, `curl`; Playwright/Chromium for the browser test.
- Images: `supabase/postgres:17.6.1.178` (`sha256:c282d393…a570`) and `ghcr.io/supabase/storage-api:v1.79.30` (`sha256:bdd393f6…6eee`).
- `PHASE1C_SUPABASE_CLI` is optional. Without it, the CLI checks print `SKIPPED … NOT verified in this run`.
- The committed core migration refuses to run (placeholder). The harness applies a copy in which **only** the marked admin line is replaced by the fixture admin `a1`, and asserts that exactly one line differs.
- Result of the revision-6 run: see `docs/v1/PHASE1C_TEST_RUN_2026-10-26_rev6.txt` (exact, unedited output of the harness run from a clean `git archive` export of the revision-6 code commit named in its header) and the PR update. The revision-5 output is kept for history.
- Repository scripts: `package.json` defines only `start`, `android`, `ios` and `web` (Expo); there is no test, lint, typecheck or build script and no CI workflow, so the Phase 1C harness is the only applicable check.
- **Revision-7 verification record (2026-10-26, local only):** code commit `b48c65c7feed569f3dc3d2dc23de9be8a3d2624e`. (1) Full harness on the working tree: exit 0, 226 pass, 0 fail. (2) Full harness from a clean `git archive` export of that commit, with Supabase CLI 2.122.0 (scenarios P and L): exit 0, 226 pass, 0 fail, nothing skipped (`PHASE1C_TEST_RUN_2026-10-26_rev7.txt`). (3) `mutation_tests.sh` from the same export: exit 0; control m0 passes all 6 detectors; every mutation m1–m7 detected (9 detections), none survived (`PHASE1C_TEST_RUN_2026-10-26_rev7_mutations.txt`). (4) `generate_baseline.py` and `generate_rollback.py` in the clean export: byte-identical to the committed files (SHA-256 `f70cb37c…b2e8`, `1d8d3720…2820`). (5) The matrix rendered from the clean-export run is identical to `PHASE1C_POLICY_GRANT_MATRIX.md`. (6) `git diff --check` clean; no bytecode, temporary files, credentials or unrelated changes in the diff (the only passwords are the throwaway passwords of local test containers). **Hosted behaviour is not verified by these tests.**
- **Revision-6 verification record (2026-10-26, local only):** code commit `0bffbc72100ea7b5918a69640bd9c8ec67e49aac`. (1) Full harness on the working tree: exit 0, 200 pass, 0 fail. (2) Full harness from a clean `git archive` export of that commit: exit 0, 200 pass, 0 fail, nothing skipped (the `FAIL Snn` / `BEFORE … fail` lines are the intended BEFORE demonstrations). (3) Concurrency suite against the revision-5 migration: exit 1, 15 pass, 7 fail (the M1 reproduction). (4) `generate_baseline.py` and `generate_rollback.py` in the clean export: both outputs byte-identical (SHA-256 `f70cb37c…b2e8`, `5aa0c36c…0387`). (5) The matrix rendered from the clean-export run is identical to `PHASE1C_POLICY_GRANT_MATRIX.md`. (6) `git diff --check` clean; no bytecode, temporary files or secrets in the diff. Pre-existing failures: none. Regressions: none.

| Scenario | What it shows |
|---|---|
| A | Baseline identical to evidence in 13/13 sections; non-storage preflight ok; baseline refuses a second run; BEFORE SQL tests fail for every security test (documents the holes) |
| B | Core migration applied from the test copy; the only active admin is the supplied id; every SQL security test passes; the policies the migration keeps are unchanged from the evidence; the storage migration refuses without a storage schema |
| C | Re-apply: matrix and audit rows unchanged; tests still pass |
| L | rev 7 L6 (needs `PHASE1C_SUPABASE_CLI`): clean two-file push as a `cli_login_` login, then the post-deployment verification and a weakened-monitor check; push as a non-`postgres` login refused; storage failure after the core file committed; read-only diagnosis; re-run after the fix applies only the storage file |
| P | M1/L6 regressions (section 0d), incl. Supabase CLI `db push` when `PHASE1C_SUPABASE_CLI` is set; rev 6: a wrong login role under `ON_ERROR_ROLLBACK=on` is refused by the commit gate |
| E–F, H | 13 guards: 12 abort with nothing applied and fail their preflight check; H7 `safeupdate` is preflight-only |
| M | Monitoring regressions P2–P7, L1–L3 (each reported, then clean after revert); concurrency suite (rev 6 M1, 22 cases, twice); weakened reviewed function reported and not silently repaired by a re-run |
| X | rev 6 M3: 25 pre-existing-object cases (first application and re-run), each refused with the complete state digest unchanged; valid re-run accepted unchanged |
| G | Rollback through the supported procedure (rev 6 M2): every refusal and the injected mid-rollback failure leave the state digest unchanged; success archives every row, records the approval, removes the history rows, restores the exact BEFORE matrix and the NULL driver status; orders and kiosks unchanged; repeat refused |
| S | Offline URL-encoding unit tests; real Storage API: BEFORE holes incl. listing; storage guards incl. a pre-existing policy of a migration name; 25/25 HTTP checks; storage monitoring regressions; inventory, scan (21 objects incl. special names), browser test, per-object quarantine with refusals, CDN stand-in, restore outcomes; one-transaction rollback: a core-part failure leaves storage unapplied too; success restores the exact BEFORE matrix and bucket NULLs, Storage objects unchanged |

**Mutation tests (revision 7):** `supabase/tests/mutation_tests.sh` (needs Docker and the same images) removes one control at a time in a disposable database: m1 driver role in the assigned-order policy, m2 account checks in `assign_staff_role`, m3 the profile guard's UPDATE branch, m4 the statement-level serialization trigger, m5 `FOR SHARE` in the last-admin check, m6 the rules block of the monitor (also caught by the fingerprint check), m7 the password refusal in the rollback wrapper. Each mutation must make its test fail; the unmodified control (m0) must pass.

**Reproducibility:** `generate_baseline.py` and `generate_rollback.py` regenerate byte-identical files (SHA-256 checked for the revision-6 commit).

**Test-only stand-ins:**
- hosted GoTrue `auth.uid/role/jwt` (`bootstrap_hosted_auth.sql`);
- synthetic fixtures, with `confirmed_at` set for confirmed test accounts;
- a local password for `supabase_storage_admin` in the throwaway container;
- `caching_proxy.py` as a CDN stand-in;
- the Supabase CLI installed outside the repository, used only against a local container.

## 9. Rollback and recovery
- **Prefer forward recovery:**
  1. Identify the blocked legitimate operation.
  2. Add the narrowest permission needed as a new migration, with a test.
  3. Re-run the harness.
  4. Confirm `containment_violations()` still returns 0 rows.
- **Full rollback is dangerous: it re-opens every hole** (C1–C4, H2–H4, meal-images uploads and listing). Only with written CTO approval.

### Supported rollback procedure (revision 6)
One tool, one invocation, one transaction. Nothing else is supported.

```
supabase/rollback/phase1c_rollback.sh \
  --target staging \
  --db-url 'postgresql://postgres@db.teppcfnpkoxkudajnvad.supabase.co:5432/postgres' \
  --expected-admin <auth.users id of the seeded initial administrator> \
  --approved-by '<CTO name, as in the written approval>' \
  --backup-ref '<backup or PITR point newer than the change window>' \
  --export-dir <new directory outside the repository> \
  --confirm 'ROLLBACK PHASE 1C ON teppcfnpkoxkudajnvad'
```
Requires `psql`, `python3` and `sha256sum` on the operator's machine.

**Credentials (revision 7, L8):** the URL must not contain a password; the procedure refuses one (also empty, percent-encoded or as a `password`/`passfile` query parameter) without printing it. Put the password in a password file (`PGPASSFILE=<file with mode 600>` or `~/.pgpass`, line `db.teppcfnpkoxkudajnvad.supabase.co:5432:postgres:postgres:<password>`), or, less preferred, in `PGPASSWORD` for that one command. psql runs with `-w`, so it never prompts; without a password it stops with "cannot connect". The procedure never prints or stores the password. **Not run against hosted staging or production; validated only in disposable local containers** (scenarios G and S).

**Prerequisites (the procedure refuses without them):**
1. Written CTO approval; its author is passed as `--approved-by` and recorded in the database.
2. A backup or PITR point newer than the change window, passed as `--backup-ref` and recorded (the procedure cannot verify a hosted backup; the operator confirms it).
3. A new export directory outside the repository (the export holds user ids; store it securely).
4. No migration newer than Phase 1C recorded in `supabase_migrations.schema_migrations` (roll those back first).
5. Phase 1C in its reviewed state: `containment_violations()` returns 0 rows. Otherwise use forward recovery; the rollback would restore over an unreviewed state.

**What it does, in order. Any failure stops it; steps 1–4 change nothing:**
1. **Target:** `--target staging` accepts only project `teppcfnpkoxkudajnvad` (direct host `db.<ref>.supabase.co` as `postgres`, or the pooler as `postgres.<ref>`). `--target local` accepts only `127.0.0.1`/`localhost`. Every other target, production included, is refused before connecting. `--confirm` must name the target exactly.
2. **Read-only identification:** the connected role must be `postgres`; the initial-admin seed record must be `--expected-admin`; the migration history must end with the Phase 1C versions; `containment_violations()` must return 0 rows.
3. **Prerequisites** above.
4. **Audit export (read-only):** `security_audit_log`, `staff_roles`, `kitchens` to CSV (directory mode 700), row counts compared with the database, SHA-256 manifest.
5. **Rollback:** `phase1c_rollback.sql`, generated by `generate_rollback.py`, as **one** transaction: role check; preflight (repeats step 2, records digests of every preserved table and the archive row counts); storage part; core part; migration-history rows removed; postcondition; deferred commit gate. Any error, also in a runner that ignores errors (`ON_ERROR_ROLLBACK`), commits nothing (tested).
6. **Verification (read-only):** Phase 1C absent, one archive schema present, history rows removed. Then compare `phase1c_matrix.sql` with the BEFORE side of `PHASE1C_POLICY_GRANT_MATRIX.md`.

Exit codes: 0 committed and verified; 1 the rollback transaction failed (database unchanged); 2 refused before any change; 3 committed but the read-only verification failed (investigate immediately).

**Expected effects (all in the one transaction):**
- `meal-images` bucket limits back to the values the migration recorded (NULL in the evidence); the 4 staging storage policies restored verbatim, the 4 Phase 1C storage policies dropped;
- the 39 staging policies the core migration dropped restored verbatim, the 12 it created dropped; grants, function privileges and default privileges as observed on 2026-10-15;
- `drivers`: availability constraint and `NOT NULL` removed. A status the migration normalised is restored from the audit log (incl. NULL) **only** when there is trustworthy evidence that nothing changed it since: the status is still `offline`, the driver has no `staff_roles` driver row in any state, and there is no audited approval, revocation or forced-offline record (revision 7, L7). Every other normalised driver is kept as is and listed, with the reason, in `<archive>.drivers_status_reconciliation` for manual reconciliation;
- `kitchens`, `staff_roles`, `security_audit_log` **archived** into `phase1c_archive_<UTC timestamp>` (rows unchanged, triggers/policies/auth FK removed, no access for `anon`, `authenticated`, `service_role`). The schema comment records time, approver, backup reference and the export checksum;
- the Phase 1C functions dropped; the two migration-history rows deleted, so `supabase db push` can apply the migrations again.

**Verified by the postcondition (otherwise nothing commits):** no Phase 1C table or function left in `public`; public policies equal the evidence (MD5 `d2cb0f4d…`, as in the read-only preflight); storage policies equal the evidence (MD5 `8aa1ab5d…`); archive row counts equal the counts before; the rows of 23 preserved tables (orders, order items, status updates, kiosks, products, stock movements, closings, profiles, meals, partner, payment and push-token tables), `drivers` except `status`, and every `storage.objects` row are byte-identical to before.

**Not restored (the rollback does not claim a complete restoration):**
- the archive schema stays (deleting it needs a separate CTO decision); the audit trail is no longer in `public`;
- driver statuses: only drivers with the evidence above are restored. A driver who held a driver approval after the migration, or whose status is not `offline`, keeps the current status and appears in the reconciliation table; drivers forced offline by a revoked approval are not put back online. **Residual gap:** an approval row inserted and deleted directly (not through the audited functions) while the driver stayed offline leaves no trace, so such a driver would be restored;
- Storage objects uploaded, overwritten, quarantined or removed after deployment stay as they are; a quarantine copy is not restored by this procedure (use the quarantine tool's `restore`);
- data written through the Phase 1C paths after deployment (orders changed by admin staff, meals, images) stays;
- hosted settings (Auth hooks, exposed schemas, JWT) are not touched; nothing outside the database (CDN caches, app builds) is changed.

**Recovery if it fails:** exit 1 means the transaction did not commit; read `rollback.log` in the export directory, fix the cause (for example an object that depends on a Phase 1C function), and run the procedure again with a new export directory. Exit 3 means it committed but verification disagrees: stop, keep the export, and investigate with the read-only queries in step 6 before any further change. To return to the contained state after a rollback, re-apply the migrations with the supported migration procedure.

- **What "exact BEFORE matrix" covers** (`supabase/tests/phase1c_matrix.sql`):
  - `public` and `storage` policies (name, command, roles, `USING`, `WITH CHECK`);
  - effective privileges of `anon` and `authenticated` on `public` tables (select, insert, update, delete, truncate, references, trigger, maintain);
  - `authenticated` UPDATE on 10 sensitive columns;
  - `public` functions (definer flag, configuration, anon/authenticated EXECUTE);
  - `public` triggers;
  - check constraints on `drivers`;
  - default privileges of `postgres`;
  - `storage.buckets` (public, limits).
  
  **Not compared:** raw ACL text and grantors, `service_role` and `PUBLIC` privileges, column privileges outside the 10, column nullability, sequences, indexes, data (preserved data is compared separately by the postcondition).
- The rollback SQL is generated from the evidence and the migration text by `generate_rollback.py`. The two separate `.down.sql` files of revision 5 are removed. Tested in G and S.

## 10. Staging deployment checklist (after CTO approval only)
1. **Approval gate:** CTO approves PR #1 and the compatibility test plan (7b). The package is **not independently reviewed**; only self-reviews exist.
2. **Initial administrator (prerequisite):** owner's written confirmation; `verify_initial_admin_readonly.sql` all `true`; the reviewed commit changes only the marked line.
3. **Compatibility gate (mandatory):** the owner runs `supabase/tests/preflight_staging_readonly.sql` in the **staging** SQL Editor and shares the JSON. `all_required_checks_ok` must be `true`. Any `false` **stops the deployment** until it is explained and, if benign, added to an allowlist in a reviewed commit.
4. **Manual gate (mandatory):** Dashboard → Authentication → Hooks: none enabled. Dashboard → API: exposed schemas are `public` and `graphql_public`. Record both.
5. **Investigation record:** run `supabase/evidence/investigate_flagged_admin_readonly.sql`; store the output outside the repo.
6. **Backup gate:** confirm a backup or PITR point newer than the change window. Export `drivers` and `user_profiles` to secure storage (personal data, never into the repo).
7. **Apply (supported procedure only):**
   - `supabase migration list --linked` and `supabase db push --linked --dry-run` must show **exactly** `20261016170000` and `20261016171000`;
   - `supabase db push --linked`. On any error, run step 8's read-only checks to confirm nothing was committed.
8. **Verify:**
   - run `supabase/tests/postdeploy_verify_readonly.sql` (read-only); `all_required_checks_ok` must be `true`. It checks the monitor's definition first (fingerprint below, SECURITY INVOKER, `search_path`, owner, no client EXECUTE) and only then requires `containment_violations()` to return **0 rows**;
   - `select user_id from public.staff_roles where role = 'admin' and is_active;` returns exactly the supplied id;
   - `phase1c_matrix.sql` matches the AFTER side of `PHASE1C_POLICY_GRANT_MATRIX.md`;
   - API smoke tests with test accounts: anon `POST /rest/v1/orders` denied; customer `PATCH user_profiles {is_admin:true}` denied; menu works; the admin reads orders;
   - `storage_api_tests.sh check` against staging Storage with test accounts;
   - then the compatibility test plan (7b).
9. **Existing `meal-images` objects:** separate gates, each with explicit CTO approval, none part of the deployment:
   1. inventory;
   2. content scan;
   3. quarantine copy;
   4. removal, **per object**, with the approval naming the object and its SHA-256;
   5. restore if needed.
10. **After deployment:** approve legitimate drivers; ship the client changes (section 7); run `containment_violations()` regularly.
11. **If a rollback is ever approved:** only `supabase/rollback/phase1c_rollback.sh` (section 9).

**Monitor fingerprint (revision 7, L4).** Reviewed value: `PHASE1C_MONITOR_MD5:86b0dca96f9664cccf571684bb03562c` (`md5(prosrc)` of `public.containment_violations()` as the core migration creates it). The same token is in `preflight_staging_readonly.sql` (check `containment_monitor_absent_or_reviewed`, true before deployment when the monitor does not exist yet) and in `postdeploy_verify_readonly.sql`; `run_phase1c.sh` fails if any of the three copies differs from a clean application. **Updating it:** a change to the monitor needs, in one reviewed commit, the migration change, the new value in all three places, and a harness run whose log shows the new value; the reviewer compares the monitor diff with the fingerprint change. The value is never taken from a live database.

## 11. Remaining risks and evidence gaps
1. **Live staging compatibility is unproven** until the preflight and manual gates pass. The guards cover only the items in section 4.
2. **The hosted `supabase db push --linked` path is not verified** (login role, transaction handling against hosted). Locally verified with CLI 2.122.0 and `--db-url`.
3. **Pricing is not approved.** Checkout stays disabled.
4. **No hosted API, Realtime, hosted Storage, S3-protocol or CDN test has been run.**
5. **Allowlists and reviewed definitions come from the Supabase 17.6 image and the evidence.** Hosted-only roles, triggers, platform definer functions or different policy text fail closed and may need one review round.
6. **The MIME allowlist checks the declared type, not the bytes.** Mitigated by admin-only uploads; byte validation needs the server-side path (CTO decision).
7. **Objects already in staging's `meal-images` are unvalidated and stay public until quarantined.** A real SVG there executes script on direct navigation (measured in Chromium 141).
8. **Browser safety is measured, not proven:** no `nosniff` from the local Storage API; one browser; hosted CDN headers unobserved.
9. **Decoding untrusted images carries parser risk;** the scan isolates the decoder and should run offline.
10. **`containment_violations()` is a detector with documented limits** (section "Monitoring"). It does not replace review of every schema change.
11. Policies not recreated here still target role `public` (M4); none allows writes beyond the reviewed set.
12. **The client app must change** (section 7). Several flows fail silently and two admin screens are misleading.
13. Still to confirm: partners keep read-only access to their history.
14. **The rollback procedure is validated only locally** (rev 6). Against hosted staging the pooler/direct host forms, the `\copy` export over the network and the `postgres` login are unverified; a mismatch fails closed (refusal), it does not partially apply.
15. **Low-severity findings of the 2026-10-25 review remain open** (not in the rev-6 assignment): the e-mail check accepts `confirmed_at` (phone confirmation); a few mid-file statements are not re-verified by the postcondition under `ON_ERROR_ROLLBACK`; section 7 lists cash collection and admin login logging as new breakages although they already fail on staging, and omits `logAdminAction`; deleting the last admin's Auth account fails (now by design: the last-admin trigger refuses the cascade); the rollback's driver-status restore wording.
16. **Isolation levels:** staff-role changes are safe at every level (tested). RLS policies that call `has_staff_role()` still evaluate it with the statement's snapshot, as PostgreSQL does for every policy; PostgREST clients cannot choose their isolation level.
17. **Revocation and existing snapshots (review 2026-10-26 L1; documented limitation).** A revocation is enforced for transactions that start after it commits, and for later statements of READ COMMITTED transactions. A transaction that already holds a REPEATABLE READ or SERIALIZABLE snapshot keeps evaluating `has_staff_role()` (and so every RLS policy that uses it) against that snapshot until it ends. **Revocation is therefore not immediate across existing database sessions.** API requests through PostgREST each run as their own short READ COMMITTED transaction; long-lived direct database sessions are outside the client roles. The staff-role write paths themselves are protected (40001 instead of a stale write, item 16).
18. **M2 is open (review 2026-10-26).** Existing `meal-images` objects are unverified and publicly served; staging inventory, content scan, CDN behaviour and a decision on headers or a separate image origin are outstanding (section 6).
19. **L6, hosted CLI:** the two-file behaviour and the login-role switch were verified with the local CLI 2.122.0 only.

## 12. Files
| Path | Purpose |
|---|---|
| `supabase/evidence/` | Catalog evidence and README; the owner's query; flagged-account investigation query; per-object `meal-images` inventory (all read-only) |
| `supabase/baseline/` | `staging_schema_2026-10-15.sql` (test fixture, not a migration); `generate_baseline.py`, `compare_catalog.py`, `generate_rollback.py` (generates `supabase/rollback/phase1c_rollback.sql`) |
| `supabase/migrations/` | `20261016170000_phase1c_security_containment.sql` (refuses to run until the initial admin id is committed), `20261016171000_phase1c_storage_meal_images.sql` |
| `supabase/rollback/` | `phase1c_rollback.sh` (the only supported rollback procedure) and the generated `phase1c_rollback.sql` (storage + core, one transaction; archives the new tables) |
| `supabase/tests/` | `run_phase1c.sh` (A–C, L, P, E–F, H, X, M, G, S); `mutation_tests.sh` (rev 7); `admin_concurrency_tests.sh` (24 concurrency cases); `phase1c_security_tests.sql` (58 tests); `staff_account_checks_hosted_shape.sql` (rev 7 L2, hosted Auth columns, rolled back); `postdeploy_verify_readonly.sql` (rev 7 L4); `storage_api_tests.sh` (25 HTTP checks + the recorded MIME limitation); `preflight_staging_readonly.sql`; `verify_initial_admin_readonly.sql`; `phase1c_matrix.sql` + `render_matrix_md.py`; `browser_serving_tests.js`; `tooling_unit_tests.py`; `caching_proxy.py` (CDN stand-in); fixtures and test-only auth bootstrap |
| `supabase/tools/` | `meal_images_scan.py`, `meal_images_quarantine.py` |
| `docs/v1/PHASE1C_POLICY_GRANT_MATRIX.md` | Generated before/after matrix, including storage |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-26_rev7.txt` | Exact, unedited harness output of the revision-7 run (clean export) |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-26_rev7_mutations.txt` | Exact, unedited output of the revision-7 mutation tests |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-26_rev6.txt` | Historical: harness output of the revision-6 run |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-26_rev6_m1_before_fix.txt` | Exact output of the concurrency suite against the revision-5 migration (the M1 reproduction) |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-25_rev5.txt` | Historical: output of the revision-5 run |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-17_rev4.txt` | Historical: output of the revision-4 run (superseded; describes the earlier package) |
