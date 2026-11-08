---
name: loption-qa-testing
description: L'OPTION testing and evidence — business-rule scenarios, Jest unit/screen tests, SQL/RLS harnesses in Docker, end-to-end web journey, role and permission tests, concurrency and failure scenarios, regressions, and the evidence log. Use for every change before calling it done, and whenever someone asks whether something is tested, verified or production-ready.
---

# QA and testing

## Use when
- Any behaviour change (every change gets a test), any migration, any release question.
- Writing the completion report of another skill.

## Evidence levels — always state which one you have
1. **Mocked** — Jest with Supabase mocked (`__tests__/`). Proves app logic only.
2. **Local integration** — Docker Postgres 17 + GoTrue + PostgREST (`supabase/tests/run_*.sh`,
   `supabase/tests/e2e/run_app_e2e.sh`). Proves SQL, RLS and the web build against real local services.
3. **Hosted verification** — read-only checks against the hosted project, only with owner approval
   (`supabase/tests/postdeploy_verify_*_readonly.sql`).
4. **Physical device / real provider** — EAS builds, iPhone/Android, real WhatsApp, Google Routes, push
   (`docs/v1/DEVICE_TEST_PROCEDURES.md`). Not available in this repository's automation.

"Production ready" requires level 3 and 4 evidence recorded in the evidence log; never claim it from levels 1–2.

## Inventory
See [`references/test-inventory.md`](references/test-inventory.md) for every harness, Jest suite and what each covers.

## Workflow
1. From the business rule, write the scenarios first (happy path, refusals, boundaries, roles, races, failures).
2. Put each scenario at the cheapest level that proves it (SQL for server rules and RLS, Jest for display and app
   logic, e2e for flows across services).
3. Run: `npm run check` (tsc + lint + jest; lint has known errors in older files only — no new ones), the matching
   `supabase/tests/run_v1_*.sh`, `run_phase1c.sh` or the Phase 1C regression inside the harness, and e2e for user flows.
   Harnesses need a Docker daemon (`(nohup dockerd >/tmp/dockerd.log 2>&1 &)` in cloud sessions).
4. Record the run in `docs/v1/REMAINING_SETUP_AND_RELEASE_TASKS.md` (evidence log E-xx) with branch, environment,
   commands and counts. Say what was **not** run.

## Scenario checklist for order and checkout work
Empty / one / several items; same meal with different choices; quantity and removal; first qualifying order;
second order; cancelled previous order; delivery formula boundaries (1/3/5/8/10/15 km, .49/.50); routing failure;
unserved city; promo valid/invalid/expired/once per customer/rate limit; unverified phone; WhatsApp failure;
duplicate request; network loss with retry; changed total (40001); tampering by customer/admin/owner role;
role scope (other kitchen, unassigned driver, revoked role); COD lifecycle to `paid`; rollback with data.

## Required tests
The QA skill's own bar: every behaviour change has at least one test at the right level; every migration has a
harness run with regressions; every user-flow change has an e2e run or a stated reason why not.

## Completion report
- Tests added/changed; commands run with exact pass/fail counts; evidence level reached.
- What was not tested and why (device, provider, hosted); evidence log entry number.
