# L'OPTION V1 — Integration (1A + 1C rev 7 + V2/SDK 58), account creation, nutrition onboarding and first-order offer

Status: **local work for review. Not pushed, not deployed, not merged.** No hosted Supabase project was contacted. Phase 1C revision 7 remains **NOT READY FOR STAGING**; combining its code here does not change that or complete its review. **Checkout stays disabled** (Phase 1C removes client order writes; no trusted order-creation function exists yet).

## 1. Integration record

### Verified ancestry (`git merge-base`)
All three tips branch directly from `0cb0fe0` (Initial commit); none contains another.

| Lineage | Tip | Commits after `0cb0fe0` |
|---|---|---|
| Phase 1A/1B | `0bedf0aa039f42b1b841989be13ffc4ef47f341a` | 9 (Phase 0 docs `9628fe3`, `545a835`; 1A `2ba849b`, `24255c5`, `a439e62`; 1B `b395dca`, `79de462`, `72da99c`, `0bedf0a`) |
| Phase 1C revision 7 | `46d2c3f78c93dca2db618b24f403ad6e5f22e80a` | 21 (`a0d9444` … `46d2c3f`) |
| Redesign V2 + Expo SDK 58 | `1fba92f6991fa6c947bc2c644bf8c4b1e1a80d7d` | 2 (`9e23bef`, `1fba92f`) |

