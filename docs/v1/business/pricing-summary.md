# Pricing — summary

**Not authoritative.** The authoritative text, examples, rounding policy and open questions are in
[`../V1_PRICING_SPECIFICATION.md`](../V1_PRICING_SPECIFICATION.md). This page only lists the rules with their status so
skills can point to one place.

| Rule | Status |
|---|---|
| Menu prices are TTC; TVA never added at checkout; "TVA incluse dans les prix affichés." | CONFIRMED (owner 2026-11-07) |
| Delivery fee `round_half_up(min(25, max(10, 8 + 1.5 × road km)))` from the order's kitchen; server road distance; no straight-line fallback | CONFIRMED · IMPLEMENTED local (`20261108…`, `supabase/functions/quote-delivery`) |
| Service fee 3 MAD per order, **0 on the first qualifying order** | CONFIRMED (2026-11-07, two owner briefs; the later one adds the first-order waiver) · IMPLEMENTED local (`20261109…`) |
| First qualifying order: service 0 and delivery 0; cancelled/rejected orders release it | CONFIRMED · IMPLEMENTED local. "Failed" orders: the owner brief says they must not consume it; implemented rule: a delivered order whose payment failed still consumes it → **#48 open** |
| Customization extras ≥ 0, TTC, priced by the server | CONFIRMED (brief 2026-11-07) · IMPLEMENTED local |
| Promo codes: rules stored per code; once per customer; products only | IMPLEMENTED local; rules **#49 open**; no code exists |
| Minimum order | CONFIRMED none |
| TVA rates (food 10 % proposed; service and delivery fees unclassified) | **PROPOSED / accountant** (#38–#40); `create_order` refuses until approved |
| Delivery radius / maximum distance | **UNKNOWN** (#45, #7) |
| Driver commission (driver screens show 15 % of delivery fee, legacy) | **UNKNOWN** (#11) |

Total = products TTC (with choices) − promo + service + delivery = cash due. Every amount is computed by
`checkout_price()` on the server; `create_order()` refuses if the total the customer saw differs (40001).
