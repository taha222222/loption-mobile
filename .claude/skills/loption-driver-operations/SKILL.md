---
name: loption-driver-operations
description: L'OPTION driver side — driver approval and availability, assignment (cashier/admin assigns; no self-claiming), pickup, on-the-way and delivery confirmation, location sharing, customer contact by verified phone, failed delivery handling and the driver's role in cash collection. Use for driver screens, driver permissions, location tracking or delivery exceptions. Always together with loption-order-operations.
---

# Driver operations

## Current state (verified 2026-11-08)
- Approval: an admin grants the `driver` staff role (optionally scoped to a kitchen); availability online/offline via
  `set_driver_availability` (Phase 1C, hosted).
- Assignment: **cashier or admin assigns** (owner 2026-11-05) through `order_assign_driver`, before pickup, to an active
  driver of the kitchen or without kitchen. Drivers do not claim orders. One active delivery per driver and
  availability-gated assignment are **not decided / not enforced** (G5).
- Steps: ready → picked_up → on_the_way → delivered via `order_driver_update` (assigned driver only; identity re-checked
  under the row lock). Location only between pickup and delivery (`driver_report_location`, append-only history,
  admin read). All **local only** (`20261105120000_v1_order_workflow.sql`).
- Screens: `app/(driver)/index.tsx`, `app/(driver)/orders/[id].tsx` (uses `driverUpdate`, shows `orders.total` as cash
  to collect and the verified `orders.delivery_phone`), `history.tsx`, `earnings.tsx`, `profile.tsx`. Earnings use the
  legacy 15 % `driver_commission` (not decided, #11). Stray files `app/(driver)/extractor.py`, `output.txt` come from the
  initial commit.
- Failed delivery: no status or rule (G3). Payment is recorded by the cashier after delivery, not by the driver.

## Use when
Driver screens, assignment rules, location, delivery exceptions, what the driver collects.

## Boundaries
- Do not add self-claiming, a "failed delivery" status or one-delivery limits without an owner decision
  (`loption-business-logic`) and a lifecycle change (`loption-order-operations`).
- The driver never sets prices, totals or payment status; the cash amount shown is the server `orders.total`.
- Location data is personal data: keep the existing limits (own assigned order, picked_up → delivered).

## Workflow
1. Check the step against `docs/v1/business/order-lifecycle.md` and `delivery-and-cash.md`.
2. Server changes via `supabase-backend-architect`; client via `src/services/orderWorkflowApi.ts`.
3. Driver UI: big actions per step, clear refusal messages, works with poor network (retry is idempotent).

## Required tests
SQL: only the assigned driver can move the order; reassignment refuses the previous driver at once; location
refused before pickup / after delivery / for another driver (in `run_v1_order_workflow.sh`). Jest for the driver
screen actions. Device: background location and battery (`docs/v1/DEVICE_TEST_PROCEDURES.md`).

## Completion report
Steps and permissions touched, location/privacy impact, gaps G3/G5 status, tests with counts, owner questions.
