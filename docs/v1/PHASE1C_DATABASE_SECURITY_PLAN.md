# L'OPTION V1 — Phase 1C (amended): Database Security Containment and Schema Baseline

**Status: implementation package for CTO review.**
- **Not applied** to any remote database. Nothing was sent to Supabase.
- **No production change.**
- **No pricing or fee rule** was implemented.

Branch: `claude/phase-1c-amended-containment`, cut from `main` (`0cb0fe0`). It contains only this package. It does not include the Phase 0, 1A or 1B branches.

## 1. Repository verification (deliverable 1)

| Item | Finding |
|---|---|
| `main` | `0cb0fe0`, the initial commit. Nothing has been merged into it. |
| `claude/peaceful-shannon-ewahm3` | Phase 0 audit (`9628fe3`, `545a835`), Phase 0 re-verification (`9f80da3`), and the preserved, unapproved Phase 1C package (`0c979ec`). |
| `claude/phase-1a-client-hardening` (`a439e62`), `claude/phase-1b-db-security-audit` (`0bedf0a`) | Unmerged. Their app changes are deliberately **not** on this branch. |
| Working tree before this work | Clean. No uncommitted files. |
| Pull requests | None existed. |
| Phase 0 re-verification | Reviewed. Its defect statuses still hold. Its review of Phase 1C (§2.7) is superseded by section 4 below. |
| Phase 1B evidence | The raw catalog export was **found**: the owner pasted it into the engineering chat on 2026-10-15. It had never been committed. It is now committed, unchanged, with provenance: [`supabase/evidence/README.md`](../../supabase/evidence/README.md). Every Phase 1B finding was re-checked against it. |
| The six Phase 1C files at `0c979ec` | Reviewed; see section 4. They are **superseded** by this package and are not used. They stay on `claude/peaceful-shannon-ewahm3` for history only. |

## 2. Confirmed decisions applied

| Decision | Where it is applied |
|---|---|
| Internal kitchen/cashier model; no external partners | `public.kitchens`, plus `public.staff_roles` with roles `admin, support, cashier, kitchen_staff, driver`. Kitchen A is seeded as the only active kitchen. There is no cap on the number of kitchens. |
| One server-managed staff-role table | `staff_roles` is the **only** source of database authority. Every `is_admin` policy and every JWT `role`-claim policy was removed. |
| Staging only; production prohibited | Header and checklist. The harness cannot connect to a remote database. |
| Kiosk switched off; keep its history | Kiosk policies retired (reversibly). **No kiosk, product, stock, closing or order row is changed or deleted.** |
| Illegitimate `customer` + `is_admin = true` account | Never seeded, and has no database authority. Its row is kept **unchanged** for investigation (tests T03e, T03f). |
| Fee formulas not approved | Nothing implemented. Checkout stays disabled (section 8). |

## 3. Schema baseline (deliverable 2)

- **Source:** `supabase/evidence/catalog_2026-10-15.json`. The owner ran `supabase/evidence/phase1b_catalog_query.sql` on staging at `2026-10-15T19:40:30Z` (PostgreSQL 17.6).
  - It was scanned for JWTs, API keys, `service_role`/`sb_secret_` keys, bearer tokens, e-mail addresses, URLs and passwords. **Nothing was found.**
  - It contains metadata only. No redaction was needed.
- **Generator:** `supabase/baseline/generate_baseline.py` produces `supabase/migrations/20261015194030_baseline_staging_schema.sql`.
  - It is deterministic.
  - All definitions are copied verbatim from catalog text: constraint definitions, index definitions, policy expressions, function definitions and trigger definitions.
- **Round-trip proof:**
  1. Apply the baseline to a clean `supabase/postgres:17.6.1.178` database.
  2. Run the **same owner query** against it.
  3. Compare with `supabase/baseline/compare_catalog.py`.

  Result: identical in every compared section.

  | Section | Items |
  |---|---|
  | Tables and RLS flags | 24 |
  | Columns | 278 |
  | Constraints | 66 |
  | Indexes | 52 |
  | Policies | 56 |
  | Functions (definition, SECURITY DEFINER, config, EXECUTE) | 5 |
  | Triggers | 2 |
  | Effective anon/authenticated table privileges | 48 |
  | Column ACLs | 0 |
  | Enums, views, Realtime publication | none |
  | Extensions | 5 |

