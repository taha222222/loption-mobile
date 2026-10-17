# L'OPTION V1 — Phase 1C (amended, revision 3): Database Security Containment

**Status: implementation package for CTO review.**
- **Not applied** to any remote database. Nothing was sent to Supabase.
- **No production change.**
- **No pricing or fee rule** was implemented.
- **Checkout stays disabled.**

Branch: `claude/phase-1c-amended-containment`, cut from `main` (`0cb0fe0`). It contains only this package. Review PR: taha222222/loption-mobile#1 (draft).

Revision 2 addresses the CTO review of 2026-10-16 (section 0). Revision 3 adds the CTO-approved storage limits of 2026-10-17 (section 0b). Sections 1–12 describe the package as it now stands.

## 0b. Revision 3: CTO storage decisions of 2026-10-17

| Decision | Implemented as | Evidence |
|---|---|---|
| Existing drivers must be re-approved; driver kitchen assignment optional; Kitchen A has stable code `A` | Already the behaviour (section 5, §9; `kitchens.code` is `unique`) | T06c, T06g, T10c |
| `meal-images`: public read kept; admin staff only may upload, overwrite or delete | Storage migration policies (unchanged from revision 2) | S01–S08, S12, S21, S22 |
| Max 5 MiB (5,242,880 bytes); only `image/jpeg`, `image/png`, `image/webp`; SVG and everything else rejected | The storage migration sets the bucket's `file_size_limit = 5242880` and `allowed_mime_types = {image/jpeg,image/png,image/webp}`. `public` is kept and no object is changed. | S09–S11 allowed; S13–S17 rejected with 415; S18 exactly 5,242,880 bytes accepted; S19 5,242,881 bytes rejected with 413; S20 bucket configuration as reported by the API |
| Fail safely if the bucket is missing or in an unexpected state | The preflight aborts unless the bucket exists, is public, and has either the evidence limits (both NULL) or exactly the approved limits (re-run) | Storage guards: missing bucket, unexpected size limit, unexpected MIME list, not public. Each aborts with the bucket and policies unchanged. |
| Rollback restores the exact original settings, including NULLs | The migration logs the previous values to `security_audit_log` (JSON `null` for SQL NULL). The storage rollback restores them exactly; if no change was logged, it leaves the bucket alone. | "storage rollback restores the exact original bucket settings (public; file_size_limit IS NULL; allowed_mime_types IS NULL)"; the full matrix, including bucket settings, equals BEFORE |
| Do not overclaim MIME allowlisting | Documented in the migration header and section 6. The harness records the limitation on every run. | `LIMIT SVG bytes declared as image/png -> 200` |


## 0. CTO review items and responses

| # | Request | Response | Evidence |
|---|---|---|---|
| 1 | Drift protection U3–U6; preflight fails on unsafe or unexplained state; do not overstate the migration | New `public.containment_violations()`, category `drift`, covers roles, superuser/bypassrls, client-role attributes, memberships, Auth-hook grants, event triggers, `authenticator`, schema CREATE, table owners, grantees and RLS. **The migration aborts on any drift row before changing anything.** The read-only preflight has **required** checks for the same items, plus `safeupdate` (preflight only). Section 4 lists exactly what each layer verifies, and what neither can. | Harness H1–H11: each injected state aborts the migration with nothing applied **and** fails its preflight check; after the revert the check passes again. H7 (`safeupdate`) is preflight-only by design. |
| 2 | Retire partner writes | `collaborators_update_own_orders` dropped. All collaborator rows preserved; partner reads kept. Postcondition: any write policy outside the reviewed allowlist aborts the migration. After deployment, the same function reports it. | T18a (partner cannot rewrite or delete their order; row intact), T18b (read kept), T18c (a re-added partner write policy is reported). Mutation: keeping the policy aborts the migration and names it. |
| 3 | Least-privilege profile access | Blanket admin read on `user_profiles` **removed**. Driver approval uses `drivers` only (`staff_admin_all_drivers`). No V1 workflow was found that needs other users' profiles, so no extra interface is proposed. | T19 (admin, flagged account and driver see only their own profile), T10j (admin reads and provisions drivers without profile access). Mutation: re-adding the policy fails T19. |
| 4 | Storage | Investigated on the evidence and on the **real Storage API**. `meal-images` is public with no limits, and any signed-in user can upload. New migration `20261016171000_phase1c_storage_meal_images.sql`: writes are admin staff only; public read is kept. Containment counts as complete only when `containment_violations()` returns **zero rows of every category**. | Scenario S, `supabase/storage-api` v1.79.30 over HTTP. BEFORE: customer upload, overwrite, upsert and delete, and the flagged account's upload, all succeed. AFTER: **12/12 checks pass** (revision 2; **22/22** with the revision-3 limits). Section 6. |
| 5 | Baseline outside `supabase/migrations/` | Moved to `supabase/baseline/staging_schema_2026-10-15.sql`. It refuses to run where the schema exists. Generators, harness and checklist updated; the `migration repair` step is gone. | Harness A ("baseline refuses to run on a database that already has the schema"). `supabase/migrations/` now holds only the two containment migrations. |
| 6 | Evidence accuracy | Exact comparison scope and full omission list in `supabase/evidence/README.md`. The baseline is described as a reconstruction identical in 13 named sections, **not a complete clone**. Event-trigger, role and grant uncertainties are now required preflight checks and migration guards. | `supabase/evidence/README.md`, sections "Comparison scope" and "How U3–U6 … are handled" |
| 7 | Regression coverage | Tests added for each item above. Full suite re-run. Generators verified reproducible. | Section 8 |

