# L'OPTION V1 — Engineering report for the CTO (2026-10-29)

**Status in one line:** integration, account creation, nutrition onboarding, first-order offer (server enforcement), calorie tracking, streaks and opt-in reminders are implemented and pass every local check, including an end-to-end run against real local Supabase services. **Nothing is deployed, merged or applied to any hosted database.** The work depends on Phase 1C revision 7, which remains **NOT READY FOR STAGING**. Checkout stays disabled.

**Verdict:** ready for **code review**. **Not ready for staging** (blocked by Phase 1C approval and the owner actions in §7). **Not ready for release** (see `docs/v1/REMAINING_SETUP_AND_RELEASE_TASKS.md`).

---

## 1. Branches and commits (all pushed; no existing branch rewritten; `main` untouched)

| Branch | Head | Content |
|---|---|---|
| `claude/v1-integration` | `68dc65b` | Phase 1A/1B (`0bedf0a`) + Phase 1C rev 7 (`46d2c3f`, merge `4e465f7`) + Redesign V2 / Expo SDK 58 (`1fba92f`, merge `68dc65b`) |
| `claude/v1-onboarding-auth` | `5baec9c` | + onboarding/auth/offer migration (`99e820b`) and app (`5baec9c`) |
| `claude/v1-onboarding-auth-react-refresh` | `08d7a2f` | + first react-refresh fix |
| `claude/v1-app-integration` | `b036461` | + Babel fix at source, resumable onboarding, real-services e2e harness |
| `claude/v1-release-checklist` | `32fd9ab` | + release checklist |
| `claude/v1-nutrition-tracking` | this commit | + nutrition DB layer (`9b08af5`), app + dispatcher (`b5bf441`), checklist/evidence (`c940ec0`, `2500f7d`), this report |

Each branch builds on the previous one; `claude/v1-nutrition-tracking` contains everything. **No pull request has been opened.** The repository ruleset applies to all branches (PR + 1 approving review, no bypass); a PR author cannot approve their own PR, so a second reviewer is required.

## 2. What was delivered

### 2.1 Integration of the three unmerged lineages
- Verified that the three tips each branched from `0cb0fe0`; merged with `--no-ff`, conflicts resolved deliberately: V2 tabs wrapped in the Phase 1A `RouteGate`; V2's admin "security phrase" modal dropped (Phase 1A had removed it as fake security); SDK 58 lockfile kept and Phase 1A test tooling re-installed at SDK 58 versions.
- Found that the SDK 58 lockfile silently moved `supabase-js` 2.39.8 → 2.118.0, which changes sign-out behaviour; `authStore.signOut` adapted and tested for both.

