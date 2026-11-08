# L'OPTION — business source of truth

One authoritative place per topic. Skills and other docs **link here instead of restating rules**. If a rule
changes, change it in the authoritative file below and in `docs/v1/DECISIONS.md` (with date and source), nowhere else.

| Topic | Authoritative file |
|---|---|
| Owner decisions (confirmed / proposed / open, with dates) | [`../DECISIONS.md`](../DECISIONS.md) |
| Order lifecycle, transitions, failure paths, audit | [`order-lifecycle.md`](order-lifecycle.md) |
| Roles and permissions | [`roles-and-permissions.md`](roles-and-permissions.md) |
| Pricing, fees, TVA, promo codes, first-order benefit | [`../V1_PRICING_SPECIFICATION.md`](../V1_PRICING_SPECIFICATION.md) (summary in [`pricing-summary.md`](pricing-summary.md)) |
| Delivery zones and kitchen assignment | [`kitchen-assignment.md`](kitchen-assignment.md) |
| Driver delivery, cash on delivery, cash reconciliation | [`delivery-and-cash.md`](delivery-and-cash.md) |
| Cancellation, rejection, refund, failed delivery | [`exceptions.md`](exceptions.md) |
| How the order workflow is implemented (functions, RLS, tests) | [`../ORDER_WORKFLOW.md`](../ORDER_WORKFLOW.md) |
| What is open before release | [`../NOT_DONE_YET.md`](../NOT_DONE_YET.md), [`../REMAINING_SETUP_AND_RELEASE_TASKS.md`](../REMAINING_SETUP_AND_RELEASE_TASKS.md) |

## Status labels used in these files

- **CONFIRMED** — owner decision with a written source (`DECISIONS.md` row, owner message date).
- **IMPLEMENTED** — present in the repository, with the file that implements it. Always says **where it runs**:
  *local only* (migration not applied to the hosted project) or *hosted*.
- **PROPOSED** — written down, awaiting owner approval (`DECISIONS.md` "Needs owner approval").
- **UNKNOWN** — not decided and not implemented, or not verified. Never fill these in by assumption.

## Hosted vs local (as recorded, not re-verified in this audit)

Per `PROJECT_STATE.md`: the hosted project `loption-mobile` has Phase 1C, the onboarding/offer, nutrition, activity and
standalone-tracking migrations. **Not applied to hosted:** account deletion (`20261104…`), order workflow (`20261105…`),
create_order (`20261106…`), delivery zones (`20261107…`), pricing engine (`20261108…`), checkout experience (`20261109…`),
order lifecycle hardening (`20261110…`).
Version numbers `20261109…` and `20261110…` are dated after the day they were written (2026-11-08): any new migration
must sort after `20261110120000`, and renumbering before the first hosted application is an owner decision (#59).
Everything about the delivery order workflow below is therefore **local only** until the owner approves applying it
(DECISIONS #23, #34, #36, #37). Checkout in the app is closed (`src/checkout/checkoutAvailability.ts`, `CHECKOUT_OPEN = false`).