## 1. Repository state

- `main`: `0cb0fe0`. Nothing is merged.
- This branch contains only `supabase/` and `docs/v1/` files. The unmerged Phase 0, 1A and 1B branches are not included.
- The older unapproved 1C files (`0c979ec`) are superseded and not used.

## 2. Confirmed decisions applied

| Decision | Applied as |
|---|---|
| Internal kitchen/cashier model | `kitchens` (Kitchen A active, no limit on count). `staff_roles` holds `admin`, `support`, `cashier`, `kitchen_staff`, `driver`; cashier and kitchen staff need a kitchen; admin and support are global. |
| One server-managed staff-role table | `staff_roles` is the **only** database authority. Every `is_admin` and JWT-role policy is removed. A postcondition and `containment_violations()` reject any that return. |
| Partner model retired | No partner write policy remains (rows preserved, own-row reads kept). |
| Staging only | No remote access from this work. The harness cannot connect to a remote database. |
| Kiosk off; history kept | Kiosk policies and grants retired. **No kiosk, product, stock, closing or order row is changed.** |
| Illegitimate `customer` + `is_admin` account | No authority (T03e, T19, S06). Profile row kept unchanged (T03f). |
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

| Item | Migration guard (aborts, nothing applied) | Mandatory staging preflight (read-only) | Neither: manual mandatory check |
|---|---|---|---|
| Table set; public policy names; public policy text (MD5 `d2cb0f4d…`) | names only (unknown policies abort) | yes (set + MD5) | — |
| Required columns; `create_order_transaction` signature | yes | signature | — |
| `drivers.status` values; exactly one legitimate admin | yes | yes | — |
| U3: unexpected roles, SUPERUSER/BYPASSRLS, client-role attributes, memberships | yes | yes | — |
| U3: Auth hooks | DB side: functions granted to `supabase_auth_admin` | yes | **Dashboard → Authentication → Hooks: none enabled** |
| U4: event triggers (allowlist of 6 Supabase functions + `public.rls_auto_enable()`) | yes | yes | — |
| U5: `authenticator` NOSUPERUSER, NOBYPASSRLS, NOINHERIT | yes | yes | — |
| U5: `authenticator` preloads `safeupdate` | **no** | yes | — |
| U6: no CREATE for `PUBLIC`/`anon`/`authenticated`/`authenticator` on platform schemas | yes | yes | — |
| `public` tables owned by `postgres`; RLS on; only expected grantees | yes | yes; also no column grants | — |
| Storage policies equal evidence (MD5 `8aa1ab5d…`); bucket set `meal-images:public, src:private`; migration role can manage `storage.objects` policies | storage migration: unknown policies, bucket present, permission | yes | — |
| PostgREST exposed schemas | no | no | **Dashboard → API settings: `public`, `graphql_public` only** |
| Column types and modifiers beyond the evidence; data outside the guarded tables | **no** | **no** | not verified by this package |

## 5. Migrations