- **Applying to the existing staging project:** do **not** run the baseline there, because the objects already exist. Mark it as applied instead: `supabase migration repair --status applied 20261015194030`.
- **Applying to a clean database:** it builds the pre-1C staging schema. This meets the requirement that the migrations apply to a clean test database.

**Evidence gaps.** Not reproduced, and **not** claimed as verified:
- numeric precision/scale;
- storage-schema objects (platform-managed; the 4 `storage.objects` policies are emitted only when `storage.objects` exists);
- event triggers;
- Auth settings and hooks;
- `authenticator` configuration;
- `public` schema ACL;
- `service_role`/`postgres` grants;
- table data.

The read-only preflight (section 9) reports U3–U6 and U9 from live staging.

**Live-schema compatibility is not proven by this package.** The evidence is a snapshot from 2026-10-15. Compatibility is established only when `supabase/tests/preflight_staging_readonly.sql` returns `all_required_checks_ok = true` on staging. That check compares:
- the table set;
- the full policy set, by name and by MD5 of every policy definition (`d2cb0f4d853918df06ca1d68a52b6096`, computed independently from the JSON and from the rebuilt baseline);
- the driver status values;
- the admin count;
- the function signature.

The migration's own preflight repeats the critical checks and aborts the whole transaction if any fails.

## 4. Phase 1C assumptions vs the real schema (deliverable 3)

| Assumption in the unapproved 1C (`0c979ec`) | Real schema (evidence) | Amendment |
|---|---|---|
| Columns in the `user_profiles` and `drivers` grants exist | Confirmed (all 10 + 8 columns) | Kept. `drivers.status` removed from the client grant. |
| `create_order_transaction(text,uuid,jsonb,numeric,text,text)` | Confirmed; SECURITY DEFINER; anon-executable; no `search_path` | Same fix. A preflight now rejects any other variant. |
| Names of the dropped policies on `orders`, `order_items`, `meals`, `collaborator_*`, `daily_closings`, `order_status_updates`, `drivers` | All confirmed | Kept. Each drop is annotated with the old policy's purpose. |
| Kiosk JWT-claim policies only on `orders`/`daily_closings` | **Wrong.** Also 7 on `products`, 2 on `kiosks` (including an anon-readable kiosk list), 2 on `stock_movements` | All 11 retired. A postcondition aborts if any `is_admin` or JWT-`role` policy remains. |
| `staff_roles` roles and scope | No partner role (matches the decision). `kitchen_id` had no FK or scope rule. | `kitchens` table added. Check: cashier and kitchen staff require a kitchen; admin and support are global; driver kitchen is optional. FK to `kitchens`. |
| `has_staff_role` executable by `anon` (needed by `to public` policies) | — | New policies are `to authenticated`. `anon` cannot execute any staff function (T17). |
| Profile guard silently overwrote `role`/`is_admin` and keyed on the JWT `role` claim | — | Raises `42501`. Keys on `current_user`, so SQL Editor and operator sessions are not blocked. |
| `drivers.status` stays client-writable (approval and availability mixed) | No check constraint. The app's admin "approve" wrote `offline`, which is also the column default. | **Separated** (section 6). |
| Admin audit via `admin_logs` | `admin_logs.admin_id` references the legacy `admins` table, not `auth.users`, so it cannot record staff-role admins | New append-only `security_audit_log`. |
| Exactly one legitimate admin | Owner aggregate: `admin/true = 1` | Guarded. The migration aborts unless exactly one exists (scenario D). |
| Hand-built fixture on plain PG16 (8 tables, a subset) | — | Replaced by the evidence-generated baseline on the Supabase 17.6 image (all 24 tables, every policy, function and trigger). |
| Hand-written rollback that dropped `staff_roles` | — | The rollback is **generated** from the evidence and the migration text, and restores driver statuses from the audit log. |
| No drift detection | — | Preflight: unknown policies, unexpected driver statuses, missing columns or tables, wrong function variant all abort with nothing applied. Postconditions re-check the result. |

## 5. Migration `20261016170000_phase1c_security_containment.sql` (deliverables 4–5)

The migration runs as one transaction and is re-runnable (tested). Sections:

