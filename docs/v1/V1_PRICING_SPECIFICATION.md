# L'OPTION V1 — Pricing specification

Status: **implemented locally, not applied anywhere, checkout closed.** Migration
`supabase/migrations/20261108120000_v1_pricing_engine.sql` (after the delivery-zones migration), rollback
`supabase/rollback/v1_pricing_engine_rollback.sql`, harness `supabase/tests/run_v1_pricing_engine.sh` (40 SQL tests +
concurrency, regressions, rollback), Edge Function `supabase/functions/quote-delivery/` (not deployed). Owner proposal of
2026-11-07. The tax classifications are pending the accountant (see "Open decisions").

## 1. What the customer pays

```
total (cash on delivery) = products subtotal TTC + service fee + delivery fee
```

| Part | Rule | Source of truth |
|---|---|---|
| Products | Menu prices are **TTC** (TVA included). Line = unit price × quantity | `meals.price`, read by `create_order()` |
| Service fee | **3 MAD**, fixed, once per order | the kitchen's approved `pricing_policies` row |
| Delivery fee | `D = round_half_up(min(25, max(10, 8 + 1.5 × d)))`, d = road distance in km from the order's kitchen | `delivery_fee_v1()` + the server's road-distance quote |
| First order | free delivery (existing offer, unchanged): the delivery fee becomes 0, the discount is recorded | `apply_first_order_offer()` |
| TVA | never added at checkout; broken down inside the amounts (HT + TVA = TTC) | `tax_split()` + `tax_categories` |
| Minimum order | **none** (not approved, removed) | — |

Nothing sent by the app is used for a price, fee, distance, tax or total. The app sends the meal ids, quantities, notes,
the kitchen and a request id (`create_order`), and asks for a quote with an empty request (`quote-delivery`).

## 2. Delivery fee

- `d` is the **road** distance (Google Routes API, `DRIVE`, traffic-unaware) from the kitchen's dispatch point
  (`pricing_policies.origin_latitude/longitude`) to the customer's saved address, geocoded by the server (Google
  Geocoding, restricted to Morocco, precise results only). The map pin sent by the app is not used for pricing.
- No straight-line fallback. No routing key, a provider error or timeout (8 s), no route, an address the geocoder cannot
  place precisely, or a distance ≤ 0 or > 200 km → no quote → `create_order()` refuses (« delivery quote required »).
- The quote (`delivery_quotes`) stores the user, kitchen, pricing row, the address it was computed for, origin,
  destination, distance (metres → km, 3 decimals), fee, formula version `v1_road_km`, provider, 15-minute validity.
  `create_order()` takes the customer's latest unused, unexpired quote **for the same kitchen, the same pricing row and
  the same address**, locks it and marks it used (one order per quote). The order's kitchen is the quote's kitchen.
- `record_delivery_quote()` refuses (40001, ask again) if the pricing row or the customer's address changed while the
  distance was computed, so a quote always belongs to the address that was routed.
- A still-valid quote (more than 2 minutes left) is returned again without a provider call; otherwise one call costs
  one Geocoding and one Routes request. No per-customer rate limit exists yet (open decision 9).
- 25 MAD is a fee cap, **not a coverage radius**: no district or distance limit exists. Coverage stays the delivery
  zone (city) check of `20261107120000_v1_delivery_zones.sql`.

### Examples (owner values, tested: SQL F01–F03, Q04, Q06)

| Road distance | 8 + 1.5 d | Capped | Fee |
|---|---|---|---|
| 0.1 km | 8.15 | 10 | **10** |
| 1 km | 9.50 | 10 | **10** |
| 3 km | 12.50 | 12.50 | **13** (half up) |
| 4.326 km | 14.489 | 14.489 | **14** |
| 4.334 km | 14.501 | 14.501 | **15** |
| 5 km | 15.50 | 15.50 | **16** |
| 8 km | 20.00 | 20 | **20** |
| 10 km | 23.00 | 23 | **23** |
| 10.6 km | 23.90 | 23.90 | **24** |
| 11.4 km | 25.10 | 25 | **25** |
| 15 km | 30.50 | 25 | **25** |
| 0 km, negative, missing | — | — | **refused** (22023) |

The minimum (10 MAD) applies below 1.33 km; the maximum (25 MAD) from 11.33 km.

## 3. Taxes (TVA)