### `20261016170000_phase1c_security_containment.sql` (core)
| § | Change | Closes |
|---|---|---|
| 00 | `containment_violations()` (read-only; not client-executable) | verification |
| 0 | Preflight: schema match plus **all drift rows** | drift |
| 1 | Default privileges of `postgres` revoked from clients; no PUBLIC EXECUTE on new functions | M2 |
| 2–3 | `kitchens`, `staff_roles`, append-only `security_audit_log`, `has_staff_role`, audited admin-only `assign_staff_role`/`revoke_staff_role` (last-admin protection), seed of the single legitimate admin | C1 |
| 4 | `user_profiles` guard trigger (raises 42501); column-level UPDATE only on 10 profile columns | C1 |
| 5 | 9 `is_admin` policies → `has_staff_role('admin')`. **No admin read of profiles.** | C1, least privilege |
| 5b | `collaborators_update_own_orders` dropped (partner writes retired) | partner |
| 6–8 | All client INSERT/UPDATE on `orders`/`order_items` dropped; `daily_closings` service-only; `order_status_updates` owner/admin read only | C2, C3, C4, H2 |
| 9 | Driver approval = active `staff_roles` `driver` row; `drivers.status` is availability only (CHECK), set through `set_driver_availability()`, enforced for every writer; legacy values audited, then normalised to `offline` | H3 |
| 10 | `create_order_transaction` and `calculate_driver_weekly_earnings`: no client EXECUTE; `search_path=''` (not reactivated) | H4 |
| 11–12 | 11 kiosk policies retired; `anon` keeps only SELECT on `meals`; `authenticated` loses kiosk and financial tables | defence in depth |
| 13 | **Postcondition:** zero `drift` and zero `containment` rows | — |

### `20261016171000_phase1c_storage_meal_images.sql` (storage)
- **Preflight:**
  - the core migration is applied;
  - `storage.objects` and `storage.buckets` exist;
  - the `meal-images` bucket exists;
  - no unreviewed `storage.objects` policies;
  - **the migration role can manage `storage.objects` policies**: it owns the table or is covered by `supautils.policy_grants`. Verified locally: `storage.objects` is owned by `supabase_storage_admin`, and `postgres` gets policy rights only through `supautils.policy_grants`;
  - no drift.
- **Change:**
  - drops the 3 staging write policies and creates admin-staff-only INSERT, UPDATE and DELETE policies for `meal-images`; `Public Access` read is kept;
  - sets the bucket's `file_size_limit = 5242880` and `allowed_mime_types = {image/jpeg,image/png,image/webp}`. The previous values are logged first; `public` is untouched. On a re-run where the bucket is already approved, nothing is changed or logged;
  - no object row is changed.
- **Bucket guard:** aborts if the bucket is missing, not public, or has limits other than the evidence values (NULL) or the approved values.
- **Postcondition:** `containment_violations()` returns **zero rows of every category**.

**Rows the package changes:**
- `drivers.status` of unapproved drivers → `offline` (the old value is logged first);
- new rows in `kitchens`, `staff_roles` and `security_audit_log`.

Historical orders, card orders and kiosk records are untouched (T11, T15).

## 6. Storage investigation and verification

- **Evidence:**
  - Bucket `meal-images`: public, no size limit, no MIME limit.
  - Bucket `src`: private, no policies.
  - `storage.objects` policies: "Authenticated users can upload" (INSERT, any signed-in user), "Users can update own uploads" and "Users can delete own uploads" (owner), "Public Access" (SELECT).
  - `storage.buckets` has no policies, so clients cannot create buckets.
- **Real-API reproduction:**
  - Ran `ghcr.io/supabase/storage-api:v1.79.30` against the 17.6 database; its own 74 migrations created the `storage` schema.
  - JWTs were signed with a throwaway local secret.
  - With the staging policies, a **customer can upload, overwrite, upsert and delete in `meal-images`**, and so can the flagged account. Anonymous uploads were already refused.
- **After the migrations:** 22/22 HTTP checks pass (revision 3). Each check asserts the Storage API's own status code: `403` policy denial, `415` invalid MIME type, `413` too large. Policy checks upload a valid PNG, so they cannot pass because a limit rejected the request.

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

  The app's admin upload path (`upsert: true`) keeps working.
- **How to verify against hosted staging:**
  1. Preflight checks `storage_*` must pass.
  2. After deployment, `select * from public.containment_violations()` must return 0 rows.
  3. Run the same HTTP checks with `supabase/tests/storage_api_tests.sh`, using staging's Storage URL and **test accounts only**. **Not done** (no access, by design).