| § | Change | Closes |
|---|---|---|
| 0 | **Preflight**, read-only (see above) | drift protection |
| 1 | Default privileges of `postgres` in `public` revoked from anon/authenticated. Global `EXECUTE` to PUBLIC revoked for new functions. | M2 |
| 2–3 | `kitchens` (Kitchen A active). `staff_roles`. `security_audit_log`, append-only even for the owner. `has_staff_role()`. `assign_staff_role()` and `revoke_staff_role()`: admin-only, validated, audited, last-admin protection. Seed of the single legitimate admin, audited. | C1 |
| 4 | `user_profiles` guard trigger (rejects client role/`is_admin`/`user_id` changes and non-customer inserts). Table-level UPDATE replaced by column UPDATE on the 10 profile columns. | C1 |
| 5 | 9 `is_admin` policies replaced by `has_staff_role('admin')` policies. Admin read added on `user_profiles` (needed for driver approval). | C1 |
| 6 | 7 client INSERT/UPDATE policies on `orders`/`order_items` dropped, plus 4 kiosk JWT policies on `orders`. **No client insert path remains.** | C2, C3 |
| 7 | Both `daily_closings` policies dropped; client grants revoked. Rows preserved. | C4 |
| 8 | `order_status_updates`: public read/insert dropped. Order-owner read and admin read added. Writes only by `service_role` or future trusted functions. | H2 |
| 9 | Drivers (section 6) | H3 |
| 10 | `create_order_transaction`: EXECUTE revoked and `search_path=''` (not repaired or reactivated). `calculate_driver_weekly_earnings` revoked. Trigger and event-trigger functions revoked (firing is unaffected, T10i). | H4 |
| 11 | 11 kiosk policies on `products`, `kiosks`, `stock_movements` retired | kiosk exposure |
| 12 | `anon` keeps only `SELECT` on `meals`. `authenticated` loses all grants on kiosk tables and on `admins`, `bank_accounts`, `admin_logs`, `financial_transactions`, `platform_settings`. | defence in depth |
| 13 | **Postconditions.** Abort if any legacy authority policy, unexpected client write policy, privileged column grant, or client EXECUTE on `create_order_transaction` remains. | — |

**Rows the migration changes:**
- `drivers.status` of unapproved drivers → `offline` (the legacy value is logged first);
- new rows in `kitchens`, `staff_roles` and `security_audit_log`.

**Historical orders, including card orders, are not touched** (T11). No order is marked paid, and no fee or price is written.

## 6. Driver approval vs availability

- **Approval** is an active `staff_roles` row with `role = 'driver'`, granted by an admin with `assign_staff_role(user, 'driver')`. That function requires an existing `drivers` row. The same table that holds every other staff role holds approval, so there is no second authority system.
- **Availability** is `drivers.status`, which may only be `online` or `offline` (`CHECK`).
  - Clients cannot write `status`; they call `set_driver_availability(boolean)`.
  - A trigger enforces "online ⇒ approved" for **every** writer, admins and `service_role` included.
  - `revoke_staff_role(user, 'driver')` forces the driver offline.
- **Legacy data:** no legacy value proves admin approval. The old "approve" wrote `offline`, which is also the insert default for self-created rows. So **all drivers start unapproved and offline**, and the previous value is written to `security_audit_log`. Admins re-approve explicitly.
- Clients can still update their own profile and location columns (`first_name`, `last_name`, `phone`, `current_*`, `last_location_update`, `updated_at`). They cannot change commission, earnings, email, `national_id` or `id`. Self-registration as a driver is blocked.

## 7. Flagged account

- **What the package does:** the account has no `staff_roles` row, and no policy reads `is_admin` any more. It therefore has **no remaining database authority**. In the tests it sees no other users' orders, cannot change menu prices and cannot assign roles (T03e). Its profile is preserved unchanged (T03f).
- **What it cannot establish:** whether the account changed data in the past. Staging records no actor on updates: there are no `updated_by` columns or triggers, and `admin_logs` could not be written.
- **Next step:** `supabase/evidence/investigate_flagged_admin_readonly.sql` (read-only; ids, timestamps and counts only) returns its sign-in times, owned or assigned orders, and the number of rows changed since its profile was last updated. Only the dashboard Logs Explorer could attribute individual API calls, and its retention is short.
- **Client caveat:** the mobile app still routes on `user_profiles.is_admin`, so this account would still *see* the admin screens. Every database call from them returns nothing or is denied. Client routing should move to `staff_roles` in the next client phase.

