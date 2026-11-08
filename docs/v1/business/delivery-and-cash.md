# Driver delivery, cash on delivery and reconciliation

## Delivery workflow

| Rule | Status | Where |
|---|---|---|
| Driver approval = admin grants the `driver` staff role (optionally scoped to a kitchen) | IMPLEMENTED hosted (Phase 1C roles) | `assign_staff_role` |
| Online / offline availability | IMPLEMENTED hosted | `set_driver_availability`, `drivers.status` |
| Cashier/admin assigns the driver (no self-claiming) | CONFIRMED (2026-11-05) · IMPLEMENTED local | `order_assign_driver` |
| Availability required for assignment | UNKNOWN / not enforced | — |
| One active delivery per driver | UNKNOWN / not enforced | — |
| Driver sees only assigned orders; steps ready → picked_up → on_the_way → delivered | CONFIRMED · IMPLEMENTED local | `order_driver_update`, `app/(driver)/orders/[id].tsx` |
| Location reported only between pickup and delivery, append-only, admin-only history | IMPLEMENTED local | `driver_report_location`, `driver_location_points` |
| Customer contact: the WhatsApp-verified phone copied on the order (`orders.delivery_phone`) | IMPLEMENTED local (`20261109…`) | driver screen "Call" |
| Failed delivery (absent, refused, unreachable) | UNKNOWN — see [`exceptions.md`](exceptions.md) G3 | — |
| Location history retention | UNKNOWN (#30) | — |

## Cash on delivery

| Rule | Status | Where |
|---|---|---|
| V1 payment is cash on delivery only | CONFIRMED | `src/checkout/orderPayload.ts`, `create_order` (payment_method `cash`) |
| Confirming an order never marks it paid | CONFIRMED · IMPLEMENTED local | `order_confirm` |
| Payment is recorded by the cashier/admin **after delivery**: pending → paid or failed; failed → paid; paid → refunded | CONFIRMED (2026-11-05) · IMPLEMENTED local | `order_set_payment`, `order_payment_transitions()` |
| Amount due = order `total` (server) | IMPLEMENTED local | driver screen "Total to collect" = `orders.total` |
| The collected amount is **not** stored; only the payment status | IMPLEMENTED (limitation) | — |

## Cash reconciliation — NOT BUILT

| Topic | Status |
|---|---|
| Expected vs collected cash per driver / per shift | UNKNOWN — not built |
| Driver cash handover to the cashier | UNKNOWN — not built |
| Daily cash closing | UNKNOWN — not built. Legacy table `daily_closings` (counter era) exists, locked by Phase 1C, unused by V1 |
| Legacy `cash_collections` (driver_id, order_id, amount) | exists in the baseline schema; unused by V1 code; reuse needs a decision and a migration |
| Discrepancy handling, who approves | UNKNOWN |
| Driver pay / commission (driver screens use legacy 15 % `driver_commission`) | UNKNOWN (#11) |

Any cash feature needs owner decisions first (#58) (who counts, when, tolerance, sign-off). Do not infer them from the legacy tables.