### Sequence (no rebase, no change to any existing branch)
| Step | Commit | Branch |
|---|---|---|
| Base: Phase 1A/1B tip | `0bedf0a` | `claude/v1-integration` |
| Merge Phase 1C rev 7 (`--no-ff`) | `4e465f7` (message names the branch's first local name, `claude/v1-onboarding-auth`) | `claude/v1-integration` |
| Merge V2 / SDK 58 (`--no-ff`) | `68dc65b` | `claude/v1-integration` |
| Database migration, rollback, tests | `99e820b` | `claude/v1-onboarding-auth` (from `68dc65b`) |
| App: auth, onboarding, setup, offer UI, tests, docs | next commit on `claude/v1-onboarding-auth` | |

### Conflicts and resolutions
File overlap per lineage pair: 1A∩1C = `.gitignore`, `supabase/evidence/phase1b_catalog_query.sql` (identical); 1C∩V2 = none; 1A∩V2 = the files below.

| File | Resolution |
|---|---|
| `.gitignore` | Union of both rule sets (auto-merged; verified). |
| `app/(app)/_layout.tsx` | V2 `PillTabBar` tabs wrapped in the Phase 1A `RouteGate`. |
| `app/(app)/profile.tsx` | V2 layout and copy. V2's admin card + `AdminAuthModal` dropped: Phase 1A deleted that modal because its security phrase was never checked. Phase 1A sign-out error handling kept. |
| `app/(admin|driver|collaborator)/_layout.tsx` | Auto-merged; verified each keeps its `RouteGate` and V2's `color as string` typing. |
| `package.json` / `package-lock.json` | V2's SDK 58 lockfile as the base; Phase 1A tooling re-installed with `expo install` at SDK 58 versions (`jest-expo` 58.0.13 → Jest 30, `eslint-config-expo` 58.0.4, `@testing-library/react-native` 14.1.0); `expo install --fix` patch alignment (expo-router 58.0.28, expo-notifications 58.1.7, …); `@types/node`, `globals` pinned. |
| Jest config | SDK 57 `expo-modules-core` `moduleNameMapper` removed (module is hoisted in SDK 58); `expo-font` mocked so vector icons render under jest-expo 58. |
| ESLint | Jest globals declared for test files (flat config ignores `eslint-env`). |

### Dependency findings
- **supabase-js 2.39.8 → 2.118.0.** V2's SDK 58 lockfile resolved `^2.39.8` to 2.118.0. Phase 1A verified behaviour on 2.39.8. Re-checked on 2.118.0: `startAutoRefresh`/`stopAutoRefresh`, `exchangeCodeForSession`, `signInWithIdToken` (nonce), `resend` exist. **Behaviour change found:** when the sign-out revoke request fails, 2.118 removes the local session and emits `SIGNED_OUT` (2.39 kept it). `authStore.signOut` now reports a failure only if a session is still stored; tests cover both behaviours. Range pinned to `^2.118.0`.
- New SDK 58 modules: `expo-apple-authentication` 58.0.2, `expo-web-browser` 58.0.7, `expo-crypto` 58.0.7. `app.json`: `ios.usesAppleSignIn: true`, plugins `expo-web-browser`, `expo-apple-authentication`.
- V2 removed `jsEngine: jsc` (Hermes now), `newArchEnabled`, and Metro's `unstable_enablePackageExports = false`. Android/iOS/web exports succeed; the bundle contains the URL polyfill, `detectSessionInUrl` setting and no admin-phrase code.
- Still missing (pre-existing): `assets/notification.wav` referenced in `app.json` → native prebuild/EAS build will fail until the file is added. Not invented.

## 2. Architecture found before the change
- Auth: e-mail/password only (Phase 1A lifecycle store, route gates). Sign-up inserted the profile from the client (fails under RLS when confirmation is on). No OAuth code or packages.
- Profile: `user_profiles` (staging evidence) with `gender`, `age`, `weight`, `height`, `activity_level`, `goal`, `program`; unique `user_id`; Phase 1C limits client UPDATE to 10 columns and guards `role`/`is_admin`/`user_id`.
- Nutrition: Mifflin–St Jeor already in `userStore` (same five multipliers), client-only, no validation; null sex fell through to the female equation.
- Onboarding completion: inferred from `weight && height && age`.
- Promotions: none anywhere. Checkout: client-side prices, hard-coded 15 MAD delivery, direct insert (blocked by Phase 1C).

## 3. What was built

### Authentication (`src/services/authFlows.ts`, `src/services/authProviders.ts`, `app/(auth)/*`, `app/auth-callback.tsx`)
- **Welcome screen**: Continue with Apple, Continue with Google, Sign up with e-mail, Log in.
- **Provider availability** from Supabase's public `GET /auth/v1/settings` (anon key). Disabled providers show "Pas encore configuré" and explain on press; unknown (offline) → the flow is attempted and "provider is not enabled" is mapped to the same message. Nothing crashes; e-mail keeps working.
- **Google**: Supabase-hosted OAuth with **PKCE** (`flowType: 'pkce'`) in the system browser (`openAuthSessionAsync`); the code is exchanged once (deduplicated for Android's double delivery). No Google credential in the app. Cancel → no message.
- **Apple**: native on iOS (`expo-apple-authentication`, SHA-256 nonce to Apple, raw nonce to `signInWithIdToken`); hosted OAuth elsewhere. Cancel handled; "Unacceptable audience" → not configured; private-relay e-mails work like any address; the name Apple shares once is stored only if no profile exists yet.
- **E-mail**: sign-up sends only e-mail + password + `emailRedirectTo` (no profile/role from the client). Outcomes: verification sent / account exists (Supabase returns no identities) / delivery not configured (`email_address_not_authorized`, SMTP error → "Aucun e-mail n'a été envoyé") / rate limited / weak password. **Verification screen** with resend (60 s cooldown), "J'ai confirmé mon adresse" (refreshes the session) and "Utiliser un autre compte". Expired link → "Lien expiré" + resend; link opened on another device → "connectez-vous avec votre mot de passe".
- **Routing policy** (`src/navigation/routeDecision.ts`): an unverified e-mail account (any role) can only see `/(auth)/verify-email`; OAuth identities are provider-verified. Signed-out users go to `/(auth)/welcome`. The callback route is always reachable.
- **Profile creation**: on the first signed-in profile load, `upsert({ user_id }, { onConflict: 'user_id', ignoreDuplicates: true })` → one customer profile per account; the database guard decides role/admin.

### Nutrition onboarding (`app/onboarding.tsx`, `src/nutrition/energy.ts`)
Five V2 steps with progress, Back/Continue and preserved answers: sex input (Femme / Homme / Je préfère ne pas répondre, with the explanation), age (13–100, whole years), weight (30–300 kg, decimal comma accepted), height (100–250 cm), activity (5 described cards). Inline validation messages, keyboard-safe layout, retryable save errors. Goal and Program steps are no longer asked (columns and data kept).
- Answers are saved; the **database computes** BMR/TDEE (trigger) and the app shows the server values on a result screen labelled as an estimate, not medical advice. "Unspecified" → no estimate shown or stored.
- "Continuer" sets `onboarding_completed_at`; the server stamps the time and refuses completion while an answer is missing.
- Returning users with `onboarding_completed_at` (or, on the legacy schema, weight/height/age) skip onboarding.

### Permissions (`app/setup.tsx`, `src/services/permissions.ts`, `src/stores/setupStore.ts`)
Shown once per account **per device** after onboarding (OS permissions are per device):
- Notifications: benefits first, OS prompt only on tap; granted → push token registered; denied → retry; blocked → Settings instructions + "Ouvrir les réglages"; always "continue without". Already granted → step skipped. Push tokens are no longer requested at login (the old login code could trigger the OS prompt without explanation); the root layout registers a token only when permission is already granted.
- Location: explanation first; granted → current position + reverse-geocoded **suggestion that must be confirmed**; denied/blocked/error → manual address; "Plus tard" never blocks. A confirmed address is saved to the profile (validated server-side) and pre-fills checkout. A granted permission alone never counts as an address. No delivery-zone check exists (zone data not defined).

### First-order free delivery (`supabase/migrations/20261028120000_…sql`, `FirstOrderOfferBanner`)
- Home shows "Livraison offerte sur votre première commande !" when the server-maintained `user_profiles.first_order_offer_status` is `eligible` (display only), and a confirmation once `applied`.
- **Enforcement** lives in `public.apply_first_order_offer(order_id)` (not callable by clients): called by the future trusted order-creation function inside the order's transaction; sets delivery fee to 0, records `delivery_discount`/`delivery_fee_before_discount`, inserts the redemption.
- **When the offer counts as used:** when an order carrying it is **committed**. A failed or abandoned checkout rolls back and consumes nothing. It is **released** (account eligible again) only if that order reaches a status in `promotions.release_on_order_statuses` (default `cancelled`, `rejected` — these statuses do not exist in the current `orders` CHECK constraint; Phase 2 state machine). Deleting the order keeps the redemption (never re-grants).
- **Concurrency/retries:** per-account advisory lock + partial unique index (one `applied` per account) + idempotent per order. Tested with 3 parallel checkouts under READ COMMITTED (1 discount) and REPEATABLE READ (losers get SQLSTATE 40001, retry, still 1 discount).
- **Eligibility:** promotion active and within its window; no applied redemption; no other order outside the release statuses (legacy customers with orders are not eligible).
- **Not invented:** minimum order (NULL), start/end dates (NULL), exclusions, stacking. All are configuration on the `promotions` row; the minimum is enforced if set.

### Database migration (`20261028120000_v1_onboarding_first_order_offer.sql`)
Adds to `user_profiles`: `bmr_kcal`, `tdee_kcal`, `nutrition_formula`, `nutrition_calculated_at`, `onboarding_completed_at`, `delivery_address`, `delivery_latitude`, `delivery_longitude`, `delivery_address_updated_at`, `first_order_offer_status`; to `orders`: `delivery_fee_before_discount`, `delivery_discount`; tables `promotions`, `promotion_redemptions`; functions `estimate_energy` (pure), trigger functions, `first_order_offer_status_for`, `first_order_offer_refresh`, `apply_first_order_offer`.
- Clients may update only `onboarding_completed_at` and the three address columns (plus Phase 1C's 10 columns); derived columns are trigger-set for every writer.
- **Phase 1C containment unchanged:** no new RLS policy, view, client-executable SECURITY DEFINER function or client table privilege; the migration's postcondition requires `containment_violations()` = 0 drift/containment rows. Runs as `postgres` only, one transaction with a deferred commit gate, refuses without Phase 1C or on re-run.
- Backfill: profiles the app already treated as onboarded (weight, height, age set) are marked complete; estimates computed; offer status computed.
- Privacy: age (not date of birth) as the existing column; exact coordinates stored only with an address the customer confirmed.

## 4. Tests and results (this branch)
See the final report in the session for the exact command output. Summary of suites:
- Jest: 13 suites (6 existing + 7 new): routing (verification gate, setup step, returning users), auth session (sign-out on supabase-js 2.39 and 2.118 behaviour, external sessions), auth flows (Google/Apple/e-mail outcomes incl. cancel, not configured, delivery not configured, account exists, expired link, other device, double redirect), provider settings, energy calculation (parity with the SQL tests), profile store (single profile creation, no reload loop, payloads), onboarding screen, setup screen (denials, blocked, manual address, suggestion confirmation), welcome screen without credentials, offer banner, existing checkout COD tests.
- `supabase/tests/run_v1_onboarding_offer.sh` (local Docker, Supabase Postgres 17.6.1.178): refusals, 29 SQL tests, Phase 1C SQL tests after the migration, containment = 0, concurrency, re-run, rollback/re-apply.
- `supabase/tests/run_phase1c.sh` on the integrated tree.
- `tsc`, ESLint, `expo install --check`, `expo export` (android, ios, web); web build rendered in Chromium at 390 px and 320 px.

**Not verified (mocked or not possible here):** real Google/Apple sign-in, real e-mail delivery, real iOS/Android permission dialogs, native builds (EAS/prebuild; blocked by the missing `notification.wav`), anything against a hosted Supabase project, the Supabase CLI `db push` cases of the Phase 1C suite (CLI not installed).

## 5. Rollback guidance
- App: revert the feature commit; the integration commits are independent.
- Database (only if the migration was ever applied, with an approved task and a backup): `psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/v1_onboarding_offer_rollback.sql` as `postgres`. It archives profile columns, promotions, redemptions and order discount columns into the private schema `v1_onboarding_rollback_archive`, drops every object, removes the migration-history row, and requires `containment_violations()` = 0 before COMMIT. Order amounts are not changed. It must run **before** any Phase 1C rollback (that procedure refuses while a later migration is recorded).

## 6. Pre-existing issues found
- **Fixed:** endless profile reload on the home screen (home calls `loadProfile` on mount; the Phase 1A gate unmounted it while `loading`). Reproduced on `68dc65b`: 368 profile reads in 5 s; after the fix: 3. Covered by a unit test.
- Lint baseline: 47 errors, all in files this work did not write (was 52 after the integration; the rewritten login/sign-up/onboarding removed 5).
- Home "énergie du jour" consumption (40 %) and macro progress are V2 placeholders, not tracked data.
- The EN/FR switch (kept on the welcome screen) changes only screens that use i18n keys (staff screens); V2 customer screens are French-only.
- `src/types/onboarding.ts` is no longer used.

## 7. Decisions still open
1. Promotion rules: minimum order, validity window, exclusions, stacking with future promotions; which order statuses release the offer (and whether a failed delivery / absent customer releases it).
2. Delivery fee and trusted order creation (Phase 2): the offer is enforced only once `create_order` calls `apply_first_order_offer`.
3. Account linking across providers (Apple relay addresses), and whether support merges accounts.
4. Minimum age for an account / for showing an estimate (inputs accepted 13–100; the equation was derived for adults).
5. Delivery zone definition (to validate addresses / coordinates).
6. Whether to keep collecting `goal` (it adjusts the daily target on home) — not asked during onboarding now.
7. Customer-facing language strategy (FR only vs. FR/EN/AR via i18n).
