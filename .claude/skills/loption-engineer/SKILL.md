---
name: loption-engineer
description: Entry point for L'OPTION engineering work when unsure which specialist skill applies — routes to the business, backend, order-operations, kitchen, driver, cashier, app and QA skills. Use at the start of a feature, bug fix, migration, security or release task to pick the right skills; skip for pure copy edits.
---

# L'OPTION engineering — router

This skill no longer holds rules (they moved to the specialist skills so each rule has one home). Load the skills
the task needs, often several:

| Task | Load |
|---|---|
| Business rule, pricing, fees, zones, first-order benefit, contradictions | `loption-business-logic` |
| Schema, RLS, functions, Edge Functions, migrations, security | `supabase-backend-architect` |
| Order statuses, transitions, anything spanning roles | `loption-order-operations` |
| Kitchen queue / preparation | `loption-kitchen-operations` (+ order operations) |
| Driver screens, assignment, location, delivery exceptions | `loption-driver-operations` (+ order operations) |
| Cashier, payment records, cash, refunds | `loption-cashier-finance` (+ order operations) |
| Screens, navigation, stores, builds | `expo-react-native-engineer` |
| Tests, evidence, "is it ready?" | `loption-qa-testing` (always, before calling work done) |

Typical combinations:
- Checkout: business logic + backend + app + QA.
- Driver work: order operations + driver + backend + QA.
- Kitchen work: order operations + kitchen + backend + QA.
- Cashier work: order operations + cashier finance + backend + QA.
- Customer screens: business logic + app + QA.

Domain references that are not order-related (unchanged): nutrition and reminders
`docs/v1/CALORIE_TRACKING_AND_ENGAGEMENT.md`; activity `docs/v1/ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md`,
`docs/v1/STANDALONE_TRACKING.md`; auth and onboarding `docs/v1/V1_ONBOARDING_AUTH_OFFER.md`,
`docs/v1/AUTH_PROVIDER_SETUP.md`; Phase 1C `docs/v1/PHASE1C_DATABASE_SECURITY_PLAN.md`; privacy and stores
`docs/v1/PRIVACY_AND_STORE_RELEASE.md`.

## Required tests
Those of the skills loaded; always finish with `loption-qa-testing`.

## Completion report
Use the completion report of each skill loaded, plus the list of skills used.
