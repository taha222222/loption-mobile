# Test inventory (repository state 2026-11-08)

## Jest (`__tests__/`, `npm run check` / `npx jest`) — mocked Supabase
Checkout and orders: `cartStore`, `cartScreen`, `checkoutScreen` (closed checkout), `checkoutCreateOrder` (open flow:
steps, promo, phone, totals, retries), `customization`, `mealScreen`, `menuApi`, `pricingDisplay`, `orderPayload`,
`orderWorkflow` (mirror equals migration), `cashierOrders`, `cashierScreens`, `deliveryCities`, `quoteDelivery` and `phoneOtp` (Edge Function cores),
`dispatchNotifications`.
Accounts and navigation: `authFlows`, `authProviders`, `authSession`, `welcomeScreen`, `onboardingScreen`,
`setupScreen`, `routeDecision`, `userProfile`, `accountDeletion`, `env`.
Nutrition and activity: `energy`, `calorieWorkedExample`, `nutritionTracking`, `nutritionScreens`, `dailyTracking`,
`activityProviders`, `stepCounter`, `gpsEngine`, `backgroundGps`, `workouts`, `trackingHardening`.

## SQL / RLS harnesses (`supabase/tests/`, Docker `supabase/postgres:17.6.1.178`)
| Harness | Covers |
|---|---|
| `run_phase1c.sh` (+ `phase1c_security_tests.sql`, `mutation_tests.sh`, `storage_api_tests.sh`) | Phase 1C containment, roles, storage |
| `run_v1_onboarding_offer.sh` | onboarding, first-order offer |
| `run_v1_nutrition.sh`, `run_v1_activity.sh`, `run_v1_standalone.sh` | nutrition, activity, standalone tracking |
| `run_v1_account_deletion.sh` | account deletion |
| `run_v1_order_workflow.sh` | state machine, roles, races, payment, location (66 tests) |
| `run_v1_create_order.sh` | trusted order creation (25) |
| `run_v1_delivery_zones.sh` | zones (10) |
| `run_v1_pricing_engine.sh` | delivery formula, TVA, quotes, snapshot (40) |
| `run_v1_checkout_experience.sh` | choices, promo, phone OTP, first-order fees, preview, create_order v2 (40) |
| `run_v1_cashier_orders.sh` | cashier queue and detail with the app's own column lists, per role and kitchen, customer isolation, confirm (payment stays pending), duplicates, cancel with/without reason, bypass, revoked cashier, races (19 + 4) |
| `run_v1_order_lifecycle.sh` | confirmed lifecycle end to end: 64 status × action combinations, cancellation, scope per role, direct-write/delete/timeline bypass, payment independence, first-order rule pinned, races (21) |

Each V1 harness: generated-block check, refusals, migration + monitor md5, SQL tests, concurrency, regressions,
rollback, re-apply. Note: the create_order, zones and pricing SQL suites call earlier `create_order` signatures and run
only on their own migration chain; later harnesses re-cover their cases.

## End-to-end
`supabase/tests/e2e/run_app_e2e.sh` — web export of the app against local GoTrue/PostgREST, Playwright Chromium,
SMTP sink; full migration chain; ~100 checks (sign-up, onboarding, nutrition, tracking, workouts, cart, cashier queue:
confirm and cancel with reason).
Checkout cannot be exercised end to end while `CHECKOUT_OPEN = false`.

## Hosted (read-only, owner approval) and device
`supabase/tests/postdeploy_verify_*_readonly.sql`, `preflight_staging_readonly.sql`, `rollout_fingerprint_readonly.sql`;
device procedures `docs/v1/DEVICE_TEST_PROCEDURES.md`. Latest evidence: `docs/v1/REMAINING_SETUP_AND_RELEASE_TASKS.md` E-27 … E-37.
