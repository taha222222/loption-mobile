# L'OPTION V1 — Phase 1A Report: Client-Side Hardening

Branch: `claude/phase-1a-client-hardening` (branched from `claude/peaceful-shannon-ewahm3` @ `545a835`, which holds the Phase 0 audit). **Not merged.** Awaiting CTO review.

Phase 1A changes the client only. No migrations were written, applied or deployed; no Supabase project was touched; no RLS, columns, kitchen schema or pricing were invented. Card payments were not touched (still a UI option that creates an unpaid order — Phase 2/3).

## 1. Files changed

| File | Change | Why |
|---|---|---|
| `src/services/notificationService.ts` | `shouldShowAlert` → `shouldShowBanner` + `shouldShowList` | Fixes the only `tsc` error; `NotificationBehavior` in installed expo-notifications 57 requires both and deprecates `shouldShowAlert`. |
| `src/config/env.ts` (new) | `readSupabaseConfig()` validates `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Fails fast with a clear message on missing/invalid values; requires https (http only for localhost); **refuses a service-role or `sb_secret_` key** if someone puts one in the client env. |
| `src/lib/supabase.ts` | URL polyfill import, env validation, `detectSessionInUrl: false`, `AppState`-driven `startAutoRefresh`/`stopAutoRefresh` (native only) | Supabase React Native setup, verified against installed supabase-js 2.39.8 (`startAutoRefresh`/`stopAutoRefresh` exist in its GoTrueClient). |
| `src/stores/authStore.ts` | Rewritten lifecycle (public API kept: `session`, `user`, `role`, `isLoading`, `signIn`, `signUp`, `signOut`) | See §3. Single idempotent `initialize()` listener with cleanup; listener work deferred out of the auth lock; `roleStatus` (`idle/loading/resolved/error`); role lookup failure → `error` instead of silently `customer`; no role re-query on token refresh; stale results ignored; `signUp` always creates `role: 'customer', is_admin: false`; `signOut` returns `{ error }`. |
| `src/stores/sessionReset.ts` (new) | `resetUserScopedState()` | One place that clears cart, profile, subscription, partner, admin and driver-earnings stores, stops location tracking and removes all Realtime channels. |
| `src/stores/cartStore.ts` | `ownerId`, `claimForUser()`, `reset()`, persist `version: 1` + `migrate` | Persisted cart is bound to an account; another account (any role) signing in gets an empty cart. Legacy unowned carts are discarded once. |
| `src/stores/userStore.ts` | `loadedUserId`, `profileStatus`, `reset()`, stale-result guard | Lets the guard wait for the right user's profile; a profile query error no longer looks like "onboarding not done". |
| `src/stores/adminStore.ts` | Removed `verifyAdminAuth`, `isAdminAuthenticated`, `setAdminAuth` | The "security phrase" was never checked. |
| `src/components/admin/AdminAuthModal.tsx` | **Deleted** | Misleading pseudo-security; not replaced with any other client secret. |
| `app/(app)/profile.tsx` | Removed admin card + modal (+ unused styles/imports); sign-out error handling | Card was only shown to admins, who can no longer reach customer routes. |
| `src/navigation/routeDecision.ts` (new) | Pure `decideRoute()` policy | Single, unit-tested source of routing rules. |
| `src/navigation/useRouteDecision.ts` (new) | Hook feeding store state into `decideRoute` | Shared by root effect and gates. |
| `src/components/navigation/RouteGate.tsx` (new) | Gate + loading + "couldn't load your account" (retry / sign out) screens | Group content renders only when policy says `allow`. |
| `app/_layout.tsx` | New `useProtectedRoute` (redirect-only, no dropped re-checks); `initialize()` with cleanup | Replaces the `isChecking` ref guard and the leaked listener. |
| `app/index.tsx` | Loading screen instead of `<Redirect href="/(app)">` | `/` no longer mounts customer screens for every role. |
| `app/(app)\|(driver)\|(admin)\|(collaborator)/_layout.tsx` | Wrapped in `<RouteGate group=…>` | No screen (or its data fetch) mounts before the role is resolved and matches. |
| `app/onboarding.tsx` | Wrapped in gate; "Maybe later" reloads the profile before leaving | Without the reload the stale cached profile bounced users back into onboarding. |
| `app/(auth)/login.tsx` | After sign-in go to `/` (guard picks the home); save push token only when role resolved | Was hard-coded to `/(app)` for all roles and assumed `customer` on failure. |
| `app/(auth)/signup.tsx` | Call updated for new `signUp(email, password, userData)` | Role is no longer a client argument. |
| `app/(admin)/index.tsx`, `app/(driver)/profile.tsx`, `app/(collaborator)/profile.tsx` | Sign-out shows an error and stays put if it fails | supabase-js 2.39.8 keeps the stored session when the revoke request fails (verified in `GoTrueClient._signOut`), so showing the login screen would be a lie. |
| `app/(driver)/orders/[id].tsx`, `app/(collaborator)/orders/[id].tsx` | `useEffect` now returns the channel cleanup | Realtime channels leaked and duplicated on every visit. |
| `.env.example` (new) | Variable names + placeholders, with a warning that `EXPO_PUBLIC_*` is public | Documents required config. |
| `.gitignore` | Added `*.env`, `secrets/`, service-account/Firebase configs, keystores, `supabase/.temp`, dumps/backups/swap files, `coverage/` | Item 5. |
| `package.json` / `package-lock.json` | Scripts `typecheck`, `lint`, `test`, `check`; devDeps `jest`, `jest-expo`, `@types/jest`, `eslint`, `eslint-config-expo`; Jest config | Item 6. Versions chosen by `npx expo install` for SDK 57 (`@types/jest` pinned to 29 to match Jest 29). The lockfile diff is large because npm added peer dependencies of the new tooling. |
| `tsconfig.json` | `"types": ["jest"]` | TypeScript 6 no longer auto-includes `@types/*`; needed for test files. |
| `eslint.config.js`, `jest.setup.js` (new) | Expo flat ESLint config; AsyncStorage mock + placeholder env for tests | Item 6. |
| `__tests__/*.test.ts` (new, 4 files) | 27 tests | See §2. |

## 2. Commands run and actual results

| Command | Result |
|---|---|
| `npx expo install -- --save-dev jest-expo jest @types/jest eslint eslint-config-expo` | Installed; then `npm i -D @types/jest@^29.5.14` to match Jest 29 |
| `npm run typecheck` (`tsc --noEmit`) | **exit 0, 0 errors** (Phase 0 baseline: 1 error) |
| `npm test` (`jest`) | **exit 0 — 4 suites, 27 tests passed** |
| `npm run lint` (`expo lint`) | **exit 1 — 102 problems (49 errors, 53 warnings)** |
| Same ESLint config on the pre-change code (temporary worktree of `claude/peaceful-shannon-ewahm3`) | exit 1 — 105 problems (49 errors, 56 warnings) |
| `EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key npx expo export --platform android` | **exit 0**, 3.2 MB bundle; verified the URL is inlined, the URL polyfill is bundled, and no "security phrase" code remains |
| `git check-ignore` on `.env`, `.env.local`, `.env.production`, `foo.env`, `secrets/x`, `service-account-prod.json`, `google-services.json`, `a.bak`, `db.dump`, `notes.txt`, `x.keystore`, `coverage/y` | all ignored; `.env.example` not ignored |
| `git add -A && git status --short` | staged set contains no env/secret/backup files |

**Test coverage (27):** env validation (missing vars, bad URL, http only for localhost, service-role JWT and `sb_secret_` rejected); route policy (signed-out, role `idle/loading/error`, each staff role confined to its group, customers kept out of staff groups, profile wait/error, onboarding); auth/session (role resolved before reporting, profile query error → `error` not `customer`, admin from `is_admin`, sign-out clears cart/profile/partner store/channels/location tracking, failed sign-out keeps session, account switch empties cart, same user keeps cart across restart, driver login discards a customer's cart, single listener + cleanup, no role re-query on `TOKEN_REFRESHED`, remote `SIGNED_OUT` clears state, sign-up always writes `customer`/`is_admin: false`); legacy cart migration.

The tests caught one bug in my first draft (a cold start wiped the same user's persisted cart); it is fixed and covered.

## 3. Remaining errors, warnings and blockers

- **Lint is red (pre-existing).** 49 errors in both the pre-change code and this branch; Phase 1A introduces none (the one new error, an apostrophe in `RouteGate.tsx`, was fixed). Main categories: `react/no-unescaped-entities` (17), React Compiler checks "Cannot access variable before it is declared" (fetch functions used in `useEffect` before their `const` declaration — works at runtime but flagged), "Cannot create components during render" in `app/(admin)/index.tsx`; 53 warnings (unused vars, `exhaustive-deps`). Fixing them touches most screens; recommend a dedicated cleanup task rather than mixing it into security work. `npm run check` will therefore fail at the lint step.
- **Jest workaround:** `expo-modules-core` is nested under `node_modules/expo/` in the existing lockfile (it already was before this phase), so Jest maps it explicitly via `moduleNameMapper`. Metro is unaffected.
- **Not run:** native/EAS build (missing `assets/notification.wav` from Phase 0 still blocks prebuild), on-device manual QA of sign-in/restore/logout, and anything against a real Supabase project (no access, by design).
- **supabase-js stays at 2.39.8.** All APIs used were verified in the installed package. An upgrade to current 2.x is recommended but should be tested together with the Phase 1B backend work.

**Blocked on verified backend behavior (Phase 1B):**
1. Role is still resolved by client reads of `user_profiles` → `collaborators` → `drivers`. This is now UX routing only, and its error handling is safer, but **it is not authorization**. Whether a user can write `role`/`is_admin`, read other users' orders, or call admin writes depends on RLS that has not been verified.
2. `signUp` still inserts the profile from the client (now fixed to `customer`/`false`). Without a session (email confirmation on) that insert likely fails under RLS. The right fix is a server-side `handle_new_user` trigger once the schema is known.
3. On sign-out, the device's push token row is **not** deleted, and a driver's `drivers.status` stays `online`. Both require knowing the table constraints and policies; I did not guess.
4. `logAdminAction` in `adminStore` is still a client insert (forgeable). Admin actions need server-side RPCs with audit logging.

## 4. Security implications and behaviour intentionally left unchanged

**Improved:**
- Signing out (or switching accounts, including after a crash) can no longer expose the previous user's cart, profile, partner or admin data, or keep their Realtime channels and location tracking alive.
- A failed role lookup no longer drops an admin/driver/kitchen user into the customer app. A failed profile load no longer forces onboarding. Both show retry / sign out.
- Screens for a role mount only after the role is resolved and matches the route group. This also stops their data queries from firing early.
- The client no longer offers a way to request a privileged role at sign-up. The fake admin phrase is gone.
- The app refuses to start if someone configures a service-role key as the anon key.

**Not a security boundary:** everything above is client-side. A malicious client can still call the Supabase API directly. Real enforcement is RLS + RPCs (Phase 1B/2).

**Intentionally unchanged:**
- The role cascade order and the "no rows anywhere → customer" default (to preserve existing accounts).
- Checkout, pricing (hard-coded 15 MAD), order creation, `'card'` option, driver/partner flows, financial screens. These are Phase 2–3. COD orders are still not represented as paid or unpaid in any new way.
- The partner (`collaborator`) role and screens still exist for compatibility with existing data. No new partner features were added. Per the new direction, they should become kitchen/cashier staff roles in Phase 1B.
- Out-of-scope subscription screens and the `subscription/active` deep link (Phase 5 removal).
- The dev artefacts already tracked (`app/(driver)/extractor.py`, `app/(driver)/output.txt`, `assets/icon_BAK.png`). They contain no secrets; removal is left to the Phase 5 cleanup.

## 5. Decisions needed before Phase 1B

1. Staff roles for the kitchen model: confirm the role set (e.g. `customer`, `support`, `cashier`, `kitchen_staff`, `driver`, `admin`) and whether staff accounts are scoped to a kitchen (A/B/C).
2. What to do with existing `collaborators` rows and the partner screens (map to kitchen staff, or retire).
3. Approve a staging Supabase project and a schema-only dump (policies, triggers, functions) for Phase 1B.
4. Should sign-out set a driver `offline` server-side, and should push tokens be per-device rows deleted on logout? This depends on the schema.
5. Approve a separate lint-cleanup task (49 pre-existing errors).