- **Bucket limits (revision 3, CTO-approved):** 5 MiB and `jpeg`/`png`/`webp` only.
  - Tested through the real Storage API: S09–S11, S13–S19 and S20 in the table above.
  - The size limit is the **bucket's own** setting. The test container's global `FILE_SIZE_LIMIT` is 50 MiB, so the 413 at 5,242,881 bytes can only come from the bucket.
  - Before the migration, the same requests (SVG, GIF, HTML, octet-stream, over-size) all succeed with HTTP 200.

### Limitation: the MIME allowlist does not validate image bytes
The Storage API compares the **declared** `Content-Type` header with `allowed_mime_types`, and the body length with `file_size_limit`. It does not inspect or decode the bytes.

The harness proves this on every run: an SVG body with a `<script>` element, uploaded by an admin with `Content-Type: image/png`, is **accepted** (`LIMIT … -> 200`). It is then served with `Content-Type: image/png`, so browsers will not run it as SVG. **But the bucket can hold bytes that are not a valid image.**

Today only admin staff can upload, which limits the exposure. If byte-level verification is required, the proposal is a trusted server-side path (not implemented, CTO decision):
1. **Admins stop writing `meal-images` directly.** The admin app uploads to a **private** `meal-images-incoming` bucket, again admin staff only, with the same 5 MiB/type limits as an early filter.
2. **A trusted Edge Function** (service role, invoked by the admin app with the admin's JWT; it re-checks `has_staff_role('admin')`) downloads the object and checks it:
   - checks the magic bytes against the declared type;
   - **fully decodes** the image with a real decoder (e.g. libvips/sharp, or ImageMagick with a restrictive policy), rejecting anything that does not decode;
   - enforces maximum pixel dimensions (decompression-bomb guard);
   - **re-encodes** to WebP (or JPEG) at a fixed quality, which strips EXIF/GPS and any embedded payload;
   - writes the result to `meal-images` under a server-generated name;
   - deletes the incoming object and records the action in `security_audit_log`.
3. **Admin-staff INSERT/UPDATE on `meal-images` is then removed.** Only the function (service role) writes there; public read stays.
4. **Tests:** polyglot and mislabelled files rejected; oversize pixel counts rejected; output always decodes and is re-encoded; EXIF removed.

### Existing objects are not re-validated
- The new limits apply to uploads from now on.
- Objects already in staging's bucket, uploaded while any signed-in user could write with no limits, **stay served unchanged** (CTO: preserve existing objects).
- The read-only preflight now reports them as information: counts by declared MIME type and how many exceed 5 MiB (`info: existing meal-images objects …`). In the local run it lists the SVG, HTML, GIF and over-size test objects uploaded before the migration.
- **Decision needed:** review that inventory on staging, and quarantine or delete anything unexpected, as a separate, approved operation.

## 7. Expected staging impact

| Stops working | Why | Unblocked by |
|---|---|---|
| Checkout | No client insert path, by design | Trusted `create_order`, blocked on the **fee decision** |
| Drivers going online | Approval is required; the app's direct status write is denied | Admin `assign_staff_role(user, 'driver')`; the app calls `set_driver_availability()` |
| Admin driver approve/reject screen | It writes `drivers.status` | Admin UI calls `assign_staff_role`/`revoke_staff_role` |
| Uploads by non-admin accounts | Admin staff only | — (intended) |
| Meal images that are not JPEG/PNG/WebP, or larger than 5 MiB | Bucket limits (415 / 413) | — (intended; the admin app must upload jpeg/png/webp ≤ 5 MiB) |
| Partner order updates | Partner model retired | — (intended) |
| Kiosk | Policies retired | Not planned |

**Still working (tested):**
- sign-up profile insert;
- onboarding and profile updates;
- public menu and meal images;
- customers reading their own orders and items;
- admin orders and meals;
- admin driver provisioning;
- admin meal-image uploads;
- driver location updates;
- `service_role` writes;
- existing triggers.

## 8. Tests (all local and disposable; **nothing ran against staging or the hosted API**)

**Command:** `supabase/tests/run_phase1c.sh`
- Requires Docker, `psql`, `python3`, `curl`.
- Images: `supabase/postgres:17.6.1.178` (`sha256:c282d393…a570`) and `ghcr.io/supabase/storage-api:v1.79.30` (`sha256:bdd393f6…6eee`).
- `KEEP_OUTPUT=<dir>` keeps the outputs.
- Run 2026-10-17: **exit 0, "RESULT: ALL PHASE 1C LOCAL CHECKS PASSED".**

| Scenario | Result |
|---|---|
| A | Baseline identical to evidence in 13/13 sections. Preflight non-storage checks ok. Baseline refuses a second run. BEFORE SQL tests **11 pass / 34 fail**: every security test fails; the passes are positive or history tests plus T19, since staging never had a blanket profile read. *BEFORE results are cumulative.* |
| B | Core migration: **45/45 pass**. Preflight reports it as applied. The storage migration refuses to run where `storage.objects` is absent. |
| C | Re-apply: no change (matrix and audit identical); **45/45** |
| D–F, H | 14 guards. 13 abort the migration with nothing applied and fail their preflight check; H7 `safeupdate` is preflight-only. Every revert restores a passing preflight, and the migration then applies. |
| G | Core rollback: exact BEFORE matrix; legacy driver statuses restored |
| S | Full preflight including storage passes. BEFORE storage **10 pass / 12 fail** (documented holes: customer and flagged-account writes, no type or size limits). After core only, **4** storage violations are reported (3 write policies + bucket limits). **4 bucket guards** abort with nothing changed. After storage: bucket = public, 5242880, `{image/jpeg,image/png,image/webp}`; existing objects preserved; old values audited as JSON null; **22/22 HTTP checks**; 0 violations; SQL suite **45/45**. Re-apply: no change and no second audit record. Core rollback refuses to run before the storage rollback. Storage rollback restores `file_size_limit IS NULL` and `allowed_mime_types IS NULL`. Full rollback restores the exact BEFORE matrix, including storage policies and bucket settings. The `LIMIT` line records that SVG bytes declared as `image/png` are accepted. |

**Mutation checks** (one fix removed per run, full harness):
- **Revision 1:** `drivers` UPDATE revoke (postcondition aborts); driver normalisation (CHECK aborts); profile guard (T03b); public-update drop (postcondition); status-read drop (T07b).
- **Revision 2:**
  - keeping the partner update policy aborts with "collaborator_orders.collaborators_update_own_orders - write policy not on the reviewed allowlist";
  - re-adding the admin profile read fails T19;
  - removing the event-trigger guard lets H5 through;
  - keeping the customer upload policy aborts the storage migration with "storage.objects.Authenticated users can upload - write policy not on the reviewed allowlist".

- **Revision 3:**
  - the storage migration without the bucket update aborts with "storage: bucket meal-images - size/MIME limits not as approved (file_size_limit=NULL, allowed_mime_types=NULL)";
  - allowing `image/svg+xml` aborts with "… allowed_mime_types={image/jpeg,image/png,image/webp,image/svg+xml}".

**Reproducibility:** `generate_baseline.py` and `generate_rollback.py` regenerate byte-identical files (SHA-256 checked).

**Test-only stand-ins:**
- hosted GoTrue `auth.uid/role/jwt` (`bootstrap_hosted_auth.sql`);
- synthetic fixtures;
- a local password for `supabase_storage_admin` inside the throwaway container.

## 9. Rollback and recovery

- **Prefer forward recovery:**
  1. Identify the blocked legitimate operation.
  2. Add the narrowest permission needed as a new migration, with a test.
  3. Re-run the harness.
  4. Confirm `containment_violations()` still returns 0 rows.
- **Full rollback is dangerous: it re-opens every hole.** Run `supabase/rollback/20261016171000_phase1c_storage_meal_images.down.sql` first; the core rollback refuses to run otherwise. Then run `…security_containment.down.sql`. Each runs in one transaction, only with CTO approval, after exporting `staff_roles`, `security_audit_log` and `kitchens`.
- Both files are generated from the evidence and the migration text. Tested in G and S.
- **Not reversible:** audit rows written after deployment, unless exported first; driver statuses changed after deployment keep their newer value.

## 10. Staging deployment checklist (after CTO approval only)

1. **Approval gate:** CTO approves PR #1 after the independent review.
2. **Compatibility gate (mandatory):**
   - The owner runs `supabase/tests/preflight_staging_readonly.sql` in the **staging** SQL Editor and shares the JSON.
   - `all_required_checks_ok` must be `true`.
   - Any `false` (an unexpected role, membership, event trigger, grant, owner, policy or bucket) **stops the deployment** until it is explained and, if benign, added to the allowlist in a reviewed commit.
3. **Manual gate (mandatory):**
   - Dashboard → Authentication → Hooks: none enabled.
   - Dashboard → API: exposed schemas are `public` and `graphql_public`.
   - Record both.
4. **Investigation record:** run `supabase/evidence/investigate_flagged_admin_readonly.sql`; store the output outside the repo.
5. **Backup gate:** confirm a backup or PITR point newer than the change window; record it. Export `drivers` and `user_profiles` to secure storage (personal data, so never into the repo).
6. **Apply:**
   - `supabase migration list --linked` and `supabase db push --linked --dry-run` must show **exactly** `20261016170000` and `20261016171000`. The baseline is no longer a migration.
   - `supabase db push --linked`. Each file runs in its own transaction; a failed guard applies nothing.
7. **Verify:**
   - `select * from public.containment_violations();` returns **0 rows**.
   - The preflight shows the migration as applied.
   - `supabase/tests/phase1c_matrix.sql` matches the AFTER side of `PHASE1C_POLICY_GRANT_MATRIX.md`.
   - API smoke tests with test accounts: anon `POST /rest/v1/orders` denied; customer `PATCH user_profiles {is_admin:true}` denied; menu works; the admin reads orders.
   - `storage_api_tests.sh check` against staging Storage with test accounts: customer upload denied; admin jpeg/png/webp allowed; SVG, GIF and over-5-MiB rejected; bucket configuration as approved.
   - Review the preflight's `info: existing meal-images objects` inventory, and decide separately on any pre-existing non-image or oversize objects.
8. **After deployment:**
   - Approve legitimate drivers.
   - Ship the client changes (availability RPC, admin approval RPCs, routing from `staff_roles`).
   - Re-run `containment_violations()` regularly as monitoring.

## 11. Remaining risks and evidence gaps

1. **Live staging compatibility is unproven** until gates 2–3 pass. The guards cover only the items in section 4.
2. **Pricing is not approved.** No fee logic exists here. Checkout stays disabled until a trusted `create_order` with an approved formula exists.
3. **No hosted API, Realtime or hosted Storage test has been run**; the local equivalents passed.
4. **Allowlists come from the Supabase 17.6 image** plus documented hosted roles. Hosted-only roles or triggers will fail the preflight until explained. This is intentional fail-closed behaviour, but it may need one review round.
5. **The `meal-images` MIME allowlist checks the declared type, not the bytes.** A mislabelled or non-image body is accepted if declared as jpeg/png/webp. Mitigated by admin-only uploads; byte-level validation needs the server-side re-encoding path in section 6 (CTO decision).
5b. **Objects already in staging's `meal-images` are not re-validated** and stay public. Review the preflight inventory before or after deployment (decision needed).
6. Policies not recreated here still target role `public` (M4). None of them allows writes beyond the allowlist.
7. `authenticated` keeps RLS-protected grants on push-token, `cash_collections`, `driver_*` and `collaborator_*` tables.
8. The mobile app still routes on `user_profiles.is_admin` and writes `drivers.status` directly; client changes are required (section 7).
9. **Confirmed by the CTO (2026-10-17):** every legacy driver re-approved; driver kitchen scope optional; Kitchen A seeded with stable unique code `A`. Still to confirm: partners keep read-only access to their history.

## 12. Files

| Path | Purpose |
|---|---|
| `supabase/evidence/` | Catalog evidence and provenance/scope README; the owner's query; flagged-account investigation query (read-only) |
| `supabase/baseline/` | `staging_schema_2026-10-15.sql` (test fixture, not a migration); `generate_baseline.py`, `compare_catalog.py`, `generate_rollback.py` |
| `supabase/migrations/` | `20261016170000_phase1c_security_containment.sql`, `20261016171000_phase1c_storage_meal_images.sql` |
| `supabase/rollback/` | Generated down scripts (storage first, then core) |
| `supabase/tests/` | `run_phase1c.sh` (A–H, S); `phase1c_security_tests.sql` (45 tests); `storage_api_tests.sh` (22 HTTP checks + the recorded MIME limitation); `preflight_staging_readonly.sql`; `phase1c_matrix.sql` + `render_matrix_md.py`; fixtures and test-only auth bootstrap |
| `docs/v1/PHASE1C_POLICY_GRANT_MATRIX.md` | Generated before/after matrix, including storage |
| `docs/v1/PHASE1C_TEST_RUN_2026-10-17_rev3.txt` | Exact, unedited harness output of the run reported in section 8 |
