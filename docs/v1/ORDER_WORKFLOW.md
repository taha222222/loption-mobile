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

## Hardening (`20261110120000_v1_order_lifecycle_hardening.sql`, not applied)

Milestone 1 audit (2026-11-08) closed four bypasses without adding any status or rule: a workflow order can no longer
be deleted (an admin's `ALL` policy and `service_role` could); its timeline rows are written only by the order service
and never changed or deleted (`order_status_updates_guard`); only account deletion (running as `postgres`) may detach
the customer; the audit row of a cancellation carries the reason. Harness: `supabase/tests/run_v1_order_lifecycle.sh`
(21 SQL tests incl. all 64 status × action combinations, concurrency, regressions, rollback).

## Cashier screens (`app/cashier/`, Milestone 2; no migration)
- Who: an active `staff_roles` row `cashier` (routing in `src/stores/authStore.ts`; `user_profiles.role` is not
  trusted) and admins (button « CASHIER QUEUE » on the admin orders screen). Customers and other roles are sent back
  to their own screens; the database decides what each account reads and does.
- Reads (`src/services/cashierApi.ts`): workflow orders of the tab with explicit columns (no `user_id`,
  `client_request_id` or tax breakdown), the lines (meal, quantity, choices, note, line total), the timeline. Rows come
  from the existing policies (`orders_cashier_read`: own kitchen; `staff_admin_all_orders`).
- Actions: `order_confirm` and `order_cancel` (reason 3–300 characters, confirmed in a dialog) through
  `orderWorkflowApi`; buttons from the shared transition table. No payment, driver or kitchen action; confirmation
  never marks the order paid. Double taps send one request; `unchanged`, refusals and state changes are explained and
  the order is reloaded.
- Updates: Realtime on `orders` and `order_status_updates` (best effort), refetch after each action, on focus and on
  pull-to-refresh / « Actualiser ».
- Tests: `supabase/tests/run_v1_cashier_orders.sh` (19 SQL tests with the app's own column lists, 4 races),
  `__tests__/cashierOrders.test.ts`, `__tests__/cashierScreens.test.tsx`, the cashier part of the e2e journey.

## Kitchen board (`app/kitchen/`, Milestone 3; no migration)
- Who: an active `staff_roles` row `kitchen_staff` (routing in `src/stores/authStore.ts`). Admins and cashiers stay on
  their own screens: the server refuses kitchen steps from them (`order_staff_can`).
- Reads (`src/services/kitchenApi.ts`): confirmed, preparing and ready workflow orders (number, status, times,
  whether a driver is assigned) and their lines (meal, quantity, choices, note). No phone, address, amount, payment or
  account column is requested (the row policy still allows them: #31/#62).
- Actions: « Commencer la préparation » (confirmed → preparing) and « Commande prête » (preparing → ready) through
  `kitchenUpdate` (`order_kitchen_update`); one button per order from the shared transition table. Ready orders show
  « En attente du livreur ». No confirm, cancel, assignment or payment from the kitchen. Double taps send one request;
  `unchanged`, refusals and cancellations by the cashier are explained and the board reloads.
- Updates: Realtime (shared helper `src/services/orderRealtime.ts`), refetch after each action, on focus and on
  « Actualiser » / pull-to-refresh.
- Tests: `supabase/tests/run_v1_kitchen_orders.sh` (17 SQL tests with the app's own column lists, 4 races),
  `__tests__/kitchenOrders.test.ts`, `__tests__/kitchenScreen.test.tsx`, kitchen part of the e2e journey.

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

## Order creation (`public.create_order`, migration `20261106120000_v1_create_order.sql`, not applied)

The app sends only the kitchen, the meal ids, quantities and notes, and a request id. The server:
- refuses anonymous callers and staff accounts; requires the customer's confirmed delivery address (copied to the order);
- reads every price from `meals` (inactive meals refused; a price sent by the client is never read), 1–30 lines,
  quantities 1–20, each meal once;
- takes the service fee from the kitchen's **owner-approved** `pricing_policies` row; with no approved row it refuses
  (`55000`, "ordering is not open") and creates nothing — no fee value exists in the code;
- since the pricing engine (`20261108120000_v1_pricing_engine.sql`, not applied): the delivery fee comes from the
  customer's server-side road-distance quote, the TVA is split per tax category (refused while a category is pending),
  there is no minimum order, and every amount is snapshotted on the order — see
  [V1_PRICING_SPECIFICATION.md](V1_PRICING_SPECIFICATION.md);
- creates the pending, cash-on-delivery workflow order and its lines in one transaction, applies the existing first-order
  free delivery, writes the timeline row `pending` and the audit row `order_created`;
- returns the same order for the same request id (advisory lock; 4 parallel identical requests → 1 order).

Checkout in the app stays closed (`CHECKOUT_OPEN = false`); the open path is built and tested and only calls
`create_order()`. Harness: `supabase/tests/run_v1_create_order.sh` (25 SQL tests, concurrency, regressions, rollback).

### Approving pricing (owner action, after legal/accounting review)

Pricing is a row, never an edit (audited as `pricing_policy_approved`); to change it, deactivate the old row
(`update … set active = false`, audited) and insert a new one. With the pricing engine the row holds the service fee,
the delivery formula values and Kitchen A's dispatch point: template in
[V1_PRICING_SPECIFICATION.md §6](V1_PRICING_SPECIFICATION.md#6-activating-pricing-owner-and-accountant-actions-in-order).

## Delivery zones (`20261107120000_v1_delivery_zones.sql`, not applied)

Launch: **Casablanca only, from Kitchen A** (owner, 2026-11-06). Each customer's address carries a city key
(`user_profiles.delivery_city`, chosen in the app, pre-filled from the position or the typed address). `create_order()`
accepts only cities with an active `delivery_zones` row served by the requested kitchen; otherwise « choose your
delivery city » / « delivery is not available in your city yet » and nothing is written. The app tells the customer at
the address step and at checkout. Opening a city later is one owner-approved row (audited):

```sql
insert into public.delivery_zones (city_key, city_name, kitchen_id)
select '<city_key>', '<City name>', id from public.kitchens where code = '<kitchen code>';
```

## Not done yet (blocking real use)

- Approved taxes (DECISIONS #38–#40), Kitchen A's pricing row and routing key (#41, #42), and the migrations applied to
  `loption-mobile` (#34, #36, #37); then `CHECKOUT_OPEN`.
- Limits inside Casablanca (districts or distance from Kitchen A) are not decided (DECISIONS #7); the zone is the city.
- Driver assignment and payment records are only on the admin orders screen (cashier and kitchen screens exist since
  Milestones 2 and 3).
- Order notifications (cashier on new order, kitchen on confirmation, driver on ready, customer on pickup/delivery)
  (DECISIONS #32).
- Applying the migration to `loption-mobile` (owner authorization; DECISIONS #34).