## 8. Staging features expected to stop working (until later phases)

| Feature | Why | Unblocked by |
|---|---|---|
| **Customer checkout** (direct `orders`/`order_items` insert) | Intentional: no client insert policy | Trusted `create_order` function, which is **blocked on the fee decision** |
| Driver "go online" in the current app | Direct `drivers.status` update is no longer granted | App calls `set_driver_availability()`, after admin approval |
| All drivers available | Every driver starts unapproved and offline | Admin runs `assign_staff_role(user, 'driver')` per driver |
| Admin "approve/reject driver" screen | It writes `drivers.status` (`offline`/`rejected`) | Admin UI calls `assign_staff_role`/`revoke_staff_role` |
| Kiosk / Ola Amigos | Policies retired | Not planned (switched off) |
| Public tracking reads of `order_status_updates` | Owner/admin read only | — |
| Already broken before 1C (unchanged) | Driver claims and delivery statuses (status check, no visibility), `cash_collections`/`admin_logs` inserts, Realtime | Phases 2–4 |

**Still working (tested):**
- sign-up profile insert (T03c);
- onboarding/profile updates (T10f);
- public menu (T10g);
- customers reading their own orders and items (T10d);
- admin reading orders and editing meals (T10a, T10b);
- driver location updates (T10e);
- `service_role` writes (T10h);
- existing triggers (T10i).

## 9. Tests (deliverable 6)

### Exact commands

```bash
# Repository root. Requires Docker, psql and python3. Local containers only.
supabase/tests/run_phase1c.sh                    # full suite, exits 0 only if everything passes
KEEP_OUTPUT=/tmp/p1c supabase/tests/run_phase1c.sh   # also keeps matrices, catalogs and test output
python3 -I supabase/baseline/generate_baseline.py && git diff --exit-code supabase/migrations/   # baseline reproducible
python3 -I supabase/baseline/generate_rollback.py && git diff --exit-code supabase/rollback/     # rollback reproducible
python3 -I supabase/tests/render_matrix_md.py /tmp/p1c/matrix_before.txt /tmp/p1c/matrix_after.txt docs/v1/PHASE1C_POLICY_GRANT_MATRIX.md
```

### Results (run 2026-10-16, image `supabase/postgres:17.6.1.178`, digest `sha256:c282d393…a570`)

| Scenario | Result |
|---|---|
| A. Baseline round-trip against the evidence | **identical**, 13 of 13 compared sections |
| A. Read-only preflight on the reproduced staging schema | **all required checks ok** |
| A. BEFORE: security tests on the reproduced staging schema | **9 pass / 30 fail**. Every security test fails; the 9 passes are all positive or history tests. *Cumulative: an earlier exploit (e.g. T03a self-promotion) changes later results.* |
| B. AFTER migration | **39 pass / 0 fail**. The preflight then reports the migration as applied. |
| C. Re-apply the migration | Succeeded. Matrix and audit rows unchanged. **39 / 0.** |
| D. Second `admin`+`is_admin` profile | Aborted ("admin seed guard … found 2"); **nothing applied** |
| E. Unexpected `drivers.status = 'approved'` | Aborted; **nothing applied** |
| F. Unreviewed policy `orders.rogue_insert` | Aborted; **nothing applied** |
| G. Rollback | Restores the **exact** BEFORE matrix (policies, grants, functions, triggers, constraints, default privileges) and the legacy driver statuses |

### Mutation checks
Each check removed one fix from a copy of the migration and ran the full harness against it.

| Removed fix | Caught by |
|---|---|
| Revoke of table-level UPDATE on `drivers` | Postcondition aborted the migration |
| Driver status normalisation | `CHECK` constraint aborted the migration |
| Profile guard trigger | T03b failed (the insert `is_admin = true` is otherwise allowed) |
| Drop of `"Allow public update orders"` | Postcondition aborted the migration |
| Drop of `public_read_status` | T07b failed |

