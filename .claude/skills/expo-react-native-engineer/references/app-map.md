# App map (repository state 2026-11-08)

## Route groups (`app/`)
| Group | Who | Main screens |
|---|---|---|
| `(auth)` | signed out | `welcome`, `login`, `signup`, `verify-email` |
| root | onboarding | `onboarding.tsx`, `setup.tsx` (notifications, delivery address), `auth-callback.tsx` |
| `(app)` | customer | tabs `index`, `menu`, `tracking`, `orders`, `profile`; `meal/[id]` (product page), `cart`, `checkout`, `delivery-address`, `order-tracking/[id]`, nutrition (`nutrition`, `log-meal`, `nutrition-profile`, `nutrition-reminders`), activity (`workout`, `workout-history`, `activity-connect`), `delete-account`; out of scope / mocked: `my-plan`, `upgrade`, `reorder` (hard-coded last order) |
| `(driver)` | driver | `index`, `delivery/[id]` (unique path: `/orders/[id]` clashed with the partner group on web), `history`, `earnings`, `profile` |
| `(admin)` | admin (acts as cashier) | `index`, `orders`, `drivers`, `meals`, `earnings`, `collaborators` |
| `(collaborator)` | retired partner model (rows kept) | `index`, `orders`, `earnings`, `profile` |
| `cashier` | cashier (`staff_roles`), admin | `index` (queue: à confirmer / en cours / terminées), `[id]` (order, confirm, cancel with reason) |
| `kitchen` | kitchen staff (`staff_roles`) | `index` (board: à préparer / en préparation / prêtes; preparing, ready) |

Layout: `app/(app)/_layout.tsx` (pill tab bar from `src/navigation/customerTabs.ts`; hidden on `meal/[id]`, `cart`,
`checkout`, `delivery-address`). Route gates: `src/navigation/routeDecision.ts`, `useRouteDecision.ts`,
`src/components/navigation/RouteGate`.

## State (`src/stores/`)
`authStore` (session, role from `staff_roles`/profile), `userStore` (profile, address, verified phone fields),
`cartStore` (persisted, one line per meal + choices, owner-scoped), `checkoutDraftStore` (in-memory step + promo),
`nutritionStore`, `activityStore`, `trackingStore`, `workoutStore`, `setupStore`, `onboardingDraft`, `adminStore`,
`driverEarningsStore`, `collaboratorStore`, `subscriptionStore`; `sessionReset.ts` clears all on sign-out.

## Services (`src/services/`)
`checkoutApi` (create_order, checkout_preview, quote, pricing), `cashierApi` (cashier reads), `kitchenApi` (kitchen board reads), `orderRealtime` (shared Realtime), `menuApi` (meal, choices, popularity), `phoneApi`
(WhatsApp code), `orderWorkflowApi` (workflow functions), `accountApi`, `authFlows`, `authProviders`, `nutritionApi`,
`activityApi`, `workoutApi`, `locationService`, `notificationService`, `permissions`.

## Pure logic
`src/checkout/` (availability, summary, order payload), `src/cashier/` (cashier actions and wording), `src/kitchen/` (kitchen steps, board order, wording), `src/orders/` (workflow mirror, amounts), `src/menu/customization.ts`,
`src/delivery/cities.ts`, `src/phone/moroccanPhone.ts`, `src/nutrition/`, `src/activity/`.

## Components
`src/components/v2` (design system), `src/components/checkout` (`DeliveryAddressForm`, `OrderPieces`), `ui`, `maps`,
`tracking`, `workout`, `auth`, `navigation`. Native module: `modules/loption-motion` (steps).
