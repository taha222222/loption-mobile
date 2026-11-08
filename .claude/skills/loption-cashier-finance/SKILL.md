---
name: loption-cashier-finance
description: L'OPTION cashier and money side — order confirmation, cancellation with reason, driver assignment, cash-on-delivery payment records (paid/failed/refunded), expected vs collected cash, driver cash handover, daily closing, refunds, discrepancies and financial audit history. Use for cashier screens, payment state, refunds or any cash reconciliation task. Order confirmation is never payment collection.
---

# Cashier and finance

## Current state (verified 2026-11-08)
- Cashier role: `staff_roles.role = 'cashier'`, scoped to one kitchen; admins act as cashier everywhere
  (`order_staff_can`). Cashier screens `app/cashier/` (Milestone 2, local): pending queue, order detail, confirm,
  cancel with reason; reads in `src/services/cashierApi.ts`, rules in `src/cashier/cashierOrders.ts`. Driver
  assignment and payment records are still only on `app/(admin)/orders.tsx`.
- Implemented (**local only**, `20261105120000_v1_order_workflow.sql`):
  - `order_confirm` — pending → confirmed; payment stays `pending`.
  - `order_cancel` — until `ready`, reason ≥ 3 characters.
  - `order_assign_driver` — before pickup.
  - `order_set_payment` — only once `delivered`: pending → paid | failed; failed → paid; paid → refunded. Audited
    (`payment_confirmed`, `payment_failed`, `payment_refunded`). The **amount collected is not stored**.
- Amount due = `orders.total` computed by the server (`create_order`, `docs/v1/V1_PRICING_SPECIFICATION.md`).
- **Not built / not decided:** expected vs collected cash, driver cash handover, daily closing, discrepancy handling,
  refund policy (a `refunded` status is only a record), driver pay (#11). Legacy baseline tables `cash_collections` and
  `daily_closings` exist but are unused by V1 (`daily_closings` locked by Phase 1C). See
  `docs/v1/business/delivery-and-cash.md`.

## Use when
Cashier screens, payment records, refunds, cash counts, daily closing, financial audit.

## Boundaries
- Confirming an order and recording payment are different steps by different moments (before preparation vs after
  delivery). Never merge them; never mark paid from the order status.
- Any reconciliation feature (counts, tolerances, sign-off, who approves discrepancies) needs owner decisions first
  (`loption-business-logic`), then a migration (`supabase-backend-architect`). Do not repurpose legacy tables silently.
- Money values come from the server; the client never computes what is owed.
- Financial records are append-only with audit (same pattern as `security_audit_log`); corrections are new rows.

## Workflow
1. Read `delivery-and-cash.md` and `exceptions.md`; list decisions needed.
2. Server: functions with role + kitchen scope, row locks, idempotency, audit; client via
   `src/services/orderWorkflowApi.ts` (`confirmOrder`, `assignDriver`, `cancelOrder`, `setPayment`).
3. Cashier UI: new orders queue, confirm/cancel with reason, assign driver, record payment after delivery with the
   exact amount due shown.

## Required tests
`supabase/tests/run_v1_cashier_orders.sh`, `__tests__/cashierOrders.test.ts`, `__tests__/cashierScreens.test.tsx`.
SQL: confirmation leaves payment pending; payment only after delivery; allowed payment transitions only; other kitchen
refused; audit rows (in `run_v1_order_workflow.sh`). For reconciliation (when decided): totals per driver/day equal
the sum of delivered paid orders; discrepancies recorded, never overwritten; concurrency of two cashiers.

## Completion report
Steps and records touched, audit actions, decisions applied/raised, tests with counts, money-related risks.
