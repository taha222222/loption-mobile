# L'OPTION V1 — Phase 0 Re-verification (2026-10-16)

**Read-only.** No application code, migration, Supabase project or payment provider was changed. This document re-checks every earlier finding against the repository as it stands today. It does not repeat them on trust.

## 0. What was audited

The repository holds more than the Phase 0 branch. Earlier work sits on stacked branches that are **not merged** (no PR exists, and `main` is still the initial commit `0cb0fe0`):

| Ref | Head | Contents | Review state |
|---|---|---|---|
| `main` | `0cb0fe0` | Initial import | — |
| `claude/peaceful-shannon-ewahm3` (this branch) | `545a835` | Phase 0 audit (`PHASE0_AUDIT.md`, PDF) | Docs only |
| `claude/phase-1a-client-hardening` | `a439e62` | Auth lifecycle, route gates, env validation, COD-only checkout, Jest/ESLint, 41 tests | "Awaiting CTO review" |
| `claude/phase-1b-db-security-audit` | `0bedf0a` | 1A + DB audit from a catalog export of project `teppcfnpkoxkudajnvad`, replica tests, kiosk inventory query | Unreviewed |
| local `claude/phase-1c-db-containment` | `0bedf0a` + **uncommitted files** | `supabase/migrations/20261016120000_phase1c_security_containment.sql`, its rollback, a test fixture, acceptance tests, runner | **Never committed or pushed.** It exists only in this container. |

**Audit target:** the code at `0bedf0a` (most advanced committed state), plus the uncommitted Phase 1C package. Line references below are to `0bedf0a`.

### Checks actually run today
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **exit 0**, 0 errors |
| Unit tests | `npx jest` | **exit 0**, 6 suites, 41 tests passed |
| Lint | `npx expo lint` | **exit 1**: 102 problems (49 errors, 53 warnings), the same count Phase 1A reported as pre-existing |
| JS bundle | `expo export --platform android` (placeholder `EXPO_PUBLIC_*`) | **exit 0**, 3.2 MB bundle |
| Phase 1C package | `supabase/tests/run_phase1c_tests.sh` on a disposable local **PostgreSQL 16** | **All checks passed.** BEFORE 7 pass / 19 fail; AFTER 26 / 0; re-apply clean; seed guard aborts with nothing partly applied; rollback restores the exact BEFORE policy/grant/function matrix |
| Secret scan | `git log --all -p` for JWTs, `service_role`, `sb_secret_`, `sk_live/test` | Nothing found. The one `sb_secret_` hit is a test fixture string. |
| Native / EAS build | — | **Not run.** `app.json` still references `./assets/notification.wav`, which still does not exist, so prebuild is expected to fail. |
| Deployed Supabase state | — | **Blocked.** There are no credentials in this environment, by design. |
| Payment provider | — | **Blocked.** None has been chosen, and no payment code exists. |

**Limits of the Phase 1C result:**
- It runs against `phase1c_baseline_staging.sql`, a fixture reconstructed from the Phase 1B catalog export, not the real schema.
- The fixture uses PostgreSQL 16; staging runs 17.6.
- The raw catalog JSON was **never committed** (`supabase/evidence/` holds only the queries), so Codex cannot independently check the fixture or the Phase 1B findings against the evidence.

## 1. Architecture and dependency map (unchanged since Phase 0, verified)

- **Stack:** Expo SDK 57.0.22, React Native 0.86.3 (New Architecture, JSC), React 19.2.3, expo-router 57, `@supabase/supabase-js` **2.39.8** (still the old line), zustand 5, TypeScript 6.0.3.
- **Shape:** a single client app with route groups `(auth)`, `onboarding`, `(app)` (customer), `(collaborator)` (partner), `(driver)` and `(admin)`. There is still **no trusted backend**: no Edge Functions and no RPCs called by the app (`grep '.rpc('` finds nothing). All business logic is client-side table access with the anon key and the user JWT.
- **Database surface used by the client** (`grep .from(` across `app/` and `src/`): `user_profiles, meals, orders, order_items, collaborators, collaborator_orders, collaborator_payouts, drivers, driver_weekly_earnings, cash_collections, user_push_tokens, driver_push_tokens, admin_logs, subscriptions`, plus the storage bucket `meal-images`.
- **Realtime channels:**
  - `orders` (driver dashboard, driver order, customer tracking, `locationService`);
  - `collaborator_orders` (partner order).