- Every product belongs to a tax category (`meals.tax_category`, default `restaurant_food`). The service fee and the
  delivery fee each have their own category (`pricing_policies.service_fee_tax_category` / `delivery_fee_tax_category`).
  New categories (e.g. drinks, packaged goods) are rows in `tax_categories`; several can be used in one order.
- Seeded (all `pending_confirmation`): `restaurant_food` 10 % **proposed**, `service_fee` and `delivery_fee` **without
  rate**. `create_order()` refuses (55000 « ordering is not open ») until every category an order uses is `approved`
  (rate + approver + reference + date, audited). No rate is assumed for the fees.
- Split of a TTC amount: `HT = round(TTC / (1 + rate), 2)`, `TVA = TTC − HT` (so HT + TVA = TTC exactly).
  100.00 at 10 % → **90.91 + 9.09**; 50 → 45.45 + 4.55; 35 → 31.82 + 3.18.
- Fees are final amounts (TTC); their split uses their own category's rate once approved.

### Rounding policy (tested: F02, F10, F11, O02, O03)

| Amount | Rule |
|---|---|
| Delivery fee | `round(x, 0)` of the capped formula — PostgreSQL rounds `numeric` half away from zero = half up here |
| Line TTC | `round(unit TTC × quantity, 2)` |
| Line / fee HT | `round(TTC / (1 + rate), 2)` |
| Line / fee TVA | `TTC − HT` |
| Order HT, TVA | sums of the line values (no re-rounding) |
| Total | subtotal + service fee + delivery fee (after the offer) |

All amounts are `numeric` with a fixed scale: MAD `numeric(8,2)`/`numeric(12,2)`, km `numeric(8,3)`, rate `numeric(6,4)`.
The app sums display amounts in centimes (`src/checkout/checkoutSummary.ts`) and never computes the charged amount.

## 4. Order snapshot

Written once by `create_order()`, never changed afterwards (workflow guard + `order_items_tax_snapshot_guard`):

- **Line** (`order_items`): meal id, name, quantity, unit price TTC (`price`), `line_total_ttc`, `tax_category`,
  `tax_rate`, `line_ht`, `line_tva`.
- **Order** (`orders`): `subtotal`, `products_ht`, `products_tva`; `platform_service_fee` + `service_fee_tax_category/
  rate/ht/tva`; `delivery_fee` (after the offer), `delivery_fee_before_discount`, `delivery_discount` +
  `delivery_fee_tax_category/rate/ht/tva`; `kitchen_id`, `delivery_distance_km`, `delivery_formula_version`,
  `delivery_quote_id`, `pricing_policy_id`, `pricing_config_version`, `total`, `priced_at`.
- The audit row `order_created` repeats the distance, quote, pricing row, config version and city.
- A later menu price, tax rate or pricing row never changes a created order (SQL X03).

### Worked example (SQL O01–O06)

Customer in Casablanca, 4.326 km by road from Kitchen A, first order; test rates food 10 %, a test product category 20 %,
fees 20 % (**test fixtures, not accountant rates**):

| Line | Qty | Unit TTC | TTC | Rate | HT | TVA |
|---|---|---|---|---|---|---|
| Sans info | 2 | 50 | 100.00 | 10 % | 90.91 | 9.09 |
| Bol poulet | 1 | 35 | 35.00 | 10 % | 31.82 | 3.18 |
| Jus (test category) | 1 | 12 | 12.00 | 20 % | 10.00 | 2.00 |
| **Products** | | | **147.00** | | **132.73** | **14.27** |
| Service fee | | | 3.00 | 20 % | 2.50 | 0.50 |
| Delivery (14, offered) | | | 0.00 | 20 % | 0.00 | 0.00 |
| **Total = cash due** | | | **150.00** | | | |

Second order, 5 km, 1 × 50 MAD: 50 + 3 + 16 = **69 MAD**; delivery 16 at 20 % = 13.33 + 2.67.

## 5. Who may do what

| Object | Customers | Admin (app) | service_role (Edge Function) | Owner (role postgres) |
|---|---|---|---|---|
| `pricing_policies` | read the active row | read | — | insert; deactivate (never edit/delete), audited |
| `tax_categories` | — | — | — | insert/approve/change rate, audited; never delete |
| `delivery_quotes` | — | — | only via `delivery_quote_context()` / `record_delivery_quote()` | — |
| `create_order()` | execute (own account) | — | — | — |
| order prices, fees, taxes, totals | — | — (refused by the workflow guard) | — | — (guarded) |

