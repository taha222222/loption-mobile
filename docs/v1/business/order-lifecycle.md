# Order lifecycle — delivery orders

Authoritative for statuses, transitions, who may perform them, failure paths and audit. Implementation detail:
[`../ORDER_WORKFLOW.md`](../ORDER_WORKFLOW.md). Single implementation of the transition table:
`public.order_transitions()` in `supabase/migrations/20261105120000_v1_order_workflow.sql` (**local only**); the app's
mirror `src/orders/orderWorkflow.ts` only decides which buttons to show and is tested against the migration.

## 1. Statuses

| Status | Meaning |
|---|---|
| `pending` | Created by `create_order()`; waiting for the cashier |
| `confirmed` | Accepted by the cashier of the order's kitchen (payment still pending) |
| `preparing` | Kitchen started preparing |
| `ready` | Ready for pickup |
| `picked_up` | The assigned driver has it |
| `on_the_way` | Driver travelling |
| `delivered` | Handed to the customer |
| `cancelled` | Terminal; reason required when staff cancel |

Historical counter/kiosk orders (`workflow_version` NULL; statuses `new … served, paid`) are frozen and never move
through this lifecycle. **CONFIRMED** (owner, 2026-11-05) · **IMPLEMENTED, local only**.

## 2. Transition matrix

| From | To | Actor (checked by `order_staff_can`) | Function | Status |
|---|---|---|---|---|
| pending | confirmed | cashier of the order's kitchen, or admin | `order_confirm` | CONFIRMED · IMPLEMENTED local |
| confirmed | preparing | kitchen_staff of the order's kitchen | `order_kitchen_update` | CONFIRMED · IMPLEMENTED local |
| preparing | ready | kitchen_staff of the order's kitchen | `order_kitchen_update` | CONFIRMED · IMPLEMENTED local |
| ready | picked_up | the assigned driver | `order_driver_update` | CONFIRMED · IMPLEMENTED local |
| picked_up | on_the_way | the assigned driver | `order_driver_update` | CONFIRMED · IMPLEMENTED local |
| on_the_way | delivered | the assigned driver | `order_driver_update` | CONFIRMED · IMPLEMENTED local |
| pending | cancelled | the order's customer | `order_cancel` | CONFIRMED · IMPLEMENTED local |
| pending, confirmed, preparing, ready | cancelled | cashier of the kitchen or admin, reason ≥ 3 chars | `order_cancel` | CONFIRMED · IMPLEMENTED local |

Everything else is refused (e.g. pending → delivered, confirmed → picked_up, any cancellation after pickup).
A repeated call returns `unchanged` and writes nothing.

**Driver assignment** (not a status): cashier of the kitchen or admin, while the order is confirmed/preparing/ready, to
an active driver of that kitchen or a driver without kitchen (`order_assign_driver`); reassignment allowed before pickup.
CONFIRMED (owner, 2026-11-05: cashier/admin assigns) · IMPLEMENTED local.

**Payment** (separate field `payment_status`, cash on delivery): see [`delivery-and-cash.md`](delivery-and-cash.md).

## 3. End-to-end flow and who is responsible

Customer order (`create_order`) → cashier confirmation → kitchen preparing → ready → cashier assigns driver →
driver pickup → on the way → delivered → cashier records payment (paid / failed) → **cash reconciliation (UNKNOWN, not built)**.

## 4. Known gaps and contradictions (do not resolve silently)

| # | Gap | Status |
|---|---|---|
| G1 | Cashier screens (`app/cashier/`, Milestone 2) and the kitchen board (`app/kitchen/`, Milestone 3: start preparing, mark ready) exist, local. Admins still **cannot** perform kitchen steps (`order_staff_can`; unchanged). Driver assignment is only on the admin orders screen, so a ready order needs an admin to assign a driver. | Partly closed (screens); assignment UI for cashiers pending |
| G2 | Kitchen "accept / reject": the lifecycle has no kitchen acceptance or rejection; only the cashier confirms or cancels. | UNKNOWN — owner decision needed (#54) |
| G3 | Failed delivery (customer absent, refused, unreachable): no status; cancellation is impossible after pickup; `payment_status = failed` exists only once `delivered`. | UNKNOWN — owner decision needed (#55) |
| G4 | Driver claiming vs assignment: drivers do not claim orders; cashier/admin assigns (CONFIRMED). Any "claim" feature contradicts the owner decision. | CONFIRMED assignment |
| G5 | One active delivery per driver: not decided, not enforced. | UNKNOWN (#56) |
| G6 | Order notifications (cashier new order, kitchen confirmed, driver ready, customer pickup/delivery): later phase (owner 2026-11-06), not built. | CONFIRMED later |
| G7 | Kitchen capacity / opening hours / pausing orders: only `kitchens.is_active` exists. | UNKNOWN (#57) |

## 5. Audit requirements (implemented, local only)

Every workflow function locks the order row, checks role and scope, writes the customer timeline row
(`order_status_updates`, status changes only) and an immutable `security_audit_log` row (`order_confirmed`,
`kitchen_preparing`, `order_ready`, `driver_assigned` / `driver_reassigned`, `order_picked_up`, `order_on_the_way`,
`order_delivered`, `order_cancelled`, `payment_confirmed` / `payment_failed` / `payment_refunded`, `order_created`).
Assignment and payment are audit-only; the driver location history is separate (owner approval 2026-11-05).
A cancellation's audit row includes the reason. A workflow order is never deleted and its timeline is never changed
or deleted; only account deletion detaches the customer (`20261110…` hardening, local only).
