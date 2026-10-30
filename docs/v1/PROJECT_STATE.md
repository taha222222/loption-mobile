# L'OPTION — project state

Update this file incrementally when the state changes. Last verified: 2026-10-30.

## Current branch
- Working branch: `claude/v1-engineering-context`, branched from `claude/v1-nutrition-tracking` at `077952c`.
- `claude/v1-nutrition-tracking` contains all V1 work; `main` is still `0cb0fe0` (initial commit). Nothing is merged.
- Last full verification: `b5bf441`. Results are in the evidence log of `REMAINING_SETUP_AND_RELEASE_TASKS.md`.

## Integrated on `claude/v1-nutrition-tracking`
| Feature | Status | Reference |
|---|---|---|
| Phase 1A client hardening, COD-only checkout | Merged into the branch | `PHASE1A_REPORT.md` |
| Phase 1B database audit | Merged into the branch | `PHASE1B_DATABASE_SECURITY_AUDIT.md` |
| Phase 1C rev 7 containment (migrations not applied anywhere) | Merged into the branch; NOT READY FOR STAGING | `PHASE1C_DATABASE_SECURITY_PLAN.md` |
| Redesign V2 + Expo SDK 58 | Merged into the branch | — |
| Auth (Google, Apple, e-mail verification), 5-step onboarding, BMR/TDEE, permissions | Implemented, local e2e only | `V1_ONBOARDING_AUTH_OFFER.md` |
| First-order free delivery (server enforcement, not yet called) | Implemented, local only | same |
| Calorie log, history chart, streaks, opt-in reminders, push dispatcher | Implemented, local only | `CALORIE_TRACKING_AND_ENGAGEMENT.md` |
| Release checklist | Current at `b5bf441` | `REMAINING_SETUP_AND_RELEASE_TASKS.md` |

## Branches and PRs
`claude/*` branches stack in this order, each containing the previous one:
`v1-integration` → `v1-onboarding-auth` → `v1-onboarding-auth-react-refresh` → `v1-app-integration` →
`v1-release-checklist` → `v1-nutrition-tracking` → `v1-engineering-context`. None has a PR.

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
1. Get the V1 stack reviewed: Phase 1C first, then the two V1 migrations, then the app.
2. Remove remaining fake data from customer screens (checklist I1, I3).
3. Owner decisions and credentials that unblock staging (`DECISIONS.md`, checklist A–C, H, L).
4. Trusted server-side order creation once pricing is approved (checklist H4–H10).

## Blockers
- Phase 1C NOT READY FOR STAGING: initial-admin UUID missing, staging gates, meal-images finding M2 open.
- No Google, Apple, Resend, APNs or FCM credentials; real sign-in, e-mail and push never tested.
- `assets/notification.wav` missing, so `expo prebuild` / EAS build fail. No native build has been made.
- Pricing, fees, TVA and minimum order not approved, so checkout cannot be enabled.
- No reviewer other than the author for PRs (ruleset needs 1 approval).
- `expo install --check` expects react-native 0.88.1 (lockfile 0.88.0). Lint: 45 pre-existing errors.

## Exact next task
Checklist I1: replace the hard-coded "next delivery" and "last order" cards in `app/(app)/profile.tsx` with the
customer's real orders (RLS-scoped read) or an empty state, with Jest tests and an e2e check. Leave the "Mon plan",
upgrade and offers cards unchanged until the owner decides I3 (hide out-of-scope screens).