### Coverage of the brief's 13 required tests
| # | Required test | Covered by |
|---|---|---|
| 1 | anon order | T01 |
| 2 | bypass insert | T02, T02b |
| 3 | `role`/`is_admin` | T03a, T03b, T03d, T03e |
| 4 | another customer's order | T04 |
| 5 | own order money/status | T05 |
| 6 | driver money and self-approval | T06a–T06e, T06g |
| 7 | forged status updates | T07, T07b |
| 8 | `daily_closings` | T08 |
| 9 | order-creation function | T09, T09b |
| 10 | legitimate operations | T03c, T06e, T10a–T10i |
| 11 | historical card orders | T11 |
| 12 | default privileges | T12 |
| 13 | stale state and role changes | T13a (revoked admin loses access on the same JWT), T13b (revoked driver forced offline) |

Also covered: kiosk preservation (T15), audit and append-only (T16), anon grants (T14, T17).

### Local tests vs live-schema evidence
- **Everything above ran on local, disposable PostgreSQL 17.6** (Supabase image). The staging schema was rebuilt from evidence, with synthetic fixture data.
- Role switching mimics PostgREST (`SET ROLE` + `request.jwt.claims`), using the hosted GoTrue `auth.uid/role/jwt` definitions (`supabase/tests/bootstrap_hosted_auth.sql`, test stand-in).
- **No test ran against staging. No test went through the real REST API or Realtime.**
- **Live-schema evidence** is limited to the 2026-10-15 catalog export and the owner's aggregate. Current compatibility is unproven until the read-only preflight is run on staging.

### Other repository checks
- `bash -n supabase/tests/run_phase1c.sh` passes.
- Both generators reproduce their committed outputs byte-for-byte.
- No TypeScript changed on this branch. The app type checks and Jest suite live on the unmerged 1A branch and are unaffected.

## 10. Rollback and recovery

- **Preferred: forward recovery.** If a specific legitimate staging operation breaks:
  1. Identify the operation and the policy, grant or function that blocks it.
  2. Ship a small forward migration that adds **only** that narrowly scoped permission, with a test.
  3. Run the harness, then apply it.

  Examples:
  - add one SELECT policy;
  - grant one column;
  - temporarily create an admin directly as the database owner: `insert into public.staff_roles (user_id, role) values (…, 'admin')`, logged manually.
- **Full rollback (dangerous): `supabase/rollback/20261016170000_phase1c_security_containment.down.sql`.**
  - It re-opens C1–C4 and H2–H4.
  - Use it only if staging is unusable **and** the CTO approves.
  - Export `staff_roles`, `security_audit_log` and `kitchens` first; the commands are in its header.
  - Run it in one transaction, then re-apply the containment as soon as possible.
  - It restores the 37 dropped policies verbatim, drops the 12 new ones, restores grants, function privileges and default privileges, and restores legacy driver statuses for drivers still `offline`. It changes no other data. Tested in scenario G.
- **Not cleanly reversible:**
  - New audit rows written after deployment are lost when the rollback drops `security_audit_log`, unless exported first.
  - A driver whose status changed after deployment keeps the newer value.

## 11. Staging deployment checklist (for after CTO approval only)

1. **Approval gate:** CTO approves this PR after Codex's independent review.
2. **Compatibility gate:**
   - The owner runs `supabase/tests/preflight_staging_readonly.sql` in the **staging** SQL Editor and shares the JSON.
   - Required: `all_required_checks_ok = true`.
   - If false, **stop**: the evidence is stale, so regenerate it, the baseline and the tests.
3. **Investigation record:** run `supabase/evidence/investigate_flagged_admin_readonly.sql`. Store the output outside the repo.
4. **Backup gate:**
   - Dashboard → Database → Backups: confirm a backup or PITR point newer than the change window, and record its timestamp.
   - Export `drivers` and `user_profiles` to secure storage (they hold personal data, so never put them in the repo).
5. **Migration history:**
   - `supabase migration repair --status applied 20261015194030` (baseline).
   - `supabase migration list --linked`: only `20261016170000` may be pending.
   - `supabase db push --linked --dry-run` must show only that file.
