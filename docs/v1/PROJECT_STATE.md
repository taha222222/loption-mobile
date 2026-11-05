# L'OPTION — project state

Update this file incrementally when the state changes. Last verified: 2026-11-03 (production hardening: Android release build, all harnesses, hosted read-only checks).

## Current branch
- **Latest: `claude/v1-create-order`** = order workflow + checkout lockdown (Place Order disabled, no client order
  writes) + trusted `create_order()` (`20261106120000_v1_create_order.sql`, **not applied**; owner-approved pricing table,
  empty). Checkout opens only after #34, #36 and pricing approval (`ORDER_WORKFLOW.md`).
- Previous: `claude/v1-order-workflow` = `claude/v1-readiness-pdf` + the delivery order
  workflow enforced by the database (`ORDER_WORKFLOW.md`; migration `20261105120000_v1_order_workflow.sql`, **not
  applied**), driver/admin/customer screens moved to the workflow functions. Decisions of 2026-11-05 in DECISIONS.
- Previous: `claude/v1-gps-live-map` = `claude/v1-production-hardening` + live GPS map for walk,
  run, cycling and hiking (hiking saved as a walk), pre-start locating, current pace/speed, calorie preview mirroring
  the server, race-free background fix buffer, recovery after the system closes the app, Android map only with a Maps
  key (`STANDALONE_TRACKING.md` §5a–5b, `DEVICE_TEST_PROCEDURES.md` §4 G1–G17). No migration; nothing on hosted.
- Previous: `claude/v1-production-hardening` = `claude/v1-standalone-applied` + hardening: per-account phone history
  guard, revoked-access and offline/stale states, measured Android reading stats, in-app account deletion
  (`20261104120000_v1_account_deletion.sql`, **not applied to the hosted project**), unused Android permissions removed,
  calorie-engine tests, privacy/store drafts (`PRIVACY_AND_STORE_RELEASE.md`) and device procedures
  (`DEVICE_TEST_PROCEDURES.md`). Full Android release build succeeds (E-28); Swift still not compiled.
- Previous: `claude/v1-standalone-tracking` = `claude/v1-rollout-loption-mobile` + standalone tracking: phone step
  counting without health apps (native module `modules/loption-motion`), background GPS during a workout, gym log,
  manual meals, BMR + movement budget, redesigned Daily Tracking (`STANDALONE_TRACKING.md`). Migration
  `20261103120000_v1_standalone_tracking.sql` is **applied to `loption-mobile` since 2026-11-03** (owner-authorized,
  evidence E-27).
- Previous cumulative branch: `claude/v1-baseline-server-fix` = `claude/v1-activity-expo-go-fix` + honest states when the server
  lacks the V1 migrations (the hosted project today). `claude/v1-activity-expo-go-fix` = `claude/v1-activity-tracking-final` (activity batches A `e49cb59`,
  B `447334e`, C `c35da39`, layout fixes `ca759f8`, docs) + the Expo Go fix (health libraries are loaded only when
  their native module exists), on `claude/v1-engineering-context` (`636fe26`). `claude/v1-activity-tracking` stops at
  `c35da39` and `claude/v1-activity-tracking-docs` before the last docs fix: the ruleset blocks pushes to existing
  branches, so each follow-up is pushed as a new branch.
- `main` is still `0cb0fe0` (initial commit). Nothing is merged.
- Results are in the evidence log of `REMAINING_SETUP_AND_RELEASE_TASKS.md` (latest: E-27 to E-33).
- **Hosted project `loption-mobile` (`teppcfnpkoxkudajnvad`) has all five V1 migrations since 2026-11-02** (owner-approved;
  initial admin `e898d986-…`; evidence E-22). Branch `claude/v1-rollout-loption-mobile` holds the admin-id commit.

## Integrated on the cumulative branch
| Feature | Status | Reference |
|---|---|---|
| Phase 1A client hardening, COD-only checkout | Merged into the branch | `PHASE1A_REPORT.md` |
| Phase 1B database audit | Merged into the branch | `PHASE1B_DATABASE_SECURITY_AUDIT.md` |
| Phase 1C rev 7 containment (migrations not applied anywhere) | Merged into the branch; NOT READY FOR STAGING | `PHASE1C_DATABASE_SECURITY_PLAN.md` |
| Redesign V2 + Expo SDK 58 | Merged into the branch | — |
| Auth (Google, Apple, e-mail verification), 5-step onboarding, BMR/TDEE, permissions | Implemented, local e2e only | `V1_ONBOARDING_AUTH_OFFER.md` |
| First-order free delivery (server enforcement, not yet called) | Implemented, local only | same |
| Calorie log, history chart, streaks, opt-in reminders, push dispatcher | Implemented, local only | `CALORIE_TRACKING_AND_ENGAGEMENT.md` |
| Daily Tracking tab (replaces the Cart tab; basket in headers), daily energy budget, Apple Health / Health Connect / iPhone motion sync, workouts (walk, run, cycling, gym), meals from delivered orders | Implemented; local tests and web e2e only; **no device or native build verification** | `ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md` |
| Standalone tracking: phone sensors first (Core Motion / Android step counter + background readings), background GPS during a workout, gym log, manual meals, BMR × 1.1 + movement budget, Daily Tracking redesign with Day/Week/Month charts | Implemented; Jest, SQL harness, web e2e, prebuild both platforms, Android Kotlin compile; **no device test, Swift not compiled** | `STANDALONE_TRACKING.md` |
| Production hardening: account switch guard, revoked/offline/stale states, reading stats, account deletion, store/privacy drafts | Implemented; Jest, all SQL harnesses, e2e, Android release build; deletion migration local only; **no device test** | `STANDALONE_TRACKING.md` §3a, `PRIVACY_AND_STORE_RELEASE.md` |
| Release checklist | Current at the hardening branch (M20, M21) | `REMAINING_SETUP_AND_RELEASE_TASKS.md` |

