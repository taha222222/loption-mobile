---
name: loption-order-operations
description: The single shared L'OPTION delivery-order lifecycle across customer, cashier, kitchen, driver and admin — statuses, valid transitions, responsible role per step, driver assignment, payment state, failure paths, timeline and audit. Use for any task that changes or reads order status or that spans more than one role (kitchen, driver, cashier, admin, customer tracking). Prevents interface-specific lifecycles.
---

# Order operations

There is **one** lifecycle. Every interface (customer tracking, cashier, kitchen, driver, admin) uses the same
statuses and the same server functions. This skill owns that contract; the role skills implement their part of it.

## Use when
- Any change to order statuses, transitions, assignment, payment state, timeline or audit.
- Building or changing a role screen that moves orders (cashier, kitchen, driver, admin, customer tracking).
- Investigating "stuck" orders or a role that cannot perform a step.

## Not for
- Pricing and order creation rules (`loption-business-logic`, `supabase-backend-architect`).
- Cash reconciliation details (`loption-cashier-finance`).

## The contract (authoritative: `docs/v1/business/order-lifecycle.md`)
- Statuses: pending → confirmed → preparing → ready → picked_up → on_the_way → delivered; cancelled.
- Transition table: `public.order_transitions()` — the only definition. App mirror: `src/orders/orderWorkflow.ts`
  (buttons only; `__tests__/orderWorkflow.test.tsx` keeps it identical to the migration).
- Server functions only: `order_confirm`, `order_kitchen_update`, `order_assign_driver`, `order_driver_update`,
  `order_cancel`, `order_set_payment`, `driver_report_location`; client wrapper `src/services/orderWorkflowApi.ts`.
- Payment is separate from status (cash on delivery): `docs/v1/business/delivery-and-cash.md`.
- Implemented **local only** (`supabase/migrations/20261105120000_v1_order_workflow.sql`, hardened by
  `20261110120000_v1_order_lifecycle_hardening.sql`), not on hosted.

## Boundaries
- Do not add statuses, skip steps or let an interface write `orders` directly; propose changes to the owner first.
- A new step (e.g. failed delivery, kitchen rejection) is a business decision (`loption-business-logic`), then one
  change of `order_transitions()` + the app mirror + tests, used by every interface.
- Known gaps to respect, not to paper over: G1 (no kitchen/cashier screens; admin cannot do kitchen steps), G2
  (kitchen rejection undefined), G3 (failed delivery undefined), G5 (one active delivery per driver undefined), G6
  (notifications later). See the gap table in `order-lifecycle.md`.

## Workflow
1. Locate the step(s) in the transition matrix; confirm the responsible role and scope (`order_staff_can`).
2. If the task needs a step that does not exist, stop and raise the owner question.
3. Implement through the existing functions (server) and `orderWorkflowApi` (client); refetch after each action;
   Realtime is best effort (`orders`, `order_status_updates`).
4. Every change keeps the timeline (status changes only) and the audit rows (`security_audit_log`).

## Required tests
`supabase/tests/run_v1_order_lifecycle.sh` (full chain: 64 status × action combinations, bypasses, payment, races) and
`supabase/tests/run_v1_order_workflow.sh` (66 SQL tests: every allowed and refused transition, scope per role, races
such as pickup vs cancellation, reassignment, revoked role on the same JWT); `__tests__/orderWorkflow.test.tsx`
(mirror equals migration); for a role screen, a Jest test that it shows only allowed actions and calls the right
function; the end-to-end lifecycle in the checkout harness (`L40` in `supabase/tests/v1_checkout_experience_tests.sql`).

## Completion report
- Steps touched (from → to, role), functions used, audit actions written.
- Tests run with counts; gaps G1–G7 affected or closed (with owner decision reference).