6. **Apply:** `supabase db push --linked` (one transaction). On error, nothing is applied; read the preflight or postcondition message.
7. **Verify on staging:**
   - Re-run the preflight; `phase1c_not_yet_applied` must now be false.
   - Run `supabase/tests/phase1c_matrix.sql` and compare it with the AFTER section of `PHASE1C_POLICY_GRANT_MATRIX.md`.
   - API smoke tests with real test accounts: anon `POST /rest/v1/orders` denied; customer `PATCH user_profiles {is_admin:true}` denied; menu `GET` works; the legitimate admin reads orders; a test driver can go online only after `assign_staff_role`.
   - Record the results.
8. **Post-deploy:** approve legitimate drivers with `assign_staff_role`. Plan the client release: driver availability via RPC, admin driver approval via RPCs, routing from `staff_roles`.
9. **Rollback gate:** follow section 10, forward recovery first.

## 12. Unresolved assumptions, risks and evidence gaps

1. **Schema compatibility with live staging is unverified since 2026-10-15** (gate 2). The migration aborts on the drift it checks for, but it cannot detect changes it does not check, such as column type changes that do not remove a column.
2. **Pricing policy is not approved.** No fee, delivery-fee or service-fee logic exists anywhere in this package. `orders.delivery_fee` default 10 and `platform_settings` defaults are untouched. Checkout stays disabled until a trusted `create_order` function with an approved formula exists.
3. **No live API or Realtime testing**; PostgREST behaviour is mimicked, not exercised.
4. **Storage:** any signed-in user can still upload to the public `meal-images` bucket (Phase 1B M3); storage default privileges are unchanged. This is out of scope here and recommended for the next migration.
5. Policies not recreated by this migration still target role `public` (M4). Safe today because none of them is `true` for writes, but they should be retargeted to `authenticated`.
6. `authenticated` keeps RLS-protected grants on `cash_collections`, push-token tables, `driver_*` and `collaborator_*`. The retired partner policy `collaborators_update_own_orders` still lets a linked partner user update their `collaborator_orders` rows, including share columns. That needs a decision: retire it now or in Phase 2.
7. Objects created by `supabase_admin` keep platform default grants; `postgres` cannot change them.
8. Unknowns U3–U6 (Auth hooks/claims, the `rls_auto_enable` event trigger, `authenticator` settings, `public` schema ACL) are reported by the preflight but not yet answered. No remaining policy depends on JWT claims.
9. Numeric precision/scale is not in the evidence. It does not affect authorization behaviour.
10. The mobile app (all branches) still routes admins on `user_profiles.is_admin` and writes `drivers.status` directly. The client must be updated alongside or soon after deployment (section 8).
11. **Design choices needing confirmation:**
    - drivers optionally kitchen-scoped;
    - admin/support global;
    - every legacy driver requires re-approval;
    - admins have read access to all profiles;
    - Kitchen A seeded as `code = 'A'`, `name = 'Kitchen A (Casablanca)'`.

## 13. Files

| Path | Purpose |
|---|---|
| `supabase/evidence/catalog_2026-10-15.json`, `README.md` | Staging catalog evidence and its provenance |
| `supabase/evidence/phase1b_catalog_query.sql` | The owner's read-only evidence query (copied unchanged from the 1B branch) |
| `supabase/evidence/investigate_flagged_admin_readonly.sql` | Read-only investigation of the flagged account |
| `supabase/baseline/generate_baseline.py`, `compare_catalog.py`, `generate_rollback.py` | Deterministic generators and the round-trip comparator |
| `supabase/migrations/20261015194030_baseline_staging_schema.sql` | Generated baseline (pre-1C staging schema) |
| `supabase/migrations/20261016170000_phase1c_security_containment.sql` | The containment migration |
| `supabase/rollback/20261016170000_phase1c_security_containment.down.sql` | Generated rollback (dangerous; see section 10) |
| `supabase/tests/run_phase1c.sh` | Harness, scenarios A–G |
| `supabase/tests/phase1c_security_tests.sql`, `fixtures_staging_like.sql`, `bootstrap_hosted_auth.sql` | Tests, synthetic fixtures, and the test-only auth stand-in |
| `supabase/tests/phase1c_matrix.sql`, `render_matrix_md.py` | Policy/grant matrix query and its Markdown renderer |
| `supabase/tests/preflight_staging_readonly.sql` | Read-only live compatibility check for staging |
| `docs/v1/PHASE1C_POLICY_GRANT_MATRIX.md` | Before/after matrix (generated) |