## Branches and PRs
`claude/*` branches stack in this order, each containing the previous one:
`v1-integration` → `v1-onboarding-auth` → `v1-onboarding-auth-react-refresh` → `v1-app-integration` →
`v1-release-checklist` → `v1-nutrition-tracking` → `v1-engineering-context` → `v1-activity-tracking` →
`v1-activity-tracking-docs` → `v1-activity-tracking-final` → `v1-activity-expo-go-fix` → `v1-baseline-server-fix`. None has a PR.

Open PRs (none merged):

| PR | Branch → base | Content |
|---|---|---|
| 1 | `claude/phase-1c-amended-containment` → `main` | Phase 1C rev 4 (draft, do not merge) |
| 2 | `phase-1c-revision-5-review` → PR 1's branch | Phase 1C rev 5 |
| 3 | `phase-1c-revision-6` → PR 2's branch | Phase 1C rev 6 |
| 4 | `phase-1c-revision-7` → PR 3's branch | Phase 1C rev 7 |
| 5 | `claude/project-thread-vwywnk` → `main` | Redesign V2 |
| 6 | `claude/project-thread-d76qjv` → PR 5's branch | Expo SDK 58 |

Other remote branches: `claude/phase-1a-client-hardening`, `claude/phase-1b-db-security-audit` (both included in
the V1 stack), `claude/peaceful-shannon-ewahm3` (superseded Phase 1C package), `claude/project-thread-22g0b4`
(same commit as PR 6), `claude/pensive-cori-mwrtog` (unrelated KS Medical tool).
The repository ruleset covers all branches: PR + 1 approving review, no bypass, so push only new branches.

## Active priorities
1. Get the V1 stack reviewed: Phase 1C first, then the three V1 migrations, then the app.
2. First EAS development builds and the device checklists of `STANDALONE_TRACKING.md` §9 and
   `ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md` §10; owner approval of the calorie-engine constants (DECISIONS).
3. Remove remaining fake data from customer screens (checklist I1, I3).
4. Owner decisions and credentials that unblock staging (`DECISIONS.md`, checklist A–C, H, L, M).
5. Trusted server-side order creation once pricing is approved (checklist H4–H10).

## Blockers
- Phase 1C has still had no independent review (applied on the owner's decision, E-22); meal-images finding M2 open.
- Hosted advisors after E-22: leaked-password protection is off (Dashboard → Auth, owner action); three legacy
  functions without a fixed `search_path` (not client-executable; untouched by V1).
- No Google, Apple, Resend, APNs or FCM credentials; real sign-in, e-mail and push never tested.
- Android: a full `assembleRelease` succeeds (E-28, debug-key signed, never installed). iOS: never compiled (no Xcode
  here; the first EAS iOS build is also the first Swift compile). No EAS build (no Expo token). HealthKit capability, Health Connect and activity-recognition /
  location-foreground-service Play declarations and privacy texts are owner actions (checklist M).
- Pricing, fees, TVA and minimum order not approved, so checkout cannot be enabled.
- No reviewer other than the author for PRs (ruleset needs 1 approval).
- Order lifecycle undecided: the app uses `delivered`, the staging schema allows `served` (both count as received).
- Lint: 45 pre-existing errors (none in new files). `expo install --check` is up to date (react-native 0.88.1).

## Exact next task
With EAS access: build development clients and run `DEVICE_TEST_PROCEDURES.md` (checklist M15–M18). Owner: approve the
budget constants (DECISIONS #19), authorize the account deletion migration (#23), decide Apple Health / Health Connect
at launch (#20) and start the CNDP / store declarations (`PRIVACY_AND_STORE_RELEASE.md` §6). Without it, checklist I1: replace the hard-coded "next delivery" and "last order" cards in `app/(app)/profile.tsx` with the
customer's real orders (RLS-scoped read) or an empty state, with Jest tests and an e2e check. Leave the "Mon plan",
upgrade and offers cards unchanged until the owner decides I3 (hide out-of-scope screens).
