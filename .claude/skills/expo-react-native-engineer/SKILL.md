---
name: expo-react-native-engineer
description: L'OPTION Expo / React Native app engineering — Expo SDK 58, Expo Router typed routes, zustand stores, V2 design system, Supabase client integration (anon key only), loading/error/offline states, accessibility, performance, native modules, EAS builds and device testing for the customer, driver, admin (and future kitchen/cashier) interfaces. Use for any screen, navigation, store, client service or build task.
---

# Expo / React Native engineer

## Use when
Screens, navigation, stores, client services, design system, permissions, native modules, builds.

## Not for
Business rules (`loption-business-logic`); SQL/RLS (`supabase-backend-architect`).

## Stack and map
Expo SDK 58, React Native 0.88, React 19.3, Expo Router 58 (typed routes), TypeScript 6, zustand 5, Supabase JS.
App map (routes, stores, services, components): [`references/app-map.md`](references/app-map.md).

## Rules
- Supabase anon key only (`src/config/env.ts` rejects service keys); server work through RPCs/Edge Functions.
- The app never computes a charged amount, eligibility or role: it displays server values (`checkout_preview`,
  `orders.total`) and sends ids, quantities, choices and the total shown. Checkout stays closed
  (`src/checkout/checkoutAvailability.ts`) until the owner approves opening it.
- Routing policy in `src/navigation/routeDecision.ts` (pure, tested); screens use the route gates. Do not use
  `href: null` for hidden tab screens; declare them in `app/(app)/_layout.tsx`. Focus screens hide the tab bar via
  `createPillTabBar(tabs, hiddenOn)`.
- After adding routes, regenerate typed routes (start the dev server briefly) and run `tsc`.
- V2 components (`src/components/v2`) and `src/theme` tokens; amounts with `formatMad` (`src/menu/customization.ts`);
  French customer copy; no placeholder numbers shown as real data (empty state instead).
- Logic in `src/` (pure, testable), small screens in `app/`. No module-level side effects in services.
- Older server without a migration: degrade gracefully (`src/lib/serverFeatures.ts`), never a false error.
- Native packages with `npx expo install`; do not upgrade the SDK unasked; `react-refresh` stays a devDependency;
  `.npmrc` keeps `legacy-peer-deps=false`.
- Lint rule `react-hooks/set-state-in-effect`: set state after an awaited call or in a `.then` callback.
- Accessibility: labels on icon buttons, 44 pt targets, live regions for errors, readable contrast.

## Workflow
1. Read the rule/contract from the business or operations skill.
2. Pure logic + tests first in `src/`; then the screen; then the service call with typed results and French messages.
3. `npm run check`; e2e when a user flow changes (`supabase/tests/e2e/run_app_e2e.sh`, adapt `journey.js`).
4. Device behaviour (permissions, background, notifications) only via `docs/v1/DEVICE_TEST_PROCEDURES.md` on EAS builds.

## Required tests
RNTL screen tests (await `render`/`fireEvent`; mock Supabase, `expo-router`, safe-area when needed): states (loading,
empty, error, success), allowed actions per role/status, refusal messages, retries; unit tests for pure logic.

## Completion report
Screens/components changed, states covered, tests with counts, tsc/lint result, e2e result, device testing status.
The blue gear button seen on devices is Expo's development Tools button (Expo Go / dev builds), not app code.
