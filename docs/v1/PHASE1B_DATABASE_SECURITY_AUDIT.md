# L'OPTION V1 — Phase 1B: Database Security Audit

Branch: `claude/phase-1b-db-security-audit`. **Read-only phase.** No migration was written or applied; no Supabase setting, data or policy was changed.

**Bottom line:** the database does not enforce any of the V1 business rules. RLS is enabled everywhere, but several policies are `true` for every caller, including callers with no login. The result:
- any user can make themselves an administrator;
- anyone holding the public anon key, which ships in the app, can create orders with any price, payment method and status, including `paid`;
- customers can rewrite their own orders after creation.

Separately, the order lifecycle the mobile app uses (delivery statuses, driver claims, Realtime tracking, cash recording) cannot work against this schema as it stands.

## 1. Evidence reviewed and its limitations

| Evidence | Source | Notes |
|---|---|---|
| Catalog export from `supabase/evidence/phase1b_catalog_query.sql` | Run by the project owner in the SQL Editor of project `teppcfnpkoxkudajnvad`; `generated_at` 2026-10-15T19:40:30Z; PostgreSQL **17.6** | Tables and RLS flags, effective `anon`/`authenticated` privileges, column ACLs, columns, constraints, indexes, policies, functions, triggers, enums, views, Realtime publication, storage buckets, default privileges, roles, extensions. Supplied in chat. **The raw JSON should be committed** (see §7) so reviewers can verify this document against it. |
| `select role, is_admin, count(*) from user_profiles group by 1,2` | Same project | `admin/true: 1`, `customer/false: 14`, `customer/true: 1`, `driver/false: 1` |
| Local reproduction: `supabase/evidence/phase1b_policy_replica_test.sql` | Disposable local PostgreSQL 16, deleted after the run | Recreates the exact policies, check constraint and grants for `orders`, `order_items`, `user_profiles`, `drivers` and `daily_closings`, plus Supabase-style `auth.uid()`/`auth.role()`/`auth.jwt()`. Ten attack/function tests; results in §3. |
| Mobile client source code | This repository | Shows which reads and writes the app sends. |

**Limitations:**
- **Environment unknown:** whether `teppcfnpkoxkudajnvad` is production or staging has not been confirmed.
- **Not tested through the real API:** the local replica reproduces database behaviour, not the hosted API. PostgREST uses the same mechanism (`SET ROLE` plus `request.jwt.claims`), but no request was sent to the real project, by design.
- **Missing from the evidence** (listed in §5):
  - Auth settings and Auth Hooks;
  - event triggers;
  - the `authenticator` role configuration (e.g. `safeupdate`);
  - `public` schema ACL;
  - the order-data aggregates (payment-method/status mix, orphans, duplicates);
  - whether custom Postgres roles named `ceo`/`kitchen`/`cashier` exist.
- **Other systems share this database (verified).** It contains a kiosk/POS system: `kiosks`, `products` with `brand IN ('ola-amigos','loption')`, `stock_movements`, `daily_closings`, `create_order_transaction(p_kiosk_id, ...)`, and kitchen/cashier/CEO policies. Changes to shared tables, especially `orders`, can break that system. Its owners and clients are unknown.

## 2. Verified schema and authorization findings