The pricing engine adds no client policy and no client-callable definer function: the Phase 1C monitor stays
`fc876c08…` (checked by the migration and the harness).

## 6. Activating pricing (owner and accountant actions, in order)

Nothing below has been done. All of it is on the hosted project only with explicit owner approval.

1. Apply the migrations (DECISIONS #34, #36, #37): order workflow → create_order → delivery zones → pricing engine.
2. Accountant: approve each tax category (role postgres, audited):
   ```sql
   update public.tax_categories
      set rate = <rate>, status = 'approved', approved_by = '<accountant>', approval_reference = '<reference>', approved_at = now()
    where code = '<restaurant_food | service_fee | delivery_fee>';
   ```
3. Owner: insert Kitchen A's pricing row with its dispatch point (values of the 2026-11-07 proposal):
   ```sql
   insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at,
     config_version, delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee, delivery_max_fee,
     origin_latitude, origin_longitude)
   select id, 3, 'included_in_menu_prices', '<approver>', '<decision reference>', now(),
          'v1-2026-11', 'v1_road_km', 8, 1.5, 10, 25, <kitchen A latitude>, <kitchen A longitude>
     from public.kitchens where code = 'A';
   ```
4. Google Cloud: a key restricted to the Geocoding API and the Routes API (server key, no app restriction), stored as
   the Edge Function secret `ROUTING_API_KEY`; deploy `quote-delivery`.
5. Staging walkthrough (checklist H10), then `CHECKOUT_OPEN = true` in a reviewed change.

## 7. Open decisions (exact list)

Accountant:
1. TVA rate and status of restaurant food (10 % proposed) — `restaurant_food`.
2. Tax classification and rate of the **service fee** — `service_fee` (no rate set).
3. Tax classification and rate of the **delivery fee** — `delivery_fee` (no rate set).
4. Whether any menu item needs another category (drinks, packaged goods), and its rate.
5. Whether a TVA breakdown must appear on the customer's receipt or invoice (not built).

Owner:
6. Kitchen A's dispatch coordinates (origin of every distance).
7. Routing provider and key (Google Routes + Geocoding proposed; billing account), and travel mode (`DRIVE` used; a
   two-wheeler mode is not used).
8. Destination: server geocoding of the typed address (implemented) or the customer's map pin with a consistency check.
9. Quote validity (15 minutes implemented) and a per-customer limit on new quotes (provider cost; not built).
10. Delivery radius / profitability: **no radius exists**. A customer whose profile says Casablanca is quoted up to 200 km
    at 25 MAD maximum (e.g. an address 40 km away pays 25 MAD). Decide a maximum road distance or districts
    (DECISIONS #7).
11. Minimum order: not approved, not implemented (the previous model's `minimum_subtotal` was removed).
12. First-order free delivery now waives a distance-based fee (up to 25 MAD): confirm (DECISIONS #2).
13. Driver commission (today 15 % of the delivery fee in the driver screens) is not changed by this work (DECISIONS #11).

## 8. Tests

`bash supabase/tests/run_v1_pricing_engine.sh` (Docker): generated blocks; refusals (no zones migration, wrong role,
weakened monitor, existing pricing rows, a tax category approved inside the migration); migration (monitor unchanged,
pending seeds, no pricing row, re-run refused); 40 SQL tests (formula, rounding, caps, zero/negative, TTC→HT/TVA, rates,
server-only objects, closed without pricing, quotes: context, refusals (incl. an address changed during routing), reuse, metre precision; taxes pending → closed;
priced order with forged keys ignored, line and order snapshot, idempotency, one order per quote; address change,
expiry, kitchen-specific distance, replaced pricing row, unserved city; tampering by customer/admin/owner role;
history; COD lifecycle); concurrency (4 identical requests → 1 order; two orders racing for one quote → one wins);
regressions (order workflow 66, account deletion 10, standalone 42, Phase 1C); rollback with priced orders, zones
rollback after it, re-apply. Jest: `quoteDelivery.test.ts` (Edge Function core, fail closed), `pricingDisplay.test.ts`,
`checkoutCreateOrder.test.tsx`, `checkoutScreen.test.tsx`. The create_order and zones SQL suites target their own
migrations (previous pricing columns) and still pass with their harnesses.
