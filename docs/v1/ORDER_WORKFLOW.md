# L'OPTION V1 — Delivery order workflow

One state machine for delivery orders, enforced by the database. Migration
`supabase/migrations/20261105120000_v1_order_workflow.sql` (**not applied to any hosted project**), rollback
`supabase/rollback/v1_order_workflow_rollback.sql`, harness `supabase/tests/run_v1_order_workflow.sh` (66 SQL tests,
concurrency, regressions, rollback). Owner decisions of 2026-11-05: `DECISIONS.md` (Confirmed).

## State machine (single source: `public.order_transitions()`)

| From | To | Who |
|---|---|---|
| pending | confirmed | cashier of the order's kitchen (or admin) |
| confirmed | preparing | kitchen staff of the order's kitchen |
| preparing | ready | kitchen staff of the order's kitchen |
| ready | picked_up | the assigned driver |
| picked_up | on_the_way | the assigned driver |
| on_the_way | delivered | the assigned driver |
| pending | cancelled | the order's customer |
| pending, confirmed, preparing, ready | cancelled | cashier (or admin), reason required |

Everything else is refused (e.g. pending → delivered, pending → ready, confirmed → picked_up, delivered → confirmed, any
cancellation after pickup). The client copy `src/orders/orderWorkflow.ts` is tested row for row against the migration and
only decides which buttons to show.

**Payment (cash on delivery):** `payment_status` pending → paid | failed (after delivery), failed → paid, paid → refunded;
cashier or admin only (`order_set_payment`). Confirming an order never marks it paid. The rule "payment paid moves the
order pending → confirmed" applies only to prepaid orders, which do not exist (DECISIONS #33).

## Server functions (the only way to change a workflow order)

`order_confirm`, `order_kitchen_update`, `order_assign_driver` (cashier/admin, before pickup; active driver of the kitchen
or without kitchen), `order_driver_update`, `order_cancel`, `order_set_payment`, `driver_report_location`. Each one: locks
the order row, checks the caller's active role in `staff_roles` **and** its scope (kitchen, assignment, ownership), checks
the transition, writes the customer-visible `order_status_updates` row and an immutable `security_audit_log` row
(`order_confirmed`, `kitchen_preparing`, `order_ready`, `driver_assigned`/`driver_reassigned`, `order_picked_up`,
`order_on_the_way`, `order_delivered`, `order_cancelled`, `payment_confirmed`, `payment_failed`, `payment_refunded`).
A repeated call returns `unchanged` and writes nothing (double taps, retries).
Approved audit model (2026-11-05): the timeline `order_status_updates` holds status changes only; driver assignment and
payment changes are audit-only; the location history is separate from both. A refusal never says whether an order
the caller may not see exists ("order not found or not allowed").

## What the database refuses whatever the client does

- A direct `UPDATE`/`INSERT` of a workflow order's state, driver, kitchen, payment or content — by a customer, staff,
  an admin (its `ALL` policy) or `service_role`. Only the functions above (running as the owner with a transaction flag)
  can. Account deletion may still detach the customer (`user_id` → NULL).
- Changing the status, driver, kitchen or payment of a **historical** order (the 72 counter/kiosk orders on
  `loption-mobile`, `workflow_version` NULL): frozen, never rewritten.
- Changing an order line's price, meal, name or quantity (price snapshot); adding/removing lines of a workflow order.
- A second active staff role for a user.
- Writing or deleting the driver location history (append-only; admin read only).

## Visibility (RLS)

Customer: own orders, their lines and status history; the driver's position only between pickup and delivery.
Kitchen staff and cashiers: workflow orders of their kitchen. Driver: assigned orders only. Admin: everything (read),
changes only through the functions. Location history and audit log: admin only.

## Realtime

`orders` and `order_status_updates` are added to the `supabase_realtime` publication (best effort; RLS applies to the
events). The screens also refetch after every action, so a Realtime failure never blocks the workflow.

## Edge cases covered by tests

Parallel confirmations (one change, one audit row); pickup racing a cancellation (exactly one wins); reassignment
before pickup (the previous driver is refused at once, checked under the row lock); a revoked staff role refused on the
same JWT; location points repeated, stale, out of range, from another driver, before pickup or after delivery; refund
only after payment; a menu price change not affecting past orders; account deletion with workflow orders.

## Not done yet (blocking real use)

- Trusted order creation (`create_order`) with approved pricing (checklist H4–H7): checkout stays disabled, so no
  workflow order can be created by customers yet.
- Kitchen and cashier screens: this repository has customer, driver, admin and partner apps only; the admin orders
  screen acts as cashier meanwhile.
- Order notifications (cashier on new order, kitchen on confirmation, driver on ready, customer on pickup/delivery)
  (DECISIONS #32).
- Applying the migration to `loption-mobile` (owner authorization; DECISIONS #34).
