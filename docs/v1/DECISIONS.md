# L'OPTION — decisions

Only record a decision as confirmed when its source is written down (doc, commit or owner message). Add new ones
with date and source. Details live in the linked docs; do not copy them here.

## Confirmed
| Decision | Source |
|---|---|
| Company-owned kitchens; Kitchen A (Casablanca) is the first; staff roles `admin`, `support`, `cashier`, `kitchen_staff`, `driver` in one server-managed `staff_roles` table | Owner project brief; `PHASE1C_DATABASE_SECURITY_PLAN.md` §2 |
| Partner (collaborator) write model retired; existing rows kept | `PHASE1C_DATABASE_SECURITY_PLAN.md` §2 |
| Initial administrator is an owner-supplied `auth.users` id, never derived from profiles | same |
| V1 payment is cash on delivery only; card removed | CTO follow-up, `PHASE1A_REPORT.md` §6 |
| Phase 1C rev 7 is NOT READY FOR STAGING; checkout stays disabled | CTO verdict 2026-10-25, `PHASE1C_DATABASE_SECURITY_PLAN.md` |
| Sign-in with Google, Apple and e-mail with verification; 5-step onboarding (sex input incl. "prefer not to say", age, weight, height, activity); Mifflin–St Jeor BMR/TDEE | Owner task brief, 2026-10-28 |
| First order gets free delivery, enforced by the server | Owner task brief, 2026-10-28 (rules still open, below) |
| Daily target = TDEE when no goal policy is approved; tracking reminders are opt-in | Owner Phase 2 brief, 2026-10-29 |
| Daily Tracking replaces the Cart tab; the cart stays reachable from a header basket; checkout stays disabled | Owner activity brief, 2026-10-30 |
| Daily energy budget: platform total energy, else BMR + platform active energy, else the TDEE baseline; never TDEE + steps + workouts; remaining not clamped | Owner activity brief, 2026-10-30 ([details](ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md#5-daily-energy-calculation)) |
| Health permissions optional and read-only; GPS only during a workout the customer started; no sharing or public feed in this phase | Owner activity brief, 2026-10-30 |
| A meal from an order counts only after delivery, never automatically, never beyond the ordered quantity | Owner activity brief, 2026-10-30 |
| Delivery order state machine pending → confirmed → preparing → ready → picked_up → on_the_way → delivered (+ cancelled), enforced by the database; historical counter orders frozen | Owner order brief, 2026-11-05 ([ORDER_WORKFLOW.md](ORDER_WORKFLOW.md)) |
| Cash on delivery: the cashier confirms the ORDER (payment stays pending); the cashier records the payment after delivery (paid/failed, refund later) | Owner answer, 2026-11-05 |
| The cashier (or an admin) assigns drivers; drivers see only orders assigned to them | Owner answer, 2026-11-05 |
| Cancellation: the customer while pending; cashier/admin until ready with a reason; nobody after pickup | Owner answer, 2026-11-05 |
| At most one active staff role per user (customers hold none); kitchen scoping kept | Owner answer, 2026-11-05 |
| `order_status_updates` (customer timeline) records status changes only; driver assignment and payment changes are audit-only (`security_audit_log`); driver location history stays separate from both | Owner approval, 2026-11-05 |
| Checkout disabled (Place Order button off, no client-side order writes) until `public.create_order()` exists with approved pricing | Owner approval, 2026-11-05 |
| Delivery at launch: Casablanca only; a customer in another city keeps their address and is told delivery is not available in their city yet; other cities open later | Owner answer, 2026-11-06 |
| One kitchen at launch: Kitchen A (serves the Casablanca zone) | Owner answer, 2026-11-06 |
| Order notifications come in a later phase | Owner answer, 2026-11-06 |
| V1 pricing: service fee 3 MAD per order; delivery fee `round_half_up(min(25, max(10, 8 + 1.5 × road km)))` from the order's kitchen (server-side road distance, no straight-line fallback); menu prices TTC; TVA never added at checkout; total = products + service + delivery = cash due. Applied as data (pricing row), not code | Owner proposal, 2026-11-07 ([V1_PRICING_SPECIFICATION.md](V1_PRICING_SPECIFICATION.md)) |
| No minimum order in V1 (not approved; removed from the pricing model) | Owner proposal, 2026-11-07 |
| Restaurant TVA 10 % is a **proposal pending the accountant**; the service- and delivery-fee tax classifications are pending and have no rate; checkout stays blocked until they are approved | Owner proposal, 2026-11-07 |
| First qualifying order: service fee 0 and delivery fee 0; later orders: 3 MAD service fee + road-distance delivery fee. Qualifying = the server's first-order rule (cancelled orders do not use it), never a client flag | Owner brief "Product detail, customization & checkout", 2026-11-07 ([spec §8](V1_PRICING_SPECIFICATION.md)) |
| Product page with meal choices configured in the database (required/optional, paid extras); the same meal with other choices is another cart line | same |
| Checkout steps: confirmed delivery address (a position only suggests it), phone verified by a WhatsApp code, server-priced summary with promo code, "Confirmer la commande" (cash on delivery only); the final total is shown before confirming and checked by the server | same |
| Popularity messages only from real orders (distinct customers who received the meal); no fake urgency, scarcity or reviews | same |

## Proposed, not approved
| Proposal | Where |
|---|---|
| Reminder cadence: off until opt-in, daily 12:00, progress 16:00, evening 20:30, quiet hours 22:00–08:00, ≤ 2 per day, 120-min window, re-engagement after 3 days (7-day cooldown, ≤ 2 per 30 days) | `CALORIE_TRACKING_AND_ENGAGEMENT.md` "Proposed default cadence" |
| Streak milestones at 7, 14, then every 30 days; no points or rewards | same |
| Onboarding input ranges (age 13–100 etc.) are data validation only, not an age policy | `REMAINING_SETUP_AND_RELEASE_TASKS.md` C7 |
| Phase 1C staging compatibility test plan | `PHASE1C_DATABASE_SECURITY_PLAN.md` §7b |
| Disable "Place Order" with an explanation until checkout is ready | checklist H11 |
| Order statuses that mean "received": `delivered` (app driver flow) and `served` (counter flow); `delivered` is not allowed by the staging `orders_status_check` | `order_received()` in the activity migration; checklist H10 |
| Workout MET tiers (Compendium 2011, net of rest) and the plausibility limits (walk 3.5, run 7, cycle 25 m/s) | `ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md` §7 |
| Platform total energy is ignored when below BMR; activity data older than 120 min today is shown as stale; sync window 7 days, write window 30 days | same, §4–§5 |
| App vs imported duplicate rule: same kind, ≥ 50 % overlap; measured provider > provider > app | same, §6 |
| No step goal (no settings for it exist; actual steps shown without a goal) | same, §1 |
| Standalone budget (no health app): BMR × 1.1 (rest + digestion) + 0.5 kcal per kg per km walked (steps outside recorded walks/runs) + workout MET estimates; a workout alone keeps the TDEE baseline | `STANDALONE_TRACKING.md` §4 |
| Gym intensity MET: light 3.5, moderate 5.0, vigorous 6.0 (Compendium 2011 02054 / 02052 / 02050); walking stride 0.415 × height | same |
| GPS route kept on the device only (distance uploaded); elevation not shown; Android step readings every ~15 min in the background; no hydration tracking | same, §1, §5 |
| Manual meals: the customer's own calories are accepted for food from outside L'OPTION, labelled "saisi par vous" (1–3 000 kcal per portion) | same, §6 |
| Custom notification sound: the unused, missing `notification.wav` reference was removed so native builds work; a licensed sound can be added later | `app.json`, 2026-10-30 |

## Security constraints (always apply)
- No secret in the app, in `EXPO_PUBLIC_*` or in git; the Resend key lives only in Supabase SMTP / server secrets.
- No change to hosted Supabase, production, provider dashboards or customer data without explicit approval.
- RLS is never weakened; client grants are column-level and owner-only; `containment_violations()` stays at 0.
- Prices, fees, discounts, calories and payment state are server-computed; clients cannot submit them.
- No force-push, history rewrite, merge into `main` or ruleset bypass.
- Never claim real push or e-mail delivery without a real test.

## Needs owner approval
| # | Decision | Checklist |
|---|---|---|
| 1 | ~~Delivery fee, service fee, minimum order~~ — owner proposal 2026-11-07 (see Confirmed). Open: the tax items #38–#40 | H1–H3 |
| 2 | First-order offer rules: eligibility, which order statuses release it, minimum order, expiry, stacking | G |
| 3 | Goal-based calorie targets (loss/gain) and whether to keep collecting `goal` | L, `V1_ONBOARDING_AUTH_OFFER.md` §7 |
| 4 | Reminder cadence above | L |
| 5 | Minimum age; whether minors get estimates and reminders | C7, L12 |
| 6 | Account linking across providers (Apple relay addresses) | C |
| 7 | ~~Delivery zones~~ — decided 2026-11-06 (Casablanca only at launch; see Confirmed). Open: exact boundary rules beyond the city (districts, distance) | F |
| 8 | Customer language: FR only or FR/EN/AR | I9 |
| 9 | Hide out-of-scope screens (upgrade, my-plan, reorder, subscription deep link) | I3, Phase 0 X1 |
| 10 | Phase 1C: independent review, initial-admin UUID, staging gates, meal-images (M2) mitigation | J |
| 11 | Driver pay and cash handling | `PHASE0_AUDIT.md` §4 |
| 12 | Optional: a licensed custom notification sound (the missing reference was removed) | E |
| 13 | Activity notifications (daily movement update, workout completed, weekly summary): each adds notifications, not implemented | L |
| 14 | Retention period for health and activity data (no automatic purge yet) | M |
| 15 | Background GPS during a workout is implemented with "while in use" permission only (iOS location background mode, Android location foreground service): needs the Play foreground-service declaration (demo video) and the App Store justification | M17 |
| 16 | MET tiers and the received-order statuses above | M, H10 |
| 17 | Enable leaked-password protection in Supabase Auth (hosted advisor, 2026-11-02) | C |
| 18 | Legacy functions `calculate_collaborator_revenue_split`, `update_collaborator_analytics`, `calculate_driver_weekly_earnings`: fix their `search_path` or drop them (not client-executable since Phase 1C) | J |
| 19 | Approve the standalone budget constants and gym MET values above (the migration itself was applied to `loption-mobile` on the owner's instruction, 2026-11-03) | M19 |
| 20 | Apple Health and Health Connect at launch: keep them (HealthKit capability + App Review; Play Health Connect declaration) or remove the plugins and permissions (phone sensors alone work) | `PRIVACY_AND_STORE_RELEASE.md` §2.4, §3.2 |
| 21 | Whether Law 09-08 requires a separate, explicit health-data consent screen before the nutrition profile and activity tracking (not implemented) | K9, `PRIVACY_AND_STORE_RELEASE.md` §5 |
| 22 | Account deletion keeps orders for accounting with the account link removed: must the order contact fields (name, phone, address) also be anonymised, and after how long? Offer redemptions are deleted with the account (cascade) | M20 |
| 23 | Authorize applying `20261104120000_v1_account_deletion.sql` to `loption-mobile` (store requirement; tested locally only) | M20 |
| 24 | Workout routes stay on the device (only the distance is uploaded). Storing routes on the server needs an explicit decision, a retention period and a privacy update | M17 |
| 25 | Hiking: today saved as a walk (walking MET by speed) and labelled "Randonnée" on the phone only. A real `hike` kind needs a migration (kind check, max speed) and an approved hiking MET (none is invented) | `STANDALONE_TRACKING.md` §5a |
| 26 | Android workout notification has no Stop button (expo-location's foreground service supports title and text only; tapping returns to the app). A Stop action would need a separate native location service | §5a |
| 27 | Google Maps key for the Android live map: create it in Google Cloud, restrict it to `com.loption.app` + the EAS signing SHA-1 and the Maps SDK for Android, store it as EAS environment variable `GOOGLE_MAPS_ANDROID_API_KEY` (never in git). Without it Android shows the route without a map | §5a |
| 28 | Signing out discards activities not yet uploaded (account isolation); keep, or warn before sign-out when the upload queue is not empty | §5a |
| 29 | Keep the `support` staff role (read-only helpdesk) or remove it under "one role per user" | `ORDER_WORKFLOW.md` |
| 30 | Retention period for the driver location history (kept for audit; CNDP: limited duration required) | `ORDER_WORKFLOW.md`, F6 |
| 31 | Kitchen staff currently read the whole order row (incl. delivery address and customer name): accept, or serve the kitchen a reduced view | `ORDER_WORKFLOW.md` |
| 32 | Order notifications — owner 2026-11-06: to be added soon (not in this phase) (cashier: new order; kitchen: confirmed; driver: ready/assigned; customer: picked up, delivered) — not implemented | `ORDER_WORKFLOW.md` |
| 33 | Prepaid orders ("payment paid moves pending → confirmed") are not offered while V1 is cash on delivery only | `ORDER_WORKFLOW.md` |
| 34 | Authorize applying `20261105120000_v1_order_workflow.sql` to `loption-mobile` (after the account-deletion migration) | H12 |
| 35 | ~~Kitchen routing~~ — decided 2026-11-06: one kitchen (Kitchen A) at launch; each delivery zone names its kitchen when more open | F3 |
| 36 | Authorize applying `20261106120000_v1_create_order.sql` (after #34) and `20261107120000_v1_delivery_zones.sql`, then approve pricing (H1–H3) and open checkout | H4, F3 |
| 37 | Authorize applying `20261108120000_v1_pricing_engine.sql` (after #36) and `20261109120000_v1_checkout_experience.sql`; then insert Kitchen A's pricing row (needs #41) and deploy `quote-delivery` with its key (#42) | H1, H4 |
| 38 | Accountant: TVA rate of restaurant food (10 % proposed; category `restaurant_food`, pending) and whether other product categories (drinks, packaged goods) are needed | H3 |
| 39 | Accountant: tax classification and rate of the **service fee** (category `service_fee`, no rate) | H2, H3 |
| 40 | Accountant: tax classification and rate of the **delivery fee** (category `delivery_fee`, no rate); and whether receipts must show the TVA breakdown | H1, H3 |
| 41 | Kitchen A's dispatch coordinates (origin of every road distance) | H1 |
| 42 | Routing provider (Google Routes + Geocoding proposed), Google Cloud billing and a server key restricted to those APIs as Edge Function secret `ROUTING_API_KEY`; travel mode (`DRIVE` used) | H1, B |
| 43 | Delivery destination: server geocoding of the typed address (implemented; the app's map pin is not trusted for pricing) or the pin with a consistency check | H1 |
| 44 | Quote validity: 15 minutes (implemented); a per-customer limit on new quotes (each costs one Geocoding + one Routes call; not built) | H1 |
| 45 | Delivery radius and profitability: no maximum distance exists (the 25 MAD cap is not a radius); a profile set to Casablanca can be quoted up to 200 km for 25 MAD. Decide a maximum road distance or districts (see #7) | F3, H1 |
| 46 | First-order free delivery now waives a distance-based fee (up to 25 MAD): confirm (see #2); driver commission (15 % of the delivery fee in the driver screens) unchanged (see #11) | G, H1 |
| 47 | WhatsApp Business Platform: verified business, sending number, approved French authentication template; Edge Function secrets `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE`. Until then no number can be verified, so no order can be placed. Confirm that a verified phone is mandatory | H4, B |
| 48 | "Qualifying" first order = existing rule: any order not cancelled/rejected uses the benefit (also a delivered order whose cash payment failed, and a still-pending first order). Confirm | G1–G3 |
| 49 | Promo codes: once per customer; products only (fees excluded); stacking with the first-order benefit set per code; no code defined yet. Accountant: a discount reduces the lines' taxable amount (implemented proportionally) | G3, H3 |
| 50 | Meal descriptions and choices must be entered per meal (no admin screen yet; admins may write them through the API); choice prices are extras ≥ 0 (a removal never lowers the price) | I |
| 51 | Popularity shown from 10 customers who received the meal (counter orders without an account are not counted); wording « Déjà commandé par N clients » | I |
| 52 | Phone code parameters: 6 digits, 10 minutes, 5 attempts, 1 code per minute, 5 per hour per customer and per number; Moroccan mobiles (06/07) only, landlines refused | H4 |