- **Deployed DB (from 1B evidence, not re-verifiable here):**
  - 24 tables, all with RLS but with permissive policies.
  - The database is **shared with a kiosk/POS system** (`kiosks`, `products`, `daily_closings`, `create_order_transaction`).
  - `orders_status_check` allows only kiosk statuses.
  - The Realtime publication is empty.

## 2. Verified defect status

Legend: **Open** = still present in code at `0bedf0a`. **Fixed (1A, unmerged)** = fixed on an unmerged branch. **Contained by 1C (unapplied)** = closed only if the uncommitted migration is approved and applied.

### 2.1 Auth, roles, access control
| ID | Sev | Status | Evidence today |
|---|---|---|---|
| A1 sign-up chooses role | C | **Fixed (1A, unmerged)** client-side. The DB still allows any value; 1C contains it with a trigger. | `src/stores/authStore.ts:159-170` writes `customer`/`false`. The profile is still inserted **from the client**; there is no `handle_new_user` trigger. |
| A2 self-promotion via profile update | C | **Open in DB.** Contained by 1C (unapplied). | 1B reproduced it (T6). 1C T03a/T13 pass on the fixture. |
| A3 fake admin phrase | C | **Fixed (1A, unmerged)** | Modal deleted |
| A4 admin authority only in routing; no audit log | C | **Open.** 1C moves admin policies to `staff_roles` but adds no audit. | `app/(admin)/orders.tsx:76-80` writes status directly. `adminStore.logAdminAction` (`src/stores/adminStore.ts:337-351`) is a client insert, and `admin_logs` has no policies, so it **always fails silently**. |
| A5 role cascade in the client | H | **Partly fixed.** Errors no longer fall back to `customer`. The app still routes admin from `user_profiles.is_admin`, not `staff_roles`. | `authStore.ts:33-71`. After 1C, the illegitimate `customer`+`is_admin` account would still be **shown the admin UI**, with the DB denying its writes. |
| A6 listener/logout leaks | H | **Fixed (1A, unmerged).** The push-token row is still not deleted on logout, and a driver stays `online`. | `sessionReset.ts` |
| A7 RN Supabase setup | M | **Fixed (1A, unmerged).** SDK not upgraded. | `src/lib/supabase.ts` |
| A8 route-guard race | M | **Fixed (1A, unmerged)** | `RouteGate`, `routeDecision.ts` (unit tested) |
| A9 partner provisioning by email | H | **Open** | `app/(admin)/collaborators.tsx:84-88` compares `user_profiles.user_id` (uuid) with an email. `:55-58` embeds `users:user_id(email)`, which cannot resolve `auth.users`. |
| A10 approval and availability in one column | H | **Open.** 1C keeps `drivers.status` client-writable. | `app/(driver)/index.tsx:227-235`. 1C grants `UPDATE(status, …)`, so a pending or rejected driver can still set `online`. The 1C header says so. |

### 2.2 Checkout and orders
| ID | Sev | Status | Evidence today |
|---|---|---|---|
| O1 client pricing | C | **Open** | `app/(app)/checkout.tsx:27-29`: `deliveryFee = 15`, totals from the persisted cart, no 8 MAD service fee |
| O2 client-set status/payment | C | **Partly fixed.** Card was removed from the UI (1A). `status: 'confirmed'` is still client-set, and the DB accepts any method or status (1B C2). | `src/checkout/orderPayload.ts:46` |
| O3 non-atomic order + items, no idempotency | H | **Open** | `checkout.tsx:74-106` (two inserts). `order_number = Date.now()+random` (`:32-34`). `order_items.price` comes from the cart (`:89-95`). |
| O4 customer enumerates drivers and pushes them | H | **Open** | `checkout.tsx:108-116` → `notificationService.ts:126-141` |
| O5 no cancel / reject / failure paths | H | **Open** | No such code anywhere |
| O6 driver "Total to Collect" = total + 19 | H | **Open** | `app/(driver)/orders/[id].tsx:83,369-373` |
| **New:** checkout stops working entirely once 1C is applied | H | Intentional in 1C | 1C drops every client INSERT policy on `orders`/`order_items`; there is no replacement RPC yet |