### 2.1 Tables, grants and RLS
- **24 tables in `public`, all with RLS enabled, none with RLS forced:** `admin_logs, admins, bank_accounts, cash_collections, collaborator_analytics, collaborator_orders, collaborator_payouts, collaborators, daily_closings, driver_payouts, driver_push_tokens, driver_weekly_earnings, drivers, financial_transactions, kiosks, meals, order_items, order_status_updates, orders, platform_settings, products, stock_movements, user_profiles, user_push_tokens`.
- **`anon` and `authenticated` hold SELECT, INSERT, UPDATE and DELETE on every `public` table**, with no column-level ACLs. **RLS policies are therefore the only access control.**
- **Default privileges** grant all table rights, sequence rights and function `EXECUTE` in `public` to `anon` and `authenticated` for future objects (owners `postgres` and `supabase_admin`).
- **Every policy targets role `public`**, which includes `anon`. A `USING (true)` / `WITH CHECK (true)` policy therefore applies to unauthenticated callers too.
- **Eight tables have RLS enabled and no policies**, so only `service_role` can access them: `admin_logs`, `admins`, `bank_accounts`, `cash_collections`, `driver_payouts`, `driver_weekly_earnings`, `financial_transactions`, `platform_settings`. This protects `bank_accounts` and `admins`, but also blocks the app's own writes (§3, F3).
- **No views. Realtime publication `supabase_realtime` contains no tables.**
- **Extensions:** `plpgsql`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault`.

### 2.2 Who can read and write `orders` and `order_items` (task 2)
Permissive policies are combined with OR, so the most permissive one decides.

| Table / action | Who is allowed (from the policies) | Restrictions on values |
|---|---|---|
| `orders` SELECT | Owner (`user_id = auth.uid()`); assigned driver (`driver_id = auth.uid()`); any user whose `user_profiles.is_admin = true`; JWT `role` claim `kitchen`/`cashier`/`ceo` (see U3); service role | — |
| `orders` INSERT | **Anyone, including `anon`** (`Allow public insert orders`, `public_create_orders`: `WITH CHECK (true)`) | Only `orders_status_check`, `NOT NULL`s, FKs and the unique `order_number`. **No restriction on `payment_method`, `total`, `subtotal`, `delivery_fee`, `user_id`, `driver_id`, `financial_status`, or status `paid`/`served`.** |
| `orders` UPDATE | Any row the caller can see (`Allow public update orders`: `USING (true)`, no `WITH CHECK`) — owner, assigned driver, admins, JWT-role staff | **Any column to any value** allowed by the status check. Rows the caller cannot SELECT are not reachable by filtered updates (reproduced, T4). Whether unfiltered updates are blocked depends on U5. |
| `orders` DELETE | `is_admin` users; service role | — |
| `order_items` SELECT | Owner of the parent order; `is_admin` users | — |
| `order_items` INSERT | Owner of the parent order; `is_admin` users | **Any `price`, `meal_name`, `quantity`, `meal_id`**; nothing checks against `meals` |
| `order_items` UPDATE/DELETE | `is_admin` users only | — |

### 2.3 Roles and administrator privileges (task 3)
There are **three unrelated role systems**:
1. **`user_profiles.role` (text, default `'customer'`, no check constraint) and `user_profiles.is_admin` (boolean).** Every admin policy in the database is `auth.uid() IN (SELECT user_id FROM user_profiles WHERE is_admin = true)`.
   - **The owner of a row can INSERT and UPDATE it without restriction:** `WITH CHECK (auth.uid() = user_id)`, and the UPDATE policy has no `WITH CHECK`.
   - **A customer can therefore set `is_admin = true` or `role = 'admin'` on themselves** (reproduced, T6).
2. **`public.admins`** (`id → auth.users`, `email`, `security_phrase_hash`, `is_active`). RLS is on with no policies; no policy or function references it. The mobile app never used the hash (the client "security phrase" was removed in Phase 1A).
3. **JWT `role` claim values `ceo`, `kitchen`, `cashier`**, used by kiosk-side policies on `orders`, `products`, `kiosks`, `daily_closings` and `stock_movements`. Standard Supabase JWTs carry `role = authenticated|anon`. These policies only take effect if an Auth hook or custom Postgres roles produce those values (U3).

**Data:** one `user_profiles` row has `role = 'customer'` with `is_admin = true`. Under (1) that account has full admin power in the database, and the mobile app also routes it as admin. Whether this is a deliberate grant or the result of self-promotion cannot be told from the schema (see U7).

### 2.4 Order creation, duplicates and orphans (task 5)
- `orders.order_number` is **unique** (`orders_order_number_key`), so an exact replay with the same number is rejected.
- The app generates a new number on every attempt and there is no idempotency key, so **retries or double-taps create duplicate orders**.
- `order_items.order_id → orders.id ON DELETE CASCADE` prevents orphan items. **Nothing prevents an order with no items:** the app's two separate inserts can fail in between, and no trigger or transaction function exists for mobile orders.
- Counts of existing duplicates and orphans were not provided (U8).
- **`create_order_transaction(...)`** is `SECURITY DEFINER`, has no fixed `search_path`, is executable by `anon`, takes a caller-supplied `p_total`, and is kiosk-oriented.
  - It inserts `order_items (order_id, product_id, product_name, unit_price, quantity)`, but **`order_items` has no `product_id`, `product_name` or `unit_price` columns**. As deployed it should fail at that insert and roll back.
  - Whether the kiosk system relies on it is unknown (U2).

### 2.5 Confirmation workflow and kitchen assignment (task 6)
**The existing schema does not support the V1 workflow.**
- **Statuses:** `orders_status_check` allows only `new, confirmed, waiting_payment, in_preparation, prepared, ready_to_serve, served, paid`. These are kiosk/table-service statuses. There are no delivery statuses (`accepted`, `picked_up`, `on_the_way`, `delivered`) and no `cancelled` (reproduced, T9).
- **"Paid" is an order status.** There is no separate payment state for orders, so "confirmed" and "paid" share one field. `financial_status` (text, default `pending`) exists, but it is client-writable and has no constraint.
- **No kitchen entity.** `kiosks` (name, location, status) represents ordering terminals. `collaborators` represents the out-of-scope partner model (branch fields, revenue share). `orders.kiosk_id` and `orders.collaborator_id` exist; there is no kitchen reference.
- **No working staff role for mobile orders.** Cashier and kitchen policies depend on JWT claims that are unverified (U3). Nothing records which cashier confirmed an order or when.
- **No triggers on `orders`**: no status history, no server-side totals, and no creation of `collaborator_orders`. The only `public` triggers are on `collaborator_orders` (revenue split, analytics).
- **Pricing configuration:** `platform_settings` has `service_fee_per_order` (default 15) and `driver_commission_percent` (default 15), but no policies, so the client cannot read it. Its contents were not inspected. `orders.delivery_fee` defaults to 10, while the app charges 15. **No distance-based delivery fee or subtotal-based service fee exists.**

## 3. Risk findings

Severity reflects the impact on V1 if the project is (or will become) production. **Verified** means it follows directly from the catalog evidence. **Reproduced** means it was also demonstrated on the local replica (test IDs refer to `phase1b_policy_replica_test.sql`).

### Critical
| # | Finding | Evidence |
|---|---|---|
| **C1** | **Any signed-in user can make themselves an administrator** (`is_admin = true` / `role = 'admin'`), and through that read, modify and delete every order, edit menu prices (`meals`), and manage collaborators and payouts. | `user_profiles` policies "Users can insert their own profile" / "Users can update their own profile"; admin policies on `orders`, `order_items`, `meals`, `collaborators`, `collaborator_orders`, `collaborator_payouts`, `collaborator_analytics`. **Reproduced T6/T6b.** |
| **C2** | **Anyone with the public anon key, no login needed, can create orders with any values**: card payment, total 0, status `paid` or `served`, any `user_id` (forged orders attributed to another customer) or `driver_id`. COD-only and server pricing are not enforced. | `orders` INSERT policies `Allow public insert orders` and `public_create_orders` (`WITH CHECK (true)`, role `public`); no constraint on `payment_method`. **Reproduced T1, T2.** |
| **C3** | **A customer can rewrite their own order after creation**: mark it `paid`, set `total = 0`, change `payment_method`, `financial_status` or `driver_commission_paid`, or reassign `user_id`/`driver_id`. Assigned drivers and anyone else who can see an order can do the same. | `Allow public update orders` (`USING (true)`, no `WITH CHECK`) and `Users can update their own orders`. **Reproduced T3.** Cross-customer filtered updates are blocked only by SELECT visibility (T4). |
| **C4** | **`daily_closings` (financial closing records) can be read, inserted, modified and deleted by anyone, including unauthenticated callers.** | Policy `Allow all on daily_closings` (`ALL`, `USING (true)`, role `public`). **Reproduced T10** (anon deleted all rows). |

### High
| # | Finding | Evidence |
|---|---|---|
| H1 | Customers can add items to their own orders with any price, name and quantity. Item rows cannot be trusted for totals or kitchen preparation. | `order_items` INSERT policy; no check against `meals`. **Reproduced T5.** |
| H2 | Anyone, including anon, can insert status messages for any order, and anyone can read all status updates. This allows spoofed tracking messages and leaks order activity. | `order_status_updates`: `staff_insert_status` `WITH CHECK (true)`, `public_read_status` `USING (true)`. |
| H3 | Any signed-in user can create their own `drivers` row and set `status` (e.g. `online`), `commission_rate` and `total_earned`. Driver approval is not enforced, and approval and availability share one column. | `drivers` policies "Users can insert own driver record" / "Users can update own driver record" (no `WITH CHECK`). **Reproduced T7.** |
| H4 | `SECURITY DEFINER` function `create_order_transaction` is executable by `anon`/`authenticated`, has a mutable `search_path`, trusts a caller-supplied total and decrements stock. It currently appears to fail (missing columns), but fixing its columns without hardening it would create an anonymous order path that bypasses RLS. | `functions` evidence; `order_items` columns. |
| H5 | An account with role `customer` holds `is_admin = true`. It is effectively an administrator in every admin policy. | `user_profiles` aggregate. Legitimacy unknown (U7). |
| H6 | Role model is inconsistent: `user_profiles.is_admin`, an unused `admins` table, and JWT-claim staff roles that may be inert. There is no single authority for admin, cashier or kitchen, so staff permissions cannot be audited. | §2.3. |

### Medium
| # | Finding | Evidence |
|---|---|---|
| M1 | Duplicate orders on retry, and orders without items, are possible (no idempotency key; two-step creation). | §2.4 |
| M2 | Every new `public` table and function automatically gets full `anon`/`authenticated` rights. Safety then depends on RLS being enabled and correctly written each time. | `default_privileges`. `rls_auto_enable()` exists, but whether its event trigger is active is unknown (U4). |
| M3 | Any signed-in user can upload any file type and size to the **public** `meal-images` bucket. Existing images cannot be overwritten by others; owner-only update/delete. | `storage.objects` policies; bucket has no MIME/size limits. |
| M4 | All policies target `public` (includes `anon`) instead of `authenticated`, so mistakes like C2/C4 extend to unauthenticated callers. | `policies` |
| M5 | Staff policies keyed on JWT `role` claims are either inert or depend on an Auth hook that has not been reviewed. Either way, the kiosk staff model is unverified. | U3 |

### Low
- Duplicate foreign keys on `orders.driver_id` (`fk_orders_driver_id`, `orders_driver_id_fkey`).
- Timestamp types are mixed (`timestamp` vs `timestamptz`).
- `calculate_driver_weekly_earnings()` is `anon`-executable, but it is not `SECURITY DEFINER`, cannot write under RLS, and uses `ON CONFLICT (driver_id, week_start)` with no matching unique constraint, so it is broken.
- Push-token tables have no UPDATE/DELETE policies, so the app's upsert cannot refresh tokens and logout cannot remove them.
- `orders.user_id → auth.users` has no `ON DELETE` rule, so deleting a user with orders fails.

### Functional blockers for the V1 order lifecycle (verified)
| # | Blocker | Evidence |
|---|---|---|
| F1 | The app's delivery and cancellation statuses (`accepted`, `picked_up`, `on_the_way`, `delivered`, `cancelled`) violate `orders_status_check`. Driver accept, pick-up and deliver updates fail. | **Reproduced T9.** |
| F2 | Drivers cannot see unassigned orders (no policy), so the claim list is always empty and the claim update matches no rows. | **Reproduced T8.** |
| F3 | `cash_collections` and `admin_logs` inserts, and `driver_weekly_earnings` / `platform_settings` reads, are denied (RLS with no policies). Cash is never recorded and admin actions are never logged. | §2.1 |
| F4 | Realtime publication has no tables, so the app's live order tracking subscriptions never receive changes. | `realtime_publication: null` |
| F5 | Admins cannot read `drivers` or other users' `user_profiles` (no admin policies). The admin drivers and customers screens and stats show only the admin's own rows. | policies |
| F6 | Nothing assigns orders to a kitchen or partner. | §2.5 |

### Direct-request summary (task 4)
| Attack | Possible today? |
|---|---|
| Create a card order | **Yes**, even without login (C2) |
| Manipulate prices or totals | **Yes**: on insert (C2, H1) and afterwards (C3) |
| Set a privileged status (`paid`, `served`, `prepared`, …) | **Yes**, any status allowed by the check constraint (C2, C3) |
| Modify another user's order | **Not directly** via filtered updates (T4). **Yes** after self-promotion to admin (C1, T6b), and an assigned driver can rewrite that order's money fields (C3) |

## 4. Supabase-managed schemas (task 7)
- **`auth`:** no triggers on `auth.users` (none appeared in the trigger list for `auth`), so no profile is created on sign-up. The app inserts it from the client.
  - **Auth Hooks and JWT claim customisation live in dashboard settings that are not part of this evidence.** Only the staff policies keyed on the JWT `role` claim (M5, H6) depend on them. C1–C4 do not depend on hooks at all.
- **`storage`:** bucket and object policies captured (M3). Supabase-internal triggers on `storage` are standard.
- **`realtime`:** the publication was captured (empty). Realtime authorization settings for broadcast/presence were not captured; the app does not use them.

## 5. Unknowns requiring dashboard or read-only inspection
| # | Question | How to answer (read-only) |
|---|---|---|
| U1 | Is `teppcfnpkoxkudajnvad` production or staging? Is there a separate staging project? | Owner confirmation |
| U2 | Which applications use this database (mobile app, kiosk/POS, `ola-amigos`, web)? Do any use the anon key to insert orders or write `daily_closings`, or call `create_order_transaction`? | Owner confirmation; API logs in the dashboard |
| U3 | Do JWTs ever carry `role` = `ceo`/`kitchen`/`cashier`? | Dashboard → Authentication → Hooks; `select rolname from pg_roles where rolname in ('ceo','kitchen','cashier');` |
| U4 | Is the `rls_auto_enable` event trigger active? | `select evtname, evtevent, evtenabled, evtfoid::regproc from pg_event_trigger;` |
| U5 | Are unfiltered API UPDATE/DELETE blocked (`safeupdate`)? | `select rolname, rolconfig from pg_roles where rolname = 'authenticator';` |
| U6 | Can `anon`/`authenticated` create objects in `public`? (Matters for H4's `search_path` risk.) | `select nspname, nspacl from pg_namespace where nspname = 'public';` |
| U7 | Are the two `is_admin = true` accounts legitimate? (Do not share personal data; confirm yes or no.) | Owner review in the Table Editor |
| U8 | Existing order data: payment methods, statuses, orphans, duplicates, kiosk vs app orders | `select payment_method, status, count(*) from public.orders group by 1,2 order by 1,2;`<br>`select count(*) from public.orders o where not exists (select 1 from public.order_items i where i.order_id = o.id);`<br>`select (kiosk_id is not null) as kiosk, (user_id is not null) as app_user, count(*) from public.orders group by 1,2;` |
| U9 | Auth settings: sign-ups enabled, email confirmation, providers | Dashboard → Authentication |
| U10 | Edge Functions or other server code using the service role | Dashboard → Edge Functions (names only) |

## 6. Recommended remediation sequence (proposals for CTO approval, nothing implemented)

**Ground rules:**
- No change is applied to production without CTO approval, a backup or point-in-time-recovery marker, and passing tests on a local or staging copy.
- Historical orders, including `card` ones, are never rewritten or deleted.
- New tables, columns and role names below are **described, not named**; names are a CTO decision.
- Pricing formulas stay unimplemented until they are approved.

### Stage 0 — Preconditions (no schema change)
| Item | Purpose | Assumptions | Risks | Compatibility | Verification |
|---|---|---|---|---|---|
| Answer U1–U10 | Know the blast radius, especially the kiosk system sharing `orders` | Owner can confirm consumers | Changing shared tables without this can break the kiosk | — | Written answers attached to this doc |
| Commit the raw evidence JSON; build a local Supabase test project from it | A reproducible baseline to test every change | Schema can be recreated locally (as done for the replica) | Replica drift from production | — | Replica test T1–T10 reproduces current behaviour before any fix |
| Investigate the `customer` + `is_admin` account (U7) | Detect possible past self-promotion | Owner can identify the account | If illegitimate, data may already be tampered with | Revoking it changes that user's access | Owner sign-off; review `orders` changes made by that user if logs allow |

### Stage 1 — Emergency containment (smallest reversible changes)
| Change | Purpose | Assumptions | Risks | Backward compatibility | Verification |
|---|---|---|---|---|---|
| 1a. Prevent non-service roles from setting or changing `user_profiles.role` / `is_admin` (e.g. a BEFORE INSERT/UPDATE guard that forces defaults on insert and rejects changes; plus `WITH CHECK` on the update policy) | Close C1 | Only admins or the service role should grant roles; current app writes `role:'customer', is_admin:false` on sign-up | Locks out any legitimate in-app role grant (none found in the app) | The Phase 1A app keeps working because insert values match the forced defaults | Customer UPDATE of own `is_admin`/`role` fails; INSERT with `is_admin:true` is coerced or rejected; existing admin rows unchanged; T6 now fails |
| 1b. Drop `Allow public insert orders`, `public_create_orders`, `Allow public update orders` | Close C2/C3 for anon and arbitrary values | **Requires U2:** the kiosk must not depend on anonymous inserts | Kiosk ordering may break if it uses the anon key | Mobile checkout still works through "Users can insert their own orders" until Stage 2 | T1/T2 fail; customer own-order insert still works; kiosk smoke test passes |
| 1c. Restrict customer UPDATE on `orders` (remove or replace "Users can update their own orders"; cancellation moves to Stage 2) | Close C3 for customers | The app has no customer update flow today (verified in code) | Any undiscovered customer update path breaks | None in the current app | T3 fails |
| 1d. Replace `Allow all on daily_closings` with staff-only access | Close C4 | **Requires U2/U3:** how the kiosk authenticates | Kiosk closing screen may break | Mobile app does not use it | T10 fails for anon; the kiosk role still works |
| 1e. Restrict `order_status_updates` INSERT to staff/service and SELECT to the order owner or staff | Close H2 | Same as 1d | Kiosk tracking may depend on public read | Mobile app does not use it | Anon insert/read fails |
| 1f. Revoke `anon` EXECUTE on `create_order_transaction` and `calculate_driver_weekly_earnings`; set a fixed `search_path` on `SECURITY DEFINER` functions | Close H4 | Kiosk does not call it as anon (U2) | Kiosk order creation (if it works at all) | None for mobile | `has_function_privilege('anon', …)` false |
| 1g. `drivers`: block self-insert (or force a pending status on insert) and limit self-update to location/availability columns | Close H3 | Drivers are provisioned by admins (CTO decision pending) | Breaks any self-registration path (none in the app) | Driver location updates continue | T7 fails; a driver can still update own location |

**Rollback:** every Stage 1 change is a policy, grant or trigger. The original policy definitions are recorded verbatim in the evidence JSON, so rollback means recreating them. Each migration ships with its down script.

### Stage 2 — Trusted order creation and customer cancellation
| Change | Purpose | Assumptions | Risks | Backward compatibility | Verification |
|---|---|---|---|---|---|
| A `SECURITY DEFINER` order-creation function with fixed `search_path`, `authenticated` only. In one transaction it: reads item prices from `meals`; snapshots name and price into `order_items`; computes totals; forces COD; sets the initial status server-side; enforces an idempotency key; rejects empty carts and unavailable meals | Authoritative pricing, COD, atomicity (M1) | **Fee formulas are not approved.** Until they are, the function can only use a CTO-approved interim rule or reject orders. An idempotency key needs a new column (proposal) | Price drift between menu and app display | Old app versions keep inserting directly until direct INSERT is revoked → plan a forced app update | Tampered prices or totals ignored; `card` rejected; same key twice gives one order; failure mid-way leaves nothing |
| Then revoke direct INSERT on `orders`/`order_items` for client roles (or drop the customer insert policies) | Make the function the only path | Kiosk handled separately (U2) | Breaks old app versions | Requires the app release from this stage | Direct insert fails for `authenticated` and `anon` |
| COD rule for **new** orders enforced in the function, plus a BEFORE INSERT guard, **not** a `CHECK ... NOT VALID` | Enforce COD without touching history | — | A `NOT VALID` CHECK still applies to **any update** of existing `card` rows, so status changes on historical card orders would fail | Historical card orders stay readable and updatable | Insert `card` fails; updating an old `card` order's status still works |
| A cancellation function: owner only, allowed only before preparation starts | Business rule | Exact cut-off status depends on the Stage 3 status model | — | New app call | Cancel before prep succeeds; after prep fails with a clear error |

### Stage 3 — Order status model shared with the kiosk system
- **Decision needed:** extend `orders_status_check` with delivery statuses, or separate mobile and kiosk lifecycles.
- **Payment state must become separate from order status.** "Confirmed" is not "paid"; COD payment is recorded only when cash collection is reconciled.
- Transitions happen only through per-role functions (cashier confirm, kitchen start/finish, driver claim/pick-up/deliver, support exception), each logged with actor and time (`order_status_updates` or a new history table — CTO decision).
- **Risks:** changing the shared check constraint affects the kiosk (U2).
- **Verification:** a state-machine test matrix of allowed and forbidden transitions per role; T9 passes for approved statuses.

### Stage 4 — Staff roles and kitchens
- **One authoritative role source** (CTO decision). Options:
  - an admin-managed role table read by policies;
  - an Auth hook adding a custom claim, *not* the reserved `role` claim;
  - reusing `admins`.
- Retire or align `is_admin` and the JWT-`role` policies after migrating the existing admin rows (U7).
- **Kitchen entity** (new, not `kiosks` or `collaborators` unless the CTO decides to reuse one). Orders get a kitchen reference; Kitchen A is the only active row; staff are scoped to kitchens.
- **Cashier confirmation** records who confirmed and when; the kitchen sees only orders confirmed for its kitchen.
- **Verification:** per-kitchen isolation tests; a cashier of kitchen A cannot see or confirm kitchen B orders.

### Stage 5 — Read isolation and functional repairs
- Drivers see only **ready, unassigned orders of their kitchen** via a function or view. Claiming goes through a function using row locks (one active delivery per driver). (F2)
- Cash collection is recorded through a function with the server-computed amount. Admin audit log writes are server-side. (F3)
- Add `orders` to Realtime only after read policies are correct, since Realtime enforces RLS. (F4)
- Admin read policies for `drivers` and `user_profiles` based on the Stage 4 role source. (F5)
- Storage: uploads to `meal-images` admin-only, with MIME and size limits. (M3)
- Policies target `authenticated` instead of `public`. (M4)
- Tighten default privileges (M2), drop the duplicate FK, fix push-token policies.

### Stage 6 — Monitoring
- Periodic re-run of the catalog query, with the diff reviewed in PRs.
- Supabase security advisor/linter in CI if available.

## 7. Proposed tests and rollback considerations

**Authorization test suite**, extending `supabase/evidence/phase1b_policy_replica_test.sql` into automated tests run on a local Supabase:
- **Roles exercised:** anon, customer A, customer B, pending driver, approved driver, cashier (kitchen A), kitchen staff (kitchen A), staff of another kitchen, admin, service role.
- **Every current replica test must be inverted after Stage 1/2:** T1, T2, T3, T5, T6, T7 and T10 must fail. T4 stays blocked. T8 and T9 must pass under the new model.
- **New tests:**
  - idempotent order creation;
  - rollback on partial failure;
  - COD-only for new orders while historical `card` orders remain readable and updatable;
  - every forbidden status transition per role;
  - cancellation boundary;
  - concurrent driver claims (two sessions; exactly one wins);
  - kitchen isolation;
  - Realtime delivers only the subscriber's own order changes;
  - storage upload denied for non-admins.
- **Kiosk regression:** a smoke test agreed with the kiosk owner before each stage (U2).

**Rollback:**
- Back up (or record a point-in-time-recovery marker) before each production change.
- One migration per stage, each with a tested down script.
- Policy changes are reversible by recreating the original definitions captured in the evidence JSON.
- No data rewrites. No destructive DDL on shared tables without confirmation from the kiosk owner.
- Stage 2 needs a coordinated app release: keep the old insert policy until the new app version is adopted, then revoke it (or force an app update).

**Action for the project owner:** commit the raw evidence export as `supabase/evidence/phase1b_catalog_2026-10-15.json` (schema only; it contains no table data and no secrets were found in function bodies), and answer U1–U10.

## 8. Files and resources
- **Changed:** `docs/v1/PHASE1B_DATABASE_SECURITY_AUDIT.md` (this file).
- **Added:** `supabase/evidence/phase1b_policy_replica_test.sql` (local-only reproduction script).
- **Earlier on this branch:** `supabase/evidence/phase1b_catalog_query.sql`.
- **No database or production resource was modified.** The only database work was:
  - the owner running the read-only catalog query and one aggregate query;
  - a disposable local PostgreSQL replica created and deleted in this environment.
- Nothing was sent to the Supabase project from here.
