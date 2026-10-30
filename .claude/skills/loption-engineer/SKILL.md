---
name: loption-engineer
description: L'OPTION engineering rules for Expo/React Native screens, Supabase schema/RLS/migrations, auth and roles, pricing and checkout, nutrition calculations, calorie tracking, push notifications, and testing. Use for any feature, bug fix, migration, security or release task in this repository; skip for pure copy edits.
---

# L'OPTION engineering practices

Start from `docs/v1/PROJECT_STATE.md` (state, blockers, next task) and `docs/v1/DECISIONS.md` (what is approved).
Detailed references, read only the one the task needs:
- Auth, onboarding, first-order offer: `docs/v1/V1_ONBOARDING_AUTH_OFFER.md`, `docs/v1/AUTH_PROVIDER_SETUP.md`
- Calorie tracking, streaks, reminders: `docs/v1/CALORIE_TRACKING_AND_ENGAGEMENT.md`
- Database security (Phase 1C): `docs/v1/PHASE1C_DATABASE_SECURITY_PLAN.md`, `docs/v1/PHASE1C_POLICY_GRANT_MATRIX.md`
- Release checklist and evidence log: `docs/v1/REMAINING_SETUP_AND_RELEASE_TASKS.md`

## Expo and React Native
- Expo SDK 58, RN 0.88, Expo Router 58 with typed routes: `tsc` catches dead links, so run it after route changes.
- Do not use `href: null` to hide a tab screen; in Router 58 it creates a redirecting, unreachable route.
  Declare the screen without a tab button instead (see `app/(app)/_layout.tsx`, `backBehavior="history"`).
- Add native packages with `npx expo install`, never a bare `npm install <pkg>@latest`. Do not upgrade the SDK unasked.
- `react-refresh` must stay a devDependency and `.npmrc` must keep `legacy-peer-deps=false` (dev-server Babel needs it).
- Routing policy lives in `src/navigation/routeDecision.ts` (pure, unit-tested); screens use the route gates.
- Use V2 components (`src/components/v2`) and `src/theme` tokens; no hard-coded colours or spacing.
- No module-level side effects in services (e.g. notification handlers are set in `setupNotificationListeners`).
- Never show placeholder or mock numbers as real data; show an empty state instead.

## Supabase, RLS and migrations
- The client uses only the anon key (`src/config/env.ts` rejects service-role keys). Server work uses RPCs,
  triggers or the Edge Function, never a service key in the app.
- Every table customers touch has RLS with owner-only policies; grant only the columns a client may write.
- SECURITY DEFINER functions: fixed `search_path`, EXECUTE revoked from `public`/`anon`, granted narrowly.
- The Phase 1C monitor `containment_violations()` must return 0 rows. A new client policy or client-callable
  definer function must be added to the monitor by generator (see `supabase/tools/generate_nutrition_monitor.py`)
  and reviewed; never edit the monitor by hand or disable it.
- Migration pattern (copy from `supabase/migrations/20261029120000_*`): role `postgres` check, one transaction,
  deferred commit gate, precondition, postcondition, refusal on re-run, archiving rollback in `supabase/rollback/`.
- Rollback order: newest migration first (nutrition → onboarding/offer → Phase 1C).
- Never run migrations against hosted Supabase. Local verification only, in the Docker harnesses.

## Authentication and authorization
- Providers: Google (Supabase-hosted OAuth, PKCE), Apple (native `signInWithIdToken` with nonce on iOS), e-mail
  with verification. Unconfigured providers show "Pas encore configuré" (read from `/auth/v1/settings`).
- Unverified e-mail accounts may only reach `/(auth)/verify-email`. Never claim an e-mail was sent if it failed.
- Staff authority comes only from the `staff_roles` table (`admin`, `support`, `cashier`, `kitchen_staff`, `driver`);
  never from JWT claims, `user_profiles` or client state.
- Sign-out deactivates the device push token (`deactivate_push_token`) and clears drafts.

## Pricing, checkout and orders
- Cash on delivery only (`src/checkout/orderPayload.ts`). No paid/payment-status field from the client.
- Pricing, delivery fee, service fee, TVA and minimum order are NOT approved. Legacy values conflict (15/10/19 MAD);
  do not reuse or invent any. Trusted order creation (checklist H4–H7) does not exist; checkout stays disabled.
- The first-order offer is applied only by `apply_first_order_offer(order_id)` (service_role, idempotent, once per
  account). Nothing calls it until trusted order creation exists.

## Nutrition calculations
- BMR: Mifflin–St Jeor; TDEE = BMR × activity multiplier. Computed by the database trigger; `src/nutrition/energy.ts`
  is a preview only. No estimate when sex is "prefer not to say" or an input is missing.
- Daily target = TDEE (`tdee_baseline_v1`). No deficit/surplus or macro targets until a policy is approved.
- Calories for a logged meal are copied from `meals` by trigger; clients send meal, servings, date, time zone and an
  idempotency key only. Past days keep their target snapshot. "No meal logged" is never drawn as 0.
- Present all figures as estimates, not medical advice.

## Notifications and tracking
- Reminders are opt-in and off by default; local time zone, quiet hours, ≤ 2 per day, 120-min send window.
- Planning is server-side and idempotent (dedupe keys); only whitelisted deep links (`src/navigation/notificationLinks.ts`).
- The dispatcher is protected by `x-cron-secret`; handle Expo tickets/receipts and deactivate `DeviceNotRegistered`.
- Never claim push delivery works without a real device test. Do not deploy the Edge Function or create cron jobs.

## Testing and debugging workflow
1. Reproduce first (a failing test, or a real dev-server/bundle request), then fix the cause, not the symptom.
2. `npm run check` before every commit. Lint errors in files you did not touch are known; do not add new ones.
3. DB changes: run the matching `supabase/tests/run_*.sh` plus `run_phase1c.sh` as regression. They need Docker
   (`dockerd` may need starting manually in cloud sessions). Run Phase 1C tests on a fresh database.
4. User-flow changes: `supabase/tests/e2e/run_app_e2e.sh` (web build, real local GoTrue/PostgREST, Playwright).
5. RNTL 14 `render`/`fireEvent` are async: `await` them. Mock `expo-font` and Supabase in Jest.
6. In shell scripts, avoid `pkill -f`/`pgrep -f` patterns that match your own command line.
7. Record verified results in the checklist evidence log; "local" is never "verified in production".
