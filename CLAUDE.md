# L'OPTION — engineering instructions

Moroccan meal-delivery app with nutrition and activity tracking: company-owned kitchens (Kitchen A, Casablanca, at
launch), cash on delivery only. Customers order and track meals; cashier, kitchen staff and drivers move delivery
orders through one server-enforced lifecycle.

State and next task: `docs/v1/PROJECT_STATE.md`. Owner decisions: `docs/v1/DECISIONS.md`.
Business source of truth: `docs/v1/business/README.md`. Open items: `docs/v1/NOT_DONE_YET.md`.

## Load the right skill first
Before specialist work, load the matching skill(s) in `.claude/skills/` (several if the task crosses boundaries):
`loption-business-logic`, `supabase-backend-architect`, `loption-order-operations`, `loption-kitchen-operations`,
`loption-driver-operations`, `loption-cashier-finance`, `expo-react-native-engineer`, `loption-qa-testing`.
Unsure which? Load `loption-engineer` (router). No role skill may redefine a shared business rule.

## Stack and architecture
- Expo SDK 58, React Native 0.88, React 19.3, Expo Router 58 (typed routes), TypeScript 6, zustand 5. Screens in
  `app/` (groups `(app)` customer, `(driver)`, `(admin)`; no kitchen/cashier screens yet), logic in `src/`.
- Supabase: Postgres with RLS, Auth, PostgREST, Edge Functions (`supabase/functions/`). Business logic that decides
  money, eligibility or roles lives in SQL functions (`supabase/migrations/`); the app displays server values.
- Tests: Jest (`__tests__/`), SQL/RLS and e2e harnesses in Docker (`supabase/tests/`).

## Critical business rules (details in the skills / business docs)
- Prices, fees, discounts, TVA, first-order eligibility, totals and payment state are computed on the server.
- One delivery-order lifecycle for every interface; order confirmation is not payment.
- Checkout stays closed (`src/checkout/checkoutAvailability.ts`) until the owner approves the server order flow,
  pricing and taxes.
- Never invent product decisions or project status; record open questions in `docs/v1/DECISIONS.md`.

## Security
- No secrets in the app, in `EXPO_PUBLIC_*` or in git; anon key only in the client; leave credentials empty.
- Never weaken RLS, grant broad client permissions, or bypass the Phase 1C containment monitor
  (`containment_violations()` = 0; monitor changes only via `supabase/tools/generate_nutrition_monitor.py`).
- Staff authority only from `public.staff_roles`.

## Git
- Work on new `claude/*` branches; the ruleset rejects pushes to existing branches, so each push is a new branch.
- No force-push, history rewrite, merge into `main` or ruleset bypass. Preserve uncommitted work.

## Testing
- Every behaviour change gets a test. `npm ci`; `npm run check` (= tsc + expo lint + jest; lint has known errors in
  older files only — add none). DB changes: the matching `supabase/tests/run_v1_*.sh` plus Phase 1C regression;
  user flows: `supabase/tests/e2e/run_app_e2e.sh` (Docker daemon required).
- State the evidence level (mocked / local / hosted / device); "local" is never "verified in production".

## Deployment restrictions
Never contact or change hosted Supabase, production, provider dashboards or customer data, apply migrations, deploy
Edge Functions or open checkout without explicit owner approval for that exact action.

## Working efficiently
Read `docs/v1/PROJECT_STATE.md` first; do not re-audit the repository. Find files with Grep/Glob. Link to existing
docs instead of copying them. Update `PROJECT_STATE.md` and the evidence log when state changes.
