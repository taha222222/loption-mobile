# L'OPTION — engineering instructions

Moroccan meal-delivery app: company-owned kitchens (Kitchen A first), cash on delivery only.
Current state and next task: `docs/v1/PROJECT_STATE.md`. Product rules: `docs/v1/DECISIONS.md`.
For any feature, database, auth, pricing, nutrition or notification work, load the `loption-engineer` skill.

## Stack
- Expo SDK 58, React Native 0.88, React 19.3, Expo Router 58 (typed routes), TypeScript 6, zustand 5.
- Supabase: Postgres (RLS), Auth (GoTrue), PostgREST, one Edge Function (`supabase/functions/dispatch-notifications`).
- Tests: jest-expo 58 / Jest 30 / RNTL 14 (`__tests__/`); SQL and e2e harnesses in `supabase/tests/` (Docker).
- UI: V2 design system in `src/components/v2` + `src/theme`; customer screens are French.

## Hard rules
- Never put secrets in the app, in `EXPO_PUBLIC_*` or in git. Leave credentials empty; never invent keys or IDs.
- Never contact or change hosted Supabase, production, provider dashboards or customer data without explicit approval.
- Never weaken RLS, grant broad client permissions, or bypass the Phase 1C containment monitor.
- Prices, fees, discounts, calories and payment state are computed on the server, never trusted from the client.
- Checkout stays disabled until trusted server-side order creation and approved pricing exist.
- No force-push, history rewrite, merge into `main`, or ruleset bypass. Work on new `claude/*` branches.
- Do not invent product decisions or project status; record open questions in `docs/v1/DECISIONS.md`.

## Working efficiently
- Read `docs/v1/PROJECT_STATE.md` first; do not re-audit the repository.
- Open only the files the task touches; find them with Grep/Glob, not full-tree reads.
- Link to existing docs instead of copying them. Update `PROJECT_STATE.md` incrementally when state changes.

## Conventions
- Match surrounding code style and comment density. Small screens in `app/`, logic in `src/` (pure, testable).
- New DB objects: one migration per feature with role check, deferred commit gate, pre/postconditions,
  refusal on re-run, archiving rollback in `supabase/rollback/`, and SQL tests.
- Every behaviour change gets a test. Mock Supabase in Jest; use the Docker harnesses for SQL/RLS.

## Commands
- `npm ci` (lockfile is authoritative; `.npmrc` sets `legacy-peer-deps=false`).
- `npm run check` = `tsc --noEmit` + `expo lint` + `jest`. Lint has known errors in pre-existing files only.
- `bash supabase/tests/run_phase1c.sh` · `run_v1_onboarding_offer.sh` · `run_v1_nutrition.sh` · `e2e/run_app_e2e.sh`
  (need a running Docker daemon).
