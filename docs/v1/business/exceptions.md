# Cancellation, rejection, refund and other exceptions

| Situation | Rule | Status |
|---|---|---|
| Customer changes their mind | Customer may cancel while `pending` | CONFIRMED · IMPLEMENTED local (`order_cancel`) |
| Cashier rejects / cancels | Cashier or admin may cancel `pending`, `confirmed`, `preparing`, `ready` with a reason (≥ 3 characters) | CONFIRMED · IMPLEMENTED local |
| After pickup | Nobody can cancel | CONFIRMED · IMPLEMENTED local |
| Kitchen cannot prepare (out of stock, closed) | No kitchen rejection in the lifecycle; the cashier cancels with a reason | IMPLEMENTED; kitchen-side rejection UNKNOWN (G2) |
| First-order benefit on a cancelled order | Released (order status `cancelled`/`rejected`); promo code redemptions of the order released too | IMPLEMENTED local |
| Failed delivery (absent, refused, wrong address, unreachable) | No status and no rule | **UNKNOWN (G3)** — needs owner decision: status, who records it, food handling, payment, first-order benefit |
| Customer does not pay at the door | `payment_status = failed` after `delivered` | IMPLEMENTED local; consequences (blocking, first-order benefit #48) UNKNOWN |
| Refund | `paid → refunded` record, only after `delivered`, cashier/admin; no money movement in the system | IMPLEMENTED local (record only); refund policy UNKNOWN |
| Price changed between preview and order | `create_order` refuses (40001); the app shows the new total | IMPLEMENTED local |
| Routing provider down / imprecise address | No quote → no order (fail closed) | IMPLEMENTED local |
| WhatsApp provider down | No code → number not verified → no order | IMPLEMENTED local; provider not configured (#47) |
| Duplicate submission | Same request id returns the same order | IMPLEMENTED local |
| Account deletion with orders | Orders kept, customer link removed | IMPLEMENTED local (`20261104…`); anonymisation of contact fields UNKNOWN (#22) |