### 2.2 Account creation and nutrition onboarding (migration `20261028120000`)
- Welcome screen (Apple, Google, e-mail, log in); Google via Supabase-hosted OAuth (PKCE); Apple native on iOS (nonce) and hosted elsewhere; providers not configured show "Pas encore configuré" (read from Supabase's public Auth settings). **No credentials anywhere.**
- E-mail sign-up with verification screen, resend, expired-link and other-device handling; unverified accounts are confined to the verification screen; the app never claims an e-mail was sent when delivery failed.
- Five-step V2 onboarding (sex input incl. "prefer not to say", age, weight, height, activity), validation, Back/Continue, progress, drafts restored after an app restart (cleared at completion/sign-out); BMR/TDEE computed **by the database** (Mifflin–St Jeor); server-stamped completion; existing onboarded customers backfilled.
- Notification and location permission screens (explain first, never block, manual address fallback; a location suggestion must be confirmed).
- First-order free delivery: banner from a server-maintained status; enforcement `apply_first_order_offer(order_id)` is server-only, idempotent, at most once per account (lock + partial unique index), and a failed checkout consumes nothing. **Nothing calls it yet** because trusted order creation does not exist.

### 2.3 Babel error `Cannot find module 'react-refresh/babel'`
Root cause: `babel-preset-expo` 58 loads `react-refresh/babel` for every dev-server bundle (Fast Refresh) but declares it only as a peer dependency; with npm `legacy-peer-deps` it was never installed. Production `expo export` never loads it, which is why exports passed. Fix: `react-refresh` as a devDependency at `^0.14.2` (the version `react-native`/`expo` use, one deduplicated copy) and a project `.npmrc` (`legacy-peer-deps=false`). No Babel/Metro config change; Fast Refresh stays on. Verified with real dev-server bundle requests (iOS, Android: HTTP 200).

### 2.4 Calorie tracking, streaks and engagement notifications (migration `20261029120000`)
- **Engine:** existing Mifflin–St Jeor model and multipliers; no estimate when inputs are missing or "prefer not to say". **Daily target = TDEE** (`tdee_baseline_v1`): the unapproved −500/+300 kcal client goal adjustment and invented macro targets were removed. Goal-based targets need a product decision.
- **Log:** customers log meals they actually ate (today/6 days back), from the menu or explicitly from their own orders (never automatic, never beyond the ordered quantity). Clients send only meal, servings, date, time zone and an idempotency key; **calories are copied from `meals` by a trigger** (clients cannot submit calorie values). Removal is an audited mark. Owner-only RLS.
- **History:** per-day target snapshots so past days keep the target that applied; 7/30-day V2 chart where "no meal logged" is drawn distinctly and never as 0.
- **Streak:** from persisted local dates; milestones 7/14/30/…; removals recompute; no points or rewards.
- **Reminders (opt-in, off by default):** daily target, progress (only with real logged data), evening (only when nothing is logged), milestones, gentle re-engagement (cooldown 7 days, ≤ 2 per 30 days); local time zone, quiet hours, ≤ 2 per day, 120-min send window, idempotent planner (dedupe keys), server-only outbox. Dispatcher (Supabase Edge Function, not deployed) sends through the Expo Push API, records tickets/receipts and deactivates `DeviceNotRegistered` tokens; protected by a scheduler secret. Notification taps open only whitelisted screens through the route gates.
- **UI:** new Mon suivi, Ajouter un repas, Profil nutritionnel and Rappels screens; the home "40 % consommé" placeholder card and the hard-coded progress screen were replaced by real data; the profile's fake streak/"+50 pts" cards removed.

### 2.5 Test infrastructure added
- `supabase/tests/run_v1_onboarding_offer.sh`, `supabase/tests/run_v1_nutrition.sh`: disposable Supabase Postgres containers; refusals (wrong role, missing dependency, altered monitor, gated COMMIT under `ON_ERROR_ROLLBACK=on`), SQL tests, Phase 1C SQL tests as regression, concurrency, rollback and re-apply.
- `supabase/tests/e2e/run_app_e2e.sh`: the app's web build against **real local** Supabase Auth (GoTrue), PostgREST and Postgres (staging baseline + Phase 1C + both V1 migrations) with an SMTP sink and a fake Expo push service, driven by Playwright.

### 2.6 Release checklist
`docs/v1/REMAINING_SETUP_AND_RELEASE_TASKS.md`: single operational checklist (sections A–L, ~120 rows with status, owner, dependency, instructions, verification, release impact, evidence log).

## 3. Defects found in the existing code (and what was done)
| Defect | Origin | Action |
|---|---|---|
| Endless profile reload on home (368 requests / 5 s) | Phase 1A gate + home | Fixed, tested |
| Screens declared `href: null` (checkout, order tracking, my-plan, reorder, upgrade) unreachable — Expo Router 58 turns them into redirecting hidden routes | SDK 58 upgrade | Fixed: plain routes without tab button; back follows history |
| Menu linked to a meal-detail route that never existed | Initial commit | Dead link removed |
| `react-refresh/babel` missing on dev server | SDK 58 peer dependency | Fixed at source (§2.3) |
| Push tokens never registered in development builds; no EAS projectId; token logged | Initial commit | Fixed |
| `user_push_tokens` upsert failed on re-registration and could not move a token to the account now on the device | Initial commit + Phase 1C policies | Replaced by `register_push_token()` / deactivation at sign-out |
| Client-side −500/+300 kcal goal adjustment presented as a target | Initial commit | Removed pending a policy |
| supabase-js 2.118 sign-out semantics differ from 2.39 | SDK 58 lockfile | Adapted and tested |
| **Still open:** pushes to drivers are sent from the customer's device; `assets/notification.wav` missing (native prebuild fails); conflicting legacy fee defaults (15 / 10 / 19 MAD); remaining V2 profile placeholders; 45 pre-existing lint errors; Expo now expects react-native 0.88.1 | Various | Listed in the checklist |

## 4. Security and Phase 1C
- No RLS weakened, no service-role key or provider secret in the app or `EXPO_PUBLIC_*`, checkout not enabled, no hosted resource changed.
- The Phase 1C monitor `containment_violations()` reports any unreviewed client policy or client-callable SECURITY DEFINER function. The onboarding migration needed none. The nutrition migration adds **seven owner-only policies and two client-callable definer functions** (push-token binding), so it re-creates the monitor with exactly those nine entries appended — generated mechanically from the Phase 1C source (`supabase/tools/generate_nutrition_monitor.py`, `--check` in the harness). It refuses to run unless the monitor is the reviewed revision-7 function (md5 `86b0dca9…`) and requires zero violations before COMMIT; the rollback restores the original (md5 checked). New fingerprint `1bbbc1b2…` is verified by `supabase/tests/postdeploy_verify_nutrition_readonly.sql`. **This extension needs the same independent review as Phase 1C.**
- Every migration: role `postgres` only, one transaction with a deferred commit gate, precondition/postcondition, refusal on re-run, archived (not destructive) rollback. Rollback order: nutrition → onboarding/offer → Phase 1C.

## 5. Verification evidence (final run on `b5bf441`)
| Check | Result |
|---|---|
| `npm ci` from the committed lockfile | OK |
| `npx expo install --check` | react-native 0.88.1 now expected (lockfile 0.88.0); not caused by this work |
| `npx tsc --noEmit` (with Expo Router typed routes) | 0 errors |
| `npx jest` | 16 suites, 162 tests pass |
| `npx eslint .` | 45 errors / 47 warnings, all in files not written in this work (was 52 at integration) |
| `expo export` android / ios / web | pass |
| Dev-server bundles iOS / Android (`expo start`) | HTTP 200, Fast Refresh active |
| `npx expo prebuild` (android, throwaway copy) | **fails**: missing `assets/notification.wav` |
| `supabase/tests/run_phase1c.sh` | ALL PHASE 1C LOCAL CHECKS PASSED (215; Supabase CLI cases skipped — CLI not installed) |
| `supabase/tests/run_v1_onboarding_offer.sh` | ALL PASSED (29 SQL tests, concurrency, rollback) |
| `supabase/tests/run_v1_nutrition.sh` | ALL PASSED (32 SQL tests, Phase 1C SQL 58/0, parallel planner/retries, rollback) |
| `supabase/tests/e2e/run_app_e2e.sh` | 55/55 pass |

**Not verified (cannot be locally):** real Google/Apple sign-in; real Resend delivery; native permission dialogs; real push delivery (APNs/FCM/Expo) and notification taps on devices; native builds; the Edge Function in the Supabase runtime; `pg_cron`/`pg_net`; anything on the hosted Supabase project; Supabase CLI `db push`. "Local" means disposable Docker containers of the official Supabase images.

## 6. Decisions needed
1. Approve or amend the daily target policy (target = TDEE) and whether goal-based targets are wanted.
2. Approve the proposed reminder cadence (opt-in, 12:00 default, ≤ 2/day, quiet hours 22:00–08:00, re-engagement limits).
3. First-order promotion rules (eligibility, release statuses, minimum order, expiry, stacking).
4. Pricing, delivery fee, service fee, TVA, minimum order — prerequisite for trusted order creation and enabling checkout.
5. Account-linking policy across providers; minimum age (also for estimates and reminders); delivery zones; customer language strategy.
6. Phase 1C: independent review, initial-admin UUID, staging gates, meal-images mitigation.

## 7. Owner actions (credentials and access)
Google OAuth client; Apple Developer program, App ID capability, Services ID, key and client secret (expires ≤ 6 months); Resend domain and API key (Supabase SMTP); APNs key and FCM V1 credentials (EAS); `NOTIFICATIONS_CRON_SECRET` and optional `EXPO_ACCESS_TOKEN` (Edge Function secrets/Vault); Supabase redirect URL `loption://auth-callback`; a licensed `notification.wav` (or removal of the custom sound); audit of meal calorie/macro values; privacy policy, terms and store metadata; a second GitHub reviewer. Exact locations: `docs/v1/AUTH_PROVIDER_SETUP.md`, `docs/v1/CALORIE_TRACKING_AND_ENGAGEMENT.md` §6.

## 8. Suggested review order
1. Phase 1C (unchanged by this work; still needs its own approval).
2. `supabase/migrations/20261028120000_v1_onboarding_first_order_offer.sql` + its tests.
3. `supabase/migrations/20261029120000_v1_nutrition_tracking_engagement.sql` — focus on the generated monitor diff (nine entries), the log trigger, the planner and the dispatch functions.
4. App changes per feature doc; then run the four harnesses (commands in §5).

Documents: `docs/v1/V1_ONBOARDING_AUTH_OFFER.md`, `docs/v1/CALORIE_TRACKING_AND_ENGAGEMENT.md`, `docs/v1/AUTH_PROVIDER_SETUP.md`, `docs/v1/REMAINING_SETUP_AND_RELEASE_TASKS.md`.
