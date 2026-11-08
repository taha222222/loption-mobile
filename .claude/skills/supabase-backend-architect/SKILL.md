---
name: supabase-backend-architect
description: L'OPTION Supabase/PostgreSQL backend — migrations, RLS and grants, SECURITY DEFINER functions, the Phase 1C containment monitor, Edge Functions, transactional and idempotent order creation, server-authoritative pricing, concurrency, audit logs, rollbacks and SQL test harnesses. Use for any schema, policy, function, trigger, Edge Function or database-security task. Never applies anything to hosted Supabase.
---

# Supabase backend architect

## Use when
- Creating or changing tables, columns, policies, grants, functions, triggers, Edge Functions.
- Order creation, pricing, quotes, phone verification, promo codes, payment state, audit.
- Reviewing whether a client value can influence a privileged decision.

## Not for
- Deciding business rules (ask `loption-business-logic`). UI (use `expo-react-native-engineer`).

## Non-negotiable
- Nothing runs against hosted Supabase without the owner's explicit approval for that exact change. Local Docker only.
- Privileged decisions (prices, fees, totals, discounts, eligibility, roles, payment state, kitchen, distance) are
  computed on the server from database rows. Client values are inputs to validate, never authority.
- RLS on every table clients touch; owner-only or role-scoped policies; column-level grants; no broad grants.
- `public.containment_violations()` must return 0 rows. A new client policy or client-callable definer function is
  added to the monitor **only** through `supabase/tools/generate_nutrition_monitor.py` (then `--check`).
- Staff authority only from `public.staff_roles` (`has_staff_role`, `order_staff_can`, `has_kitchen_role`).
- Workflow orders change only through the workflow functions (guard `orders_workflow_guard`, flag
  `loption.order_service`); never bypass it.

## Key files
- Migrations: `supabase/migrations/` — chain: Phase 1C (`20261016170000`, `…171000` storage) → onboarding/offer
  (`20261028`) → nutrition (`20261029`) → activity (`20261030`) → standalone (`20261103`) → account deletion
  (`20261104`) → order workflow (`20261105`) → create_order (`20261106`) → zones (`20261107`) → pricing engine
  (`20261108`) → checkout experience (`20261109`) → order lifecycle hardening (`20261110`). Hosted has up to standalone (see `docs/v1/business/README.md`).
- Rollbacks: `supabase/rollback/` (newest first). Monitor generator: `supabase/tools/generate_nutrition_monitor.py`.
- Edge Functions: `supabase/functions/dispatch-notifications`, `quote-delivery`, `phone-otp` (pure core + `index.ts`).
- Baseline of the hosted schema before V1: `supabase/baseline/staging_schema_2026-10-15.sql`.
- Pattern and checklist: [`references/migration-pattern.md`](references/migration-pattern.md).

## Workflow
1. Read the business rule (`loption-business-logic`) and the current definition in the latest migration that touches it.
2. Design: tables/columns, who reads/writes (RLS + grants), definer functions (fixed `search_path`, revoke from
   `public`/`anon`, grant narrowly), idempotency key, locks, audit rows, failure codes.
3. Write one migration per feature following the pattern; write the archiving rollback; register generated blocks.
4. Write SQL tests and a `supabase/tests/run_v1_<feature>.sh` harness (refusals, migration, tests, concurrency,
   regressions, rollback, re-apply). Add the migration to `supabase/tests/e2e/run_app_e2e.sh`.
5. Run the harness plus Phase 1C regression on fresh databases; record evidence (`loption-qa-testing`).

## Required tests
Refusals (wrong role, missing predecessor, weakened monitor, failing postcondition commits nothing); RLS per role;
tampering (client cannot write prices/totals/status); idempotency and concurrency (parallel identical requests →
one row); rollback with data, then re-apply; regressions: order workflow, account deletion, standalone, Phase 1C.

## Completion report
- Migration, rollback and functions changed; monitor fingerprint (old → new).
- Harness result with counts; regressions run; what was not run.
- Explicit statement: nothing applied to hosted Supabase / which owner approval is needed.