### 2.3 Partner preparation
| ID | Sev | Status | Evidence today |
|---|---|---|---|
| P1 nothing creates `collaborator_orders` | H | **Open** | No insert anywhere. 1B: no trigger on `orders`. |
| P2 partner progress never reaches `orders.status` | H | **Open** | `src/stores/collaboratorStore.ts:203-217` |
| P3 rejection-reason field mismatch, no transition guard | M | **Open** | `collaboratorStore.ts:225-232` |
| P4 hard-coded stats | M | **Open** | `collaboratorStore.ts:128-129` (`98.5`, `24`) |

### 2.4 Driver and location
| ID | Sev | Status | Evidence today |
|---|---|---|---|
| D1 claim checks only `driver_id IS NULL` | H | **Open.** It is also **non-functional**: 1B F2 found no policy that lets drivers see unassigned orders, and `accepted` violates the status check (F1). | `app/(driver)/index.tsx:264-274` |
| D2 driver writes any status, no `driver_id` filter | H | **Open.** After 1C the write is denied (no UPDATE policy), so the driver flow fails safely but does not work. | `app/(driver)/orders/[id].tsx:121-146` |
| D3 cash recorded as the delivery fee; three driver-pay definitions | C | **Open** | `orders/[id].tsx:148-194`: `amount = delivery_fee` and a "15% commission" message. `index.tsx:186-213` counts the full delivery fee as earnings. `cash_collections` has no policies, so the insert always fails (1B F3). |
| D4 unsupported Realtime filter `driver_id=is.null` | M | **Open** | `index.tsx:52` |
| D5 stale `activeOrder` closure; location written into `orders` | M | **Open** | `index.tsx:104-127` |
| D6 Realtime channel leak | M | **Fixed (1A, unmerged)** | `orders/[id].tsx:44-48` |
| D7 tracking timeline does not match statuses | M | **Open** | `app/(app)/order-tracking/[id].tsx:29-34`. `preparing` is not written by anyone; `accepted`/`picked_up` are missing. There is no refetch on reconnect. |

### 2.5 Notifications, finance, mocks, hygiene
| ID | Sev | Status | Evidence today |
|---|---|---|---|
| N1 client-side push sending | H | **Open.** The TS error is fixed (1A). | `notificationService.ts:64-141`: `upsert` without `onConflict`; `.single()` breaks with several devices. 1B: the token tables have no UPDATE/DELETE policies. |
| F1 no payments/ledger; revenue sums all orders | C | **Open** | `app/(admin)/index.tsx:58-75`, `app/(admin)/earnings.tsx:38-50` |
| **New:** inconsistent fee constants | H | Open | App delivery fee 15. DB `orders.delivery_fee` default 10 and `platform_settings.service_fee_per_order` default 15 (1B). Driver screen service fee 19. Product direction: 8 MAD service fee. |
| X1 out-of-scope subscription/streak/reorder UI | M | **Open.** The tabs are hidden (`href: null`), but the routes and the `subscription/active` deep link (`app/_layout.tsx:53-79`) are live. | `profile.tsx:27` `streakDays = 7` |
| X2 dev artefacts in the route tree | M | **Open** | `app/(driver)/extractor.py`, `app/(driver)/output.txt` (75 KB), `assets/icon_BAK.png`, `assets/ChatGPT Image …png` |
| X3 missing `notification.wav` | M | **Open** | `assets/` has no such file |
| Lint | M | **Open** | 49 errors, pre-existing |

### 2.6 Database (from Phase 1B evidence; deployed state not re-verifiable here)
C1–C4 and H1–H6 in `PHASE1B_DATABASE_SECURITY_AUDIT.md` are **open in the deployed project** unless 1C was applied outside this repository. Nothing in the repo records that it was. The uncommitted 1C package closes C1, C2, C3, C4, H2, H3 (partly), H4 and M2 **on the fixture**. It does **not** address:
- H1: becomes moot once the item-insert policy is dropped.
- The functional blockers F1–F6: status check, driver visibility, `cash_collections`/`admin_logs` policies, Realtime publication, admin reads of `drivers`/`user_profiles`, partner assignment.
- The storage policy (M3).

