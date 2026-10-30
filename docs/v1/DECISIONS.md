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
| 1 | Delivery fee, service fee, TVA, minimum order (legacy 15 / 10 / 19 MAD values conflict; Phase 0 asked about 8 MAD service fee) | H1–H3 |
| 2 | First-order offer rules: eligibility, which order statuses release it, minimum order, expiry, stacking | G |
| 3 | Goal-based calorie targets (loss/gain) and whether to keep collecting `goal` | L, `V1_ONBOARDING_AUTH_OFFER.md` §7 |
| 4 | Reminder cadence above | L |
| 5 | Minimum age; whether minors get estimates and reminders | C7, L12 |
| 6 | Account linking across providers (Apple relay addresses) | C |
| 7 | Delivery zones | F |
| 8 | Customer language: FR only or FR/EN/AR | I9 |
| 9 | Hide out-of-scope screens (upgrade, my-plan, reorder, subscription deep link) | I3, Phase 0 X1 |
| 10 | Phase 1C: independent review, initial-admin UUID, staging gates, meal-images (M2) mitigation | J |
| 11 | Driver pay and cash handling | `PHASE0_AUDIT.md` §4 |
| 12 | Optional: a licensed custom notification sound (the missing reference was removed) | E |
| 13 | Activity notifications (daily movement update, workout completed, weekly summary): each adds notifications, not implemented | L |
| 14 | Retention period for health and activity data (no automatic purge yet) | M |
| 15 | Background GPS during a workout (needs "Always"/foreground-service declarations in both stores); today GPS is foreground-only | M |
| 16 | MET tiers and the received-order statuses above | M, H10 |
