---
name: loption-business-logic
description: L'OPTION business rules — order lifecycle and transitions, customer accounts and first-order benefit, product/customization pricing, delivery fee formula, service fee and TVA, delivery zones and kitchen assignment, cash on delivery, cancellation/rejection/refund, role responsibilities. Use whenever a task depends on what the business allows (checkout, pricing, order statuses, permissions, promotions, zones) or when rules look contradictory. Not for writing SQL or UI by itself.
---

# L'OPTION business logic

The guardian of business rules. It **reads and cites** the source of truth; it never invents a rule and never
silently picks one side of a contradiction.

## Use when
- A task asks "what should happen when…", or changes behaviour that customers, staff or money depend on.
- Checkout, pricing, fees, promotions, first-order benefit, zones, order statuses, cancellations, refunds, roles.
- Before any other specialist skill implements a rule (backend, kitchen, driver, cashier, app).

## Not for
- Implementation details (use `supabase-backend-architect`, `expo-react-native-engineer`).
- Operational procedures of one role (use the kitchen / driver / cashier skills, which defer to this one).

## Sources (authoritative, in this order)
1. `docs/v1/DECISIONS.md` — confirmed / proposed / open owner decisions with dates.
2. `docs/v1/business/README.md` — index and status labels (CONFIRMED, IMPLEMENTED local/hosted, PROPOSED, UNKNOWN).
3. Topic files: `docs/v1/business/order-lifecycle.md`, `roles-and-permissions.md`, `kitchen-assignment.md`,
   `delivery-and-cash.md`, `exceptions.md`; pricing: `docs/v1/V1_PRICING_SPECIFICATION.md`
   (summary `docs/v1/business/pricing-summary.md`).
4. Accounts and the first-order offer: `docs/v1/V1_ONBOARDING_AUTH_OFFER.md`, `docs/v1/AUTH_PROVIDER_SETUP.md`.
5. The code is evidence of **implemented** behaviour, not of decisions: `public.order_transitions()`,
   `public.checkout_price()`, `public.first_order_offer_status_for()` in `supabase/migrations/`.

## Rules of engagement
- Quote the rule with its status and source (e.g. "CONFIRMED, DECISIONS 2026-11-05"; "IMPLEMENTED local only").
- If the request contradicts a confirmed decision, stop and say so; list both versions; ask the owner. Examples
  already known: driver self-claiming vs cashier assignment; kitchen rejection (not in the lifecycle); "failed orders
  must not consume the first-order benefit" vs the implemented rule (#48).
- UNKNOWN stays UNKNOWN: record the question in `docs/v1/DECISIONS.md` "Needs owner approval" with a number.
- A rule changes in one place: the business file (or the pricing spec) + a dated `DECISIONS.md` row. Skills link,
  they do not restate.
- Prices, fees, discounts, TVA, eligibility and payment state are decided by the server; the client only displays.

## Workflow
1. Identify the rules the task touches; read the authoritative file for each.
2. Classify each: CONFIRMED / IMPLEMENTED (local or hosted) / PROPOSED / UNKNOWN.
3. List contradictions and gaps; for each, the owner question.
4. Hand implementation to the relevant skills with the exact rule text and status.
5. After implementation, update the business file status (e.g. PROPOSED → IMPLEMENTED local) and `DECISIONS.md`.

## Required tests
Every rule implemented must have a test that would fail if the rule changed (see `loption-qa-testing`): a SQL test for
server rules, a Jest test for display rules. Owner examples (e.g. 65 + 35 at 5 km → 100 then 119) must be tests.

## Completion report
- Rules applied, each with status and source.
- Contradictions found and how they were handled (owner question raised, nothing assumed).
- Files updated (`docs/v1/business/*`, `DECISIONS.md`).
- Open owner decisions with their numbers.