### 2.7 Review notes on the uncommitted Phase 1C migration
1. **Its role model conflicts with this assignment.**
   - `staff_roles.role` accepts `admin, support, cashier, kitchen_staff, driver` and has a `kitchen_id` scope. It has **no partner/collaborator role and no branch scope**.
   - The V1 scope here is a *partner* marketplace with branch assignment.
   - 1C also retires the kiosk policies (`cashier_update_orders`, `kitchen_update_orders`, `staff_read_orders`, `ceo_all_closings`), which presumes a kiosk-decommission decision. No such decision is recorded in the repository.
2. **It cannot run on a clean database.** It assumes the deployed tables and named policies already exist, and there is no baseline migration. The acceptance criterion "migrations apply to a clean test database" is not met.
3. **Profile guard is silent.** `enforce_profile_privilege_guard` overwrites `role`/`is_admin` silently instead of raising. That is safe, but a tampering attempt reports success. Raising `42501` on UPDATE would be clearer.
4. **Admins get no new write paths.** Column grants and missing policies mean admins also cannot update `drivers` approval fields or other users' profiles through the API. Admin provisioning then needs RPCs (planned below), and the current admin driver-approval screen stops working.
5. **Comments assert facts the repo does not record.** The comments state "Target: STAGING ONLY" and "confirmed-illegitimate account". Neither confirmation is written down here. Both should be recorded before the migration is applied.
6. **Risk of loss.** The files are uncommitted in an ephemeral container. A copy was made to the session scratchpad, which is also ephemeral.

## 3. Unknowns requiring access

| # | Unknown | Needed to decide |
|---|---|---|
| U1 | Is `teppcfnpkoxkudajnvad` production or staging? Is there a separate staging project? | Whether any migration may be applied |
| U2 | Is the kiosk/POS (Ola Amigos) still in use, and does it write `orders`/`daily_closings` with the anon key? | Whether 1C breaks a live system |
| U3 | Auth hooks / JWT `role` claims; email confirmation; sign-up settings | Role provisioning design |
| U4–U6 | Event triggers (`rls_auto_enable`), `authenticator` config (`safeupdate`), `public` schema ACL | Hardening completeness |
| U7 | Written confirmation that the `customer`+`is_admin` account is illegitimate | 1C seed logic |
| U8 | Order data mix: methods, statuses, orphans, duplicates, kiosk vs app | Safe constraint and status migrations |
| U9 | Whether 1C (or anything else) has already been applied outside the repo | Migration ordering |
| U10 | The raw 2026-10-15 catalog JSON (to commit as evidence) | Independent verification by Codex |
| P1–P6 | Payment provider identity; sandbox; webhook signing; refund API; fees; merchant structure; whether two-account split settlement exists | Phase 3 settlement design |

## 4. Decisions needed from the CTO

1. **Operating model (blocking).** This assignment specifies a *partner marketplace*: partner order assignment, branch/driver assignment. Earlier direction recorded in Phase 1A/1C specifies a *kitchen/cashier* model (Kitchen A, cashier confirmation, kiosk retirement). Choose one. This changes `staff_roles`, assignment, RLS scoping and the partner screens.
2. **Phase 1C:** approve it as-is, approve it amended for decision 1, or reject it. Confirm the target environment and the kiosk decommission.
3. **Branch strategy:** merge 1A → 1B → (1C) into `main` through PRs before Phase 1 continues, so that later work is not stacked on unreviewed branches.
4. **Pricing:**
   - Is delivery fee 15 MAD flat (DB default 10)?
   - Is the service fee 8 MAD (the DB setting says 15; the driver screen shows 19)?
   - Is TVA included?
   - Is there a minimum order?
5. **Payment at launch:** COD only (current state) until a provider is approved?
6. **Assignment rule:** how is an order assigned to a partner or branch (nearest, customer choice, admin)? Is it one partner per order?
7. **Partner economics:** what is the revenue-share base, and is it the partner share or the platform commission?
8. **Driver pay and cash:**
   - Is driver pay a flat amount per delivery, the full delivery fee, or a percentage? (The code uses three definitions.)
   - Who holds collected cash, and how is it remitted?
9. **Driver rules:**
   - Maximum active jobs (recommend 1).
   - Can a driver claim before the order is `ready`?
   - Open pool or dispatch?
