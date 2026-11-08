# Delivery zones and kitchen assignment

| Rule | Status | Where |
|---|---|---|
| Company-owned kitchens; Kitchen A (Casablanca) is the only kitchen at launch | CONFIRMED (owner brief; owner 2026-11-06) | `public.kitchens` (Phase 1C seeds `A`, hosted) |
| Delivery at launch: Casablanca only; other cities are saved but cannot order ("pas encore disponible dans votre ville") | CONFIRMED (owner 2026-11-06) | `public.delivery_zones`, `user_profiles.delivery_city` (`20261107…`, local only); `src/delivery/cities.ts` |
| The kitchen of an order is the kitchen of the customer's active zone; `create_order` refuses another kitchen | IMPLEMENTED local | `checkout_price()` / `create_order()` |
| The road distance (delivery fee) is measured from that kitchen's dispatch point (`pricing_policies.origin_*`) | IMPLEMENTED local | `20261108…`; Kitchen A coordinates **missing** (#41) |
| Opening a city = one owner-approved `delivery_zones` row naming its kitchen | CONFIRMED (#35) | `ORDER_WORKFLOW.md` |
| Boundaries inside Casablanca (districts, maximum distance) | UNKNOWN (#7, #45) | — |
| Kitchen capacity, opening hours, temporarily pausing a kitchen | UNKNOWN (only `kitchens.is_active`) | — |
| Choosing between several kitchens serving one city | UNKNOWN (one zone → one kitchen today) | — |