10. **Cancellation and failure:**
    - Customer cancellation cut-off.
    - Partner rejection fallback.
    - Who bears the cost when the customer is absent.
11. **Provisioning:** partners and drivers by admin invite only (recommended)?
12. **Location retention period.**
13. **Out-of-scope screens:** hide them (current) or remove them from the V1 build, including the deep link.

## 5. Proposed migrations (pending decisions 1–3)

Migrations should be applied with the Supabase CLI to a local stack (`supabase start`; Docker is available here) and then to staging. Each one ships with a down script and pgTAP tests.

| Order | Migration | Purpose |
|---|---|---|
| 0 | `baseline` | `supabase db dump --schema-only` of the confirmed staging project, committed. It is a no-op on existing environments and builds a clean DB. This replaces the hand-built fixture as the test base. |
| 1 | `security_containment` | Phase 1C, amended per decision 1 (role set and scope), with the profile guard raising instead of overwriting. |
| 2 | `profiles_and_provisioning` | A `handle_new_user` trigger on `auth.users` creating a customer profile, so the client stops inserting profiles. A `my_roles()` RPC for app routing. Admin RPCs: invite/approve partner and driver, assign and revoke role, all writing `admin_audit_log` server-side. |
| 3 | `driver_partner_model` | Split driver `approval_status` from `availability`. Clients may toggle availability only when approved. Uniqueness on `drivers.id` and `collaborators.user_id`, with a reviewed dedupe. |
| 4 | `order_state_machine` | A separate mobile-order status domain (`app_order_status`) or an extended check, per U2. Payment state separated from order status. `order_status_history`. `transition_order()` per role. Indexes. |
| 5 | `create_order_rpc` | `create_order(items, address, idempotency_key)`. It reads `meals` prices and snapshots them, applies `pricing_config`, forces COD, assigns a partner, and runs in one transaction. Unique `(user_id, idempotency_key)`. |
| 6 | `claim_and_cancel_rpcs` | `claim_order()` (row lock plus eligibility and active-job checks), `cancel_order()`, partner `accept`/`reject`/`ready`. |
| 7 | `pricing_config` | Versioned fees, referenced by each order. |
| 8 | `cash_and_ledger` | Server-recorded cash collection of the amount due. Append-only `ledger_entries`. Payout records. |
| 9 | `payments` | `payments`, `payment_events` (unique provider event id), webhook processing. Sandbox only. |
| 10 | `realtime_and_locations` | `driver_locations` (latest position plus a trail with retention). Add `orders` to the Realtime publication only after read policies are correct. |
| 11 | `notifications_outbox` | Per-device token rows. Outbox processed by an Edge Function. Revoke client token reads. |

## 6. Implementation sequence

1. **Before any code:** answer decisions 1–3. Commit the raw catalog JSON. Commit the 1C package to its own branch so it is reviewable.
2. **Phase 1:** merge 1A/1B. Create the baseline. Amend and apply 1C on local, then on staging only with approval. Provisioning RPCs. Route via `my_roles()`. Fix partner provisioning (A9). Driver approval split (A10). Delete the push token on logout. Add pgTAP authorization tests per role (anon, customer A/B, pending/approved driver, partner of branch X/Y, admin), both permitted and forbidden. Upgrade supabase-js and retest.
3. **Phase 2:** state machine and RPCs (migrations 4–6). Rewire checkout, partner, driver, customer and admin screens to the RPCs. Concurrency tests (parallel claims, double-submit).
4. **Phase 3:** pricing config, cash ledger, payment-provider abstraction with sandbox adapter, verified idempotent webhooks. No live payments.
5. **Phase 4:** assignment, eligibility, `driver_locations`, Realtime resubscribe and refetch on foreground/reconnect, server push via outbox.
6. **Phase 5:** remove mocks and artefacts, add the missing `notification.wav` or drop the reference, lint cleanup, admin earnings terminology, deployment/rollback/monitoring docs, staging E2E.

## 7. Recommended next task

Get decisions 1–3 (operating model, Phase 1C disposition, branch merge plan) and the staging confirmation (U1/U2/U9). With those, Phase 1 starts with the baseline migration and the amended containment migration. Those remain the highest-risk items: any signed-in user can become admin, and anyone with the public anon key can create or rewrite orders.
