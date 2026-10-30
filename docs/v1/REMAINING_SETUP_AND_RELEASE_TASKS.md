# L'OPTION V1 — Remaining setup and release tasks

**The single operational checklist from "implemented" to "configured, verified and publishable".**
Order of work: finish features → configure real services and credentials → verify the whole app on real devices and a real Supabase project → publish only when every **Blocking** row below is `VERIFIED` or explicitly waived by the owner in writing.

| | |
|---|---|
| Baseline of this checklist | branch `claude/v1-activity-tracking-final`, results at commit `ca759f8` (2026-10-30); first written at `b036461` |
| Calorie tracking, streaks and reminders | [`CALORIE_TRACKING_AND_ENGAGEMENT.md`](CALORIE_TRACKING_AND_ENGAGEMENT.md) (section L below) |
| Activity, workouts, Daily Tracking tab | [`ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md`](ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md) (section M below) |
| Detailed provider steps | [`AUTH_PROVIDER_SETUP.md`](AUTH_PROVIDER_SETUP.md) (not repeated here) |
| What was built and how it was tested | [`V1_ONBOARDING_AUTH_OFFER.md`](V1_ONBOARDING_AUTH_OFFER.md) |
| Database security package | [`PHASE1C_DATABASE_SECURITY_PLAN.md`](PHASE1C_DATABASE_SECURITY_PLAN.md) (sections 10 and 11) |
| Original audit and business questions | [`PHASE0_AUDIT.md`](PHASE0_AUDIT.md) (sections 4 and 6) |

## How to use this file
- Update a row's **Status** only with evidence: add a line to the [evidence log](#evidence-log) (date, commit, command or test, result) and reference it in **Notes**.
- Never write a credential value here. Record only *whether* it is configured and *where*.
- `VERIFIED` means proven end to end in the stated environment. A screen that exists, or a test that mocks the dependency, is at most `IMPLEMENTED — UNVERIFIED`.
- **Local** below means the disposable Docker harnesses in this repository (Supabase Postgres 17.6 image, Supabase Auth/GoTrue, PostgREST, an SMTP sink, Chromium). It is **not** the hosted Supabase project, a CDN, a real e-mail provider or a phone.

**Status labels:** `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `IMPLEMENTED — UNVERIFIED` · `VERIFIED` · `OWNER ACTION REQUIRED`
**Owner:** *Owner* = you (accounts, credentials, decisions, approvals) · *Dev* = developer · *Provider* = Google / Apple / Resend / Expo / Supabase.

## Release blockers at a glance
| # | Blocker | Section |
|---|---|---|
| 1 | No Google, Apple or Resend credentials; real sign-in and real e-mail delivery never tested | A, C |
| 2 | ~~`assets/notification.wav` missing~~ — resolved 2026-10-30: the unused reference was removed; prebuild succeeds (E-18) | E |
| 3 | No native iOS/Android build has ever been produced or tested on a device | E, K |
| 4 | Pricing, delivery fee, service fee, TVA and minimum order not approved; no trusted order creation → checkout must stay disabled | H |
| 5 | First-order promotion rules not approved; enforcement exists in the database but nothing calls it yet | G |
| 6 | Phase 1C database containment is NOT READY FOR STAGING (initial admin placeholder, staging gates, open meal-images finding) and is not deployed; the V1 migration depends on it | J |
| 7 | V2 profile tab still shows placeholder plan/reorder/upgrade/offer data as if it were real (the home calorie card and streak are now real) | I |
| 8 | No pull request exists for `claude/v1-onboarding-auth`, `claude/v1-onboarding-auth-react-refresh`, `claude/v1-app-integration`, `claude/v1-release-checklist` or `claude/v1-nutrition-tracking`; the repository rule needs 1 approving review that the PR author cannot give | K |
| 9 | Privacy policy, terms of use and support contact do not exist in the app; store metadata not prepared | K |
| 10 | Tracking reminders: no APNs/FCM credentials, Edge Function `dispatch-notifications` not deployed, scheduler not created; real push delivery never tested | L, E |
| 11 | Meal calorie/macro values (source of every tracked number) are staff-entered and unaudited | L |
| 12 | Nutrition migration extends the Phase 1C monitor (nine reviewed entries); needs the same independent review as Phase 1C before any staging use | L, J |
| 13 | Activity tracking: HealthKit / Health Connect never run on a device; HealthKit capability, Play Console Health Connect declaration and health-data privacy texts missing; the activity migration adds seven monitor entries needing review | M |

---

## A. External API and provider configuration
Detailed console steps: [`AUTH_PROVIDER_SETUP.md`](AUTH_PROVIDER_SETUP.md) sections 0–3. App-side code for all three is `IMPLEMENTED — UNVERIFIED` (`src/services/authFlows.ts`, `src/services/authProviders.ts`, `app/(auth)/*`, `app/auth-callback.tsx`).

### A1. Google OAuth
- [ ] Create/configure the Google Cloud project — **OWNER ACTION REQUIRED**
- [ ] OAuth consent screen + authorized redirect URI — **OWNER ACTION REQUIRED**
- [ ] Obtain OAuth client ID and secret — **OWNER ACTION REQUIRED**
- [ ] Enable and configure the Google provider in Supabase Auth — **OWNER ACTION REQUIRED**
- [ ] Platform settings (Supabase redirect allow-list) — **OWNER ACTION REQUIRED**
- [ ] Real sign-in on iOS and Android development builds — **BLOCKED**
- [ ] Account creation, returning login, logout, error handling — **BLOCKED**

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| A1.1 | Google Cloud project + OAuth consent screen (app name, support e-mail, privacy policy URL) | OWNER ACTION REQUIRED | Owner | Google account; privacy policy URL (K9) | Google Cloud Console → APIs & Services → OAuth consent screen | Consent screen saved; publishing status recorded | Blocking (if Google is offered at launch) | Project id, support e-mail: **OWNER ACTION REQUIRED** |
| A1.2 | OAuth client, type **Web application**, redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` | OWNER ACTION REQUIRED | Owner | A1.1; Supabase project ref | Credentials → Create OAuth client ID | Client exists with exactly that redirect URI | Blocking | `<project-ref>`: **OWNER ACTION REQUIRED**. No Google value goes into the app or `.env` |
| A1.3 | Enable Google in Supabase with client ID + secret | OWNER ACTION REQUIRED | Owner | A1.2 | Supabase Dashboard → Authentication → Providers → Google | `GET /auth/v1/settings` (anon key) shows `"google": true` | Blocking | App reads this to hide the "Pas encore configuré" note |
| A1.4 | Redirect allow-list: `loption://auth-callback` (+ dev-build URL printed by `npx expo start`) | OWNER ACTION REQUIRED | Owner | Supabase access | Dashboard → Authentication → URL Configuration → Redirect URLs | A1.5 returns to the app instead of an error page | Blocking | Shared with A2 and A3 |
| A1.5 | Real sign-in on iOS + Android **development builds** (not Expo Go) | BLOCKED | Dev | A1.3, A1.4, E4 | AUTH_PROVIDER_SETUP §1 "Verify" | New account → onboarding; second sign-in → same user id, one `user_profiles` row; cancel → stays on welcome; sign-out clears state | Blocking | Only the "not configured" path is verified (local e2e) |

### A2. Sign in with Apple
- [ ] Apple Developer Program membership confirmed — **OWNER ACTION REQUIRED**
- [ ] App ID `com.loption.app` with Sign in with Apple — **OWNER ACTION REQUIRED**
- [ ] Services ID, key (.p8), Team ID, Key ID — **OWNER ACTION REQUIRED**
- [ ] Credentials in Supabase; native capability in the build — **OWNER ACTION REQUIRED**
- [ ] Redirect URLs, bundle id, platform rules verified — **BLOCKED**
- [ ] Real sign-in incl. private relay e-mail and cancellation — **BLOCKED**

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| A2.1 | Confirm paid Apple Developer Program membership and team | OWNER ACTION REQUIRED | Owner | — | developer.apple.com → Membership | Team ID recorded (not secret) | Blocking for iOS | App Store guideline 4.8: offering Google sign-in on iOS requires an equivalent option such as Sign in with Apple |
| A2.2 | App ID `com.loption.app` → enable Sign in with Apple | OWNER ACTION REQUIRED | Owner | A2.1 | Certificates, Identifiers & Profiles → Identifiers (EAS can sync the capability) | Capability shown on the App ID; iOS build signs | Blocking for iOS | `app.json` already has `ios.usesAppleSignIn: true` and the `expo-apple-authentication` plugin |
| A2.3 | Services ID (Android/web flow), return URL `https://<project-ref>.supabase.co/auth/v1/callback`; Sign in with Apple key (.p8), Key ID | OWNER ACTION REQUIRED | Owner | A2.1 | Identifiers → Services IDs; Keys | Identifiers exist; .p8 stored outside the repo (`*.p8` is git-ignored) | Blocking if Apple is offered on Android | Services ID value: **OWNER ACTION REQUIRED** |
| A2.4 | Supabase Apple provider: Client IDs `com.loption.app,<services-id>`; secret = JWT generated from the .p8 | OWNER ACTION REQUIRED | Owner | A2.2, A2.3 | Dashboard → Authentication → Providers → Apple | `/auth/v1/settings` shows `"apple": true` | Blocking | The JWT secret **expires after ≤ 6 months**: add a renewal reminder (E/K) |
| A2.5 | Private-relay e-mail: register the Resend sending domain/address with Apple | OWNER ACTION REQUIRED | Owner | A3.1 | Apple Developer → Services → Sign in with Apple for Email Communication | Verification e-mail to a `…@privaterelay.appleid.com` address arrives | Blocking only if e-mails are sent to Apple users | |
| A2.6 | Real sign-in on an iPhone (native) and Android (web flow): success, "Hide My Email", cancel | BLOCKED | Dev | A2.2–A2.4, E4 | AUTH_PROVIDER_SETUP §2 "Verify" | Relay address account reaches onboarding; cancel shows nothing; "Unacceptable audience" never appears | Blocking | Code path: native identity token + nonce on iOS; hosted OAuth elsewhere |

### A3. Resend e-mail delivery (verification e-mails)
- [ ] Resend account and sending domain — **OWNER ACTION REQUIRED**
- [ ] Domain DNS verified — **OWNER ACTION REQUIRED**
- [ ] API key obtained — **OWNER ACTION REQUIRED**
- [ ] Supabase Auth SMTP configured — **OWNER ACTION REQUIRED**
- [ ] Sender, redirect URLs, French templates — **OWNER ACTION REQUIRED**
- [ ] Real sign-up, resend, delivery and error handling — **BLOCKED**
- [x] App never claims an e-mail was sent when sending failed — **VERIFIED** (local Auth, evidence E-03)

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| A3.1 | Resend account; add and verify the sending domain (SPF/DKIM DNS records) | OWNER ACTION REQUIRED | Owner | Domain DNS access | resend.com → Domains | Domain shows "Verified" | Blocking | Domain and sender address: **OWNER ACTION REQUIRED** |
| A3.2 | API key with sending access | OWNER ACTION REQUIRED | Owner | A3.1 | resend.com → API Keys | Key exists (value never recorded here) | Blocking | Server-side only. Never `.env`, never `EXPO_PUBLIC_*` |
| A3.3 | Supabase custom SMTP: host `smtp.resend.com`, port 465, user `resend`, password = API key, sender on the verified domain, name "L'OPTION" | OWNER ACTION REQUIRED | Owner | A3.2 | Dashboard → Authentication → SMTP Settings | Test e-mail arrives; Resend → Logs shows it | Blocking | Without it Supabase's built-in mailer reaches team addresses only |
| A3.4 | Auth settings: "Confirm email" ON; password ≥ 8 with letters + digits; French "Confirm signup" template keeping `{{ .ConfirmationURL }}`; redirect URLs (A1.4) | OWNER ACTION REQUIRED | Owner | Supabase access | Dashboard → Authentication → Providers → Email; Email Templates | Settings recorded in the evidence log | Blocking | App enforces the same password rule; the server is the authority |
| A3.5 | Real sign-up, open link on the same phone, expired/reused link, resend (60 s cooldown), rate limit | BLOCKED | Dev | A3.3, A3.4, E4 | AUTH_PROVIDER_SETUP §3 "Verify" | Link opens `auth-callback` → onboarding; expired link → "Lien expiré" + resend; link on another device → "connectez-vous avec votre mot de passe" | Blocking | Verified locally with GoTrue + SMTP sink: delivery, link (PKCE), unconfirmed login. Expired-link and resend flows: unit tests only |
| A3.6 | Never claim an e-mail was sent when sending failed | VERIFIED | Dev | — | — | Local e2e: GoTrue without SMTP → HTTP 500 → app shows "E-mail non envoyé … Aucun e-mail n'a été envoyé" and stays on the form (evidence E-03) | Blocking | Re-check once on hosted Supabase (its error code may be `email_address_not_authorized`; mapped and unit-tested) |

---

## B. Secrets and environment configuration
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| B1 | `.env.example` matches what the app reads | VERIFIED | Dev | — | — | Code reads only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (`git grep EXPO_PUBLIC_`); both documented (evidence E-08) | Blocking | `src/config/env.ts` refuses service-role / `sb_secret_` keys |
| B2 | `.env` and local secret files excluded from Git | VERIFIED | Dev | — | — | `git check-ignore` ignores `.env`, `.env.*`, `*.env`, `secrets/`, `*.p8`, `google-services.json`, `GoogleService-Info.plist`; `.env.example` stays tracked (E-08) | Blocking | |
| B3 | Public client config documented separately from private secrets | VERIFIED | Dev | — | — | `.env.example` (public) vs `supabase/server-secrets.env.example` (names only, empty, never read by the app) | Non-blocking | |
| B4 | Google/Apple credentials only in Supabase provider settings | OWNER ACTION REQUIRED | Owner | A1.3, A2.4 | Configure only in the Supabase Dashboard | Search the repo, `.env`, EAS env and build output: no client secret, .p8 or Apple JWT | Blocking | |
| B5 | Resend key never in `EXPO_PUBLIC_*` or the bundle | IMPLEMENTED — UNVERIFIED | Dev | A3.2, K3 | Keep it only in Supabase SMTP settings | `grep` the production iOS/Android bundles for `re_` keys and the SMTP host; none | Blocking | No code path reads it today; production bundles not yet built |
| B6 | Production values for `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` set for release builds | OWNER ACTION REQUIRED | Owner | Production Supabase project decision | EAS → project → Environment variables (production), or `eas.json` `env` | Release build connects to the production project; anon key, not service role | Blocking | `eas.json` has no `env` today; local `.env` must not be the source of release values |
| B7 | No real secrets in tracked files, history, build output or logs | IMPLEMENTED — UNVERIFIED | Dev | K3 | Re-run the scan below on the release candidate and its build output | Scan of tracked files and full history at `b036461` found only test fixtures and doc mentions (E-08); repeat on release bundles and CI logs | Blocking | Many `console.log` calls log ids and objects (see K11) |

---

## C. Authentication and account lifecycle
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| C1 | E-mail sign-up + verification with real delivery | BLOCKED | Dev | A3 | AUTH_PROVIDER_SETUP §3 | Real inbox receives the link; account confirmed; onboarding opens | Blocking | Local: VERIFIED with GoTrue + SMTP sink (E-03) |
| C2 | Login before confirmation is refused into the app | VERIFIED | Dev | — | — | Local e2e: password login before confirming → verification screen (E-03); routing unit tests | Blocking | Re-check on hosted Auth with C1 |
| C3 | Expired link and resend | IMPLEMENTED — UNVERIFIED | Dev | A3 | Request a link, wait past expiry / reuse it; press resend | "Lien expiré" + resend works; cooldown and rate-limit messages appear | Blocking | Unit tests only |
| C4 | Google and Apple with real credentials | BLOCKED | Dev | A1, A2 | See A1.5, A2.6 | As A1.5 / A2.6 | Blocking | |
| C5 | Account-linking policy across providers (auto-link, link after login, or keep separate) | OWNER ACTION REQUIRED | Owner | — | Decide; then Dev implements only the approved policy | Written decision in the evidence log | Blocking | Today: Supabase's default (links verified identical e-mails); Apple relay addresses become separate accounts; manual linking not implemented and **must not** be added without an approved security policy |
| C6 | Test linking and duplicate-e-mail edge cases | NOT STARTED | Dev | C5, A1, A2 | Same e-mail via e-mail+Google; Apple relay vs real e-mail | One profile per account; no takeover of an unverified e-mail account | Blocking | `user_profiles.user_id` is unique (SQL test B07) |
| C7 | Minimum age and age-related handling | OWNER ACTION REQUIRED | Owner | Legal advice | Decide minimum age and whether minors may order / see estimates | Decision recorded; app and DB updated by Dev | Blocking | Current input range 13–100 is a data-validation rule, not an age policy |
| C8 | Returning users skip completed onboarding | VERIFIED | Dev | — | — | Local e2e: reload → home; second browser (new device) → no onboarding (E-03) | Blocking | Re-check on native devices (E4) |
| C9 | Logout / account switch clears user state | IMPLEMENTED — UNVERIFIED | Dev | E4 | Sign out on a phone; sign in as another user | Cart, profile, onboarding draft, setup flag, channels and location tracking belong to the new user only | Blocking | Unit tests with a mocked client. The profile tab asks for confirmation with `Alert.alert`, which does nothing on web (web sign-out unusable; native unaffected) |

---

## D. Nutrition onboarding
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| D1 | Five inputs (sex input incl. "prefer not to say", age, weight, height, activity) with validation | VERIFIED | Dev | — | — | Local e2e (real API) + screen tests (E-03, E-02) | Blocking | Goal and Program are no longer asked; columns and data kept |
| D2 | Mifflin–St Jeor + multipliers, server-side | VERIFIED | Dev | — | — | SQL tests N01–N05; e2e reads 1345/1614 kcal from the database (E-04, E-03) | Blocking | No estimate when sex input is "unspecified" |
| D3 | Answers persist across app restart | IMPLEMENTED — UNVERIFIED | Dev | E4 | Kill the app at step 3 on a phone; reopen | Same step and answers; nothing partial on the server | Non-blocking | VERIFIED on web (page reload, E-03); native restart untested |
| D4 | Profile authorization (own row only; derived columns not writable) | VERIFIED | Dev | J | — | SQL tests B04–B06, N05; e2e API probes return 403 (E-03, E-04) | Blocking | **Local only.** Hosted verification is part of J |
| D5 | Existing staging customers not forced through onboarding | IMPLEMENTED — UNVERIFIED | Dev | J (migration applied on staging) | Apply migration on staging; sign in as a pre-existing customer | Customers with weight/height/age go to home | Blocking | Backfill tested locally (SQL test B08); real staging data unseen |
| D6 | Incomplete/invalid profiles cannot be marked complete | VERIFIED | Dev | — | — | SQL tests B01–B03 | Blocking | **Local only.** |
| D7 | Declining notifications/location never blocks home | VERIFIED | Dev | — | — | Setup screen tests; e2e continues without notifications (E-02, E-03) | Blocking | **Local only.** Native dialogs: E2/F1 |

---

## E. Notifications and native app readiness
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| E1 | `assets/notification.wav` missing but referenced in `app.json` | VERIFIED | Dev | — | Removed the unused `sounds` entry (the code always used the default sound) | `npx expo prebuild --no-install --platform all` succeeds (E-18) | Non-blocking | Done 2026-10-30. A licensed custom sound remains optional (DECISIONS #12) |
| E2 | Notification permission prompt on real devices (iOS + Android 13+) | IMPLEMENTED — UNVERIFIED | Dev | E4 | Fresh install → onboarding → setup | Explanation first; OS prompt only on tap; denial → settings instructions; no repeated prompt | Blocking | Web has no permission; mocked unit tests only |
| E3 | Push credentials and delivery (APNs key, FCM V1 credentials in EAS) | OWNER ACTION REQUIRED | Owner | Apple/Google accounts; decision whether push is in V1 | EAS → Credentials; Firebase project for Android | Token stored in `user_push_tokens`; a test push arrives on iOS and Android | Blocking if push is promised at launch | Customer tokens now go through `register_push_token()` and are deactivated at sign-out; dev builds can obtain a token (EAS projectId passed). **Pushes to drivers are still sent from the customer's device** (`checkout.tsx` → `sendToAllOnlineDrivers`; Phase 0 N1): move server-side before launch. Reminder delivery: section L |
| E4 | Native development builds (iOS + Android) installed on devices | NOT STARTED | Dev | E1, A2.2, EAS access | `eas build --profile development` | Builds install and open; auth, onboarding, setup, home work | **Blocking** | Required by every native verification above (dev client; Expo Go is not enough) |
| E5 | Production builds (iOS + Android) | NOT STARTED | Dev | E1, B6, K | `eas build --profile production` | Builds succeed; smoke test on devices | **Blocking** | Only `expo export` (JS bundles) has run |
| E6 | Icons, splash, permission texts, identifiers | IMPLEMENTED — UNVERIFIED | Owner + Dev | E4 | Check on device | Icon/adaptive icon render; splash correct; `com.loption.app` on both platforms; iOS location text accurate | Blocking | Splash plugin sets colour only (no image); location text covers customers and drivers |
| E7 | Release build does not depend on local-only configuration | NOT STARTED | Dev | B6, E5 | Build in EAS with no local `.env` | App reaches the production project | Blocking | |

---

## F. Location and delivery readiness
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| F1 | Location explanation and OS request | IMPLEMENTED — UNVERIFIED | Dev | E4 | Device test | Prompt only after "Autoriser"; suggestion must be confirmed before saving | Blocking | Unit tests only |
| F2 | Manual address when location is denied | VERIFIED | Dev | — | — | e2e saves a typed address through the real API (E-03); server validates length and coordinate pairs (SQL A01–A02) | Blocking | **Local only.** |
| F3 | Supported delivery zones | OWNER ACTION REQUIRED | Owner | — | Define zones (e.g. Casablanca districts or radius from Kitchen A) | Written definition | Blocking | Not invented; nothing checks zones today |
| F4 | Address validation and storage rules | OWNER ACTION REQUIRED | Owner + Dev | F3 | Decide geocoding, required fields (building, floor, phone) | Rules implemented and tested | Blocking | Today: free text 5–300 chars + optional confirmed coordinates on `user_profiles` |
| F5 | Distance calculation / delivery eligibility | NOT STARTED | Dev | F3, H1 | Implement after rules exist | Out-of-zone address refused at checkout | Blocking | |
| F6 | Location privacy and retention | OWNER ACTION REQUIRED | Owner | Legal (Moroccan law 09-08 / CNDP) | Decide retention for customer addresses and driver tracks | Policy in privacy policy (K9) | Blocking | Customer coordinates stored only with a confirmed address; driver location retention still open (Phase 0 D5) |

---

## G. First-order free-delivery promotion
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| G1 | Eligibility policy for "first eligible order" | OWNER ACTION REQUIRED | Owner | — | Approve or change the implemented rule | Written decision | Blocking | Implemented: eligible if the account has no applied redemption and no other order outside release statuses |
| G2 | When the offer is reserved, consumed, released | OWNER ACTION REQUIRED | Owner | H state machine | Approve or change | Written decision | Blocking | Implemented: used when an order carrying it commits; released when that order reaches a configured release status (default `cancelled`, `rejected` — not yet valid order statuses) |
| G3 | Minimum order, expiry, exclusions, stacking — or confirm none apply | OWNER ACTION REQUIRED | Owner | — | Decide each explicitly | Values set on the `promotions` row via a reviewed migration | Blocking | All unset (NULL) today; none invented |
| G4 | Trusted server-side enforcement | IMPLEMENTED — UNVERIFIED | Dev | H4, J | Call `public.apply_first_order_offer(order_id)` inside the trusted order-creation transaction | Order created with free delivery once per account on staging | Blocking | Function exists and is client-inaccessible; **nothing calls it yet** |
| G5 | Repeated and concurrent requests | VERIFIED | Dev | — | — | `run_v1_onboarding_offer.sh`: idempotent per order; 3 parallel checkouts → 1 discount (READ COMMITTED and REPEATABLE READ) (E-04) | Blocking | **Local only.** Re-run against the real order RPC (H4) |
| G6 | Not re-granted via logout, retries or devices | VERIFIED | Dev | — | — | Server-side state; e2e second device shows the same status; SQL E03/E09 (E-03, E-04) | Blocking | **Local only.** |
| G7 | Home banner reflects real eligibility | VERIFIED | Dev | — | — | e2e: banner shown from the server-maintained `first_order_offer_status` (E-03) | Non-blocking | **Local only.** Banner is display only; never proof the discount was applied |
| G8 | Works end to end with trusted order creation before enabling | BLOCKED | Dev | G1–G4, H | — | Staging order: delivery fee 0, `delivery_discount` recorded, second order pays delivery | Blocking | |

---

## H. Pricing and checkout
**Checkout must stay disabled until this whole section is approved and implemented.** Today the database (Phase 1C) refuses client order inserts, but the checkout screen still offers "Place Order" and shows a hard-coded 15 MAD delivery fee.

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| H1 | Delivery-fee formula and distance rates | OWNER ACTION REQUIRED | Owner | F3 | Decide | Written decision | Blocking | **Conflicting legacy values — do not reuse:** checkout hard-codes 15 MAD; `orders.delivery_fee` default 10; `platform_settings.service_fee_per_order` default 15; driver screen falls back to 19 MAD service fee; Phase 0 asked about 8 MAD |
| H2 | Service-fee policy | OWNER ACTION REQUIRED | Owner | — | Decide | Written decision | Blocking | |
| H3 | TVA treatment and minimum order value | OWNER ACTION REQUIRED | Owner | Accountant | Decide | Written decision | Blocking | |
| H4 | Trusted server-side order creation and pricing (RPC) | NOT STARTED | Dev | H1–H3, J | One transaction: read prices from `meals`, compute fees, insert order + items, apply G4 | SQL + concurrency tests; client can no longer set prices | Blocking | Phase 0 plan "create_order_rpc" |
| H5 | Validate availability, quantities, authoritative prices | NOT STARTED | Dev | H4 | In the RPC | Tampered price/quantity rejected | Blocking | |
| H6 | Atomic order + items | NOT STARTED | Dev | H4 | In the RPC | Failure leaves no partial order | Blocking | Today they are two separate inserts |
| H7 | Idempotency / duplicate submission | NOT STARTED | Dev | H4 | Unique `(user_id, idempotency_key)` | Double tap → one order | Blocking | |
| H8 | COD only; payment state separate from order status | IMPLEMENTED — UNVERIFIED | Dev | H4 | Enforce in the RPC; add a payment-state field | Server refuses non-cash; no "paid" from order status | Blocking | Client already COD-only (Phase 1A tests); server enforcement missing |
| H9 | Cashier confirmation never marks an order paid | NOT STARTED | Dev | Order state machine | Implement cashier flow | Test: confirmation leaves payment unpaid | Blocking | No cashier flow exists |
| H10 | Full order lifecycle test before enabling checkout | NOT STARTED | Dev | H4–H9, G8 | Staging walkthrough: order → kitchen → driver → cash collection | Evidence log entry | Blocking | Also fix driver cash amount and earnings definitions (Phase 0 D3, O6) |
| H11 | UI states that ordering is not open yet | NOT STARTED | Dev | Owner wording | Disable "Place Order" with an explanation until H10 | Button disabled; no failing request | Non-blocking | Recommended; today the request fails at the database |

---

## I. Profile, UI and design integration
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| I1 | Replace V2 profile placeholders with real data | IN PROGRESS | Dev | Data sources | `app/(app)/profile.tsx`: streak/plan-progress placeholders replaced by the real streak; still hard-coded: next delivery, last order, "Mon plan", upgrade and offers cards | No mock value visible to a real customer | **Blocking** | |
| I2 | Home energy card shows real or no data | VERIFIED | Dev | — | — | e2e: card shows 500 consumed / 1 114 remaining from real entries (E-12) | **Blocking** | **Local only.** Placeholder "40 % consommé" and fake macro bars removed |
| I3 | Out-of-scope screens hidden (upgrade, my-plan, progress, reorder, subscription deep link) | OWNER ACTION REQUIRED | Owner + Dev | Decision (Phase 0 X1) | Hide routes and links | Not reachable; `loption://subscription/active` no longer shows "Subscription Activated" | Blocking | |
| I4 | Profile load/update/error states | IMPLEMENTED — UNVERIFIED | Dev | E4 | Device test incl. offline | Retry/sign-out screen on errors; no endless reload | Non-blocking | Reload loop fixed and tested |
| I5 | V2 tabs work with hardened auth and navigation | VERIFIED | Dev | — | — | e2e opens home, menu, profile as an onboarded customer (E-03) | Blocking | **Local only.** |
| I6 | No navigation to missing or unreachable routes | VERIFIED | Dev | — | — | `tsc` with typed routes at `b5bf441` (E-09); browser check that checkout, order tracking and the nutrition screens open (E-12) | Blocking | Fixed: Expo Router 58 made every `href: null` tab screen unreachable (checkout, order tracking, my-plan, reorder, upgrade) |
| I7 | Loading / empty / error / success states reviewed | IN PROGRESS | Dev | — | Review each customer screen | Checklist per screen | Non-blocking | Done for auth, onboarding, setup |
| I8 | Small screens and keyboard | IN PROGRESS | Dev | E4 | 320 pt wide device; keyboard open on every form | No overflow; fields stay visible | Non-blocking | Auth screens checked at 320 px (web) |
| I9 | Customer language strategy | OWNER ACTION REQUIRED | Owner | — | FR only, or FR/EN/AR | Decision | Non-blocking | V2 customer screens are French-only; EN/FR switch affects staff screens only |

---

## J. Security and database readiness
Source of truth: [`PHASE1C_DATABASE_SECURITY_PLAN.md`](PHASE1C_DATABASE_SECURITY_PLAN.md) §10 (procedure) and §11 (limitations). Phase 1C revision 7 is **NOT READY FOR STAGING**.

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| J1 | Independent review of Phase 1C and approval of the staging compatibility test plan | OWNER ACTION REQUIRED | Owner | Reviewer | Draft PRs #1–#4 | Written approval | **Blocking** | Only self-reviews exist; low-severity findings of 2026-10-25 still open (§11 item 15) |
| J2 | Initial admin: owner-supplied, verified `auth.users` id in a reviewed commit | OWNER ACTION REQUIRED | Owner | Staging access | §10 step 2; `verify_initial_admin_readonly.sql` | All checks `true` | **Blocking** | Placeholder `OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID` makes the migration refuse to run (by design) |
| J3 | Staging inventory and content scan of existing `meal-images` objects | OWNER ACTION REQUIRED | Owner | Staging access | §10 step 9; `meal_images_inventory_readonly.sql`, `supabase/tools/meal_images_scan.py` | Scan report reviewed | **Blocking** | Finding M2 open: existing objects are public and unvalidated |
| J4 | Decision on image-serving mitigation (headers / separate origin / quarantine) | OWNER ACTION REQUIRED | Owner | J3 | §6 options | Written decision | **Blocking** | |
| J5 | Read-only staging preflight + manual gates (no Auth hooks; exposed schemas) | OWNER ACTION REQUIRED | Owner | J1 | §10 steps 3–4 | `all_required_checks_ok: true` | **Blocking** | |
| J6 | Deployed schema matches the reviewed baseline | NOT STARTED | Dev + Owner | J5 | Preflight + `compare_catalog.py` | No unexplained drift | **Blocking** | Baseline evidence dates from 2026-10-15 |
| J7 | Apply Phase 1C on staging, then `20261028120000_v1_onboarding_first_order_offer.sql` | OWNER ACTION REQUIRED | Owner | J1–J6, backup | §10 step 7 (supported procedure only) | `postdeploy_verify_readonly.sql` all OK; `containment_violations()` = 0 | **Blocking** | Rollback order: V1 rollback first, then Phase 1C (Phase 1C refuses while a later migration is recorded) |
| J8 | Verify RLS, function grants, Storage policies, Auth config on hosted staging | NOT STARTED | Dev | J7 | Run app flows + API probes against staging | Same results as local harnesses | **Blocking** | No hosted API, Realtime, Storage, S3 or CDN test has run |
| J9 | Staff/driver/admin flows that change under Phase 1C | NOT STARTED | Dev | J7 | Plan §7 (client changes) | Each staff flow works or is disabled with a message | **Blocking** for operations | Several admin/driver/partner flows fail silently after containment |
| J10 | Migration and rollback rehearsal on staging | NOT STARTED | Dev + Owner | J7 | Rollback only via `phase1c_rollback.sh` and `v1_onboarding_offer_rollback.sql` | Rehearsal recorded | Blocking | Hosted `db push --linked` path unverified (§11 items 2, 14, 19) |
| J11 | Explicit approval before every hosted database change | OWNER ACTION REQUIRED | Owner | — | — | Approval recorded per change | Blocking | Nothing has been applied to any hosted project |
| J12 | No destructive operations on historical data | IMPLEMENTED — UNVERIFIED | Dev | J7 | Compare row counts before/after | Counts unchanged except documented normalisation | Blocking | Migrations archive instead of deleting |

---

## K. Testing, builds and publishing
| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| K1 | Install from the committed lockfile | VERIFIED | Dev | — | `npm ci` | Exit 0; `npx expo install --check` "up to date" (E-01) | Blocking | `.npmrc` keeps `legacy-peer-deps=false` |
| K2 | TypeScript, lint, unit tests | VERIFIED | Dev | — | `npx tsc --noEmit`; `npx eslint .`; `npx jest` | tsc 0 errors; Jest 19 suites / 221 tests; ESLint 45 errors / 47 warnings, all in files outside the V1 work (E-15) | Non-blocking (lint) | Lint clean-up needs an owner decision (Phase 1A §5) |
| K3 | Dev-server bundling (Fast Refresh) and exports | VERIFIED | Dev | — | `npx expo start -c`; `npx expo export --platform <android, ios, web>` | iOS + Android dev bundles HTTP 200; all exports exit 0 (E-01, E-05) | Blocking | Fixed `react-refresh/babel` |
| K4 | Phase 1C regression harness | VERIFIED | Dev | Docker | `supabase/tests/run_phase1c.sh` | "ALL PHASE 1C LOCAL CHECKS PASSED" (E-06) | Blocking | **Local only.** Supabase CLI cases skipped (CLI not installed) |
| K5 | V1 database and app end-to-end harnesses | VERIFIED | Dev | Docker, Playwright | `supabase/tests/run_v1_onboarding_offer.sh`; `run_v1_nutrition.sh`; `run_v1_activity.sh`; `supabase/tests/e2e/run_app_e2e.sh` | All checks pass (E-17, E-19) | Blocking | **Local only.** |
| K6 | Real provider integrations | BLOCKED | Dev | A1–A3 | See A1.5, A2.6, A3.5 | Evidence entries | Blocking | |
| K7 | Native builds and device tests | NOT STARTED | Dev | E1, E4, E5 | EAS builds; device checklist covering A–I | Evidence entries per platform | **Blocking** | |
| K8 | Clean install and upgrade / returning-user scenario | IN PROGRESS | Dev | E4, J7 | Fresh install; install over the previous build with an existing account | Returning customer keeps cart scope, skips onboarding | Blocking | Clean install + returning user verified on web locally; no device or upgrade test. Whether a previous public build exists: **OWNER ACTION REQUIRED** |
| K9 | Privacy policy, terms of use, support contact, required disclosures | OWNER ACTION REQUIRED | Owner | Legal (CNDP declaration for personal and health-related data) | Publish URLs; Dev links them from welcome and profile | Links work in the app and store listings | **Blocking** | Welcome text mentions both documents, but no link or document exists |
| K10 | App Store / Play metadata, screenshots, privacy labels, data safety form | OWNER ACTION REQUIRED | Owner | K9, E5 | App Store Connect; Play Console | Listings complete | **Blocking** | `eas.json` `submit.production` is empty |
| K11 | Production configuration; remove development-only behaviour | NOT STARTED | Dev | — | Remove/guard verbose `console.log`; remove dev artefacts `app/(driver)/extractor.py`, `app/(driver)/output.txt`; hide I3 screens | Release bundle review | Blocking | |
| K12 | Pull requests and approvals | OWNER ACTION REQUIRED | Owner + Dev | Second GitHub account or reviewer | Open PRs for `claude/v1-app-integration` (and decide on `claude/v1-onboarding-auth`, `…-react-refresh`); review draft PRs #1–#6 | Approved PRs | **Blocking** | Ruleset "main-protection" applies to **all branches**: PR + **1 approving review**, no bypass actors. A PR author cannot approve their own PR, so a second reviewer is needed |
| K13 | Release candidate passes every Blocking row | NOT STARTED | Dev + Owner | All | Walk this file | Every Blocking row `VERIFIED` or waived in writing | **Blocking** | |
| K14 | Owner approval before production deployment / store submission | OWNER ACTION REQUIRED | Owner | K13 | — | Written approval | **Blocking** | |
| K15 | Align `react-native` with Expo's current SDK 58 recommendation | VERIFIED | Dev | — | `npx expo install react-native` | `npx expo install --check`: dependencies up to date (E-15) | Non-blocking | 0.88.0 → 0.88.1 on 2026-10-30; native builds still to run (E4) |
| K16 | Native prebuild | VERIFIED | Dev | E1 | `npx expo prebuild --no-install --platform all` (throwaway copy) | Succeeds for iOS and Android; HealthKit entitlement, Health Connect permissions, minSdk 26 present (E-18) | **Blocking** | **Local only.** Not a build: E4/E5 still needed |

---

## L. Calorie tracking, streaks and engagement notifications
Details: [`CALORIE_TRACKING_AND_ENGAGEMENT.md`](CALORIE_TRACKING_AND_ENGAGEMENT.md). Migration `20261029120000_v1_nutrition_tracking_engagement.sql` (proposal; not applied anywhere); rollback `supabase/rollback/v1_nutrition_tracking_rollback.sql` (run before the onboarding and Phase 1C rollbacks).

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| L1 | BMR / TDEE engine (Mifflin–St Jeor, existing multipliers), server-computed, recalculated on profile edits | VERIFIED | Dev | — | — | SQL tests N01–N05, T10; Jest energy/profile tests; e2e shows 1 345 / 1 614 kcal from the database (E-10, E-11, E-12) | Blocking | **Local only.** "Prefer not to say" → no estimate |
| L2 | Daily target policy | OWNER ACTION REQUIRED | Owner | Product/medical decision | Approve `tdee_baseline_v1` (target = TDEE) or define goal adjustments | Written decision | Blocking | Implemented: target = TDEE; the unapproved −500/+300 client adjustment removed; `goal` data kept |
| L3 | Meal nutrition data audit (calories, protein, carbs, fat) | OWNER ACTION REQUIRED | Owner | Kitchen recipes / lab values | Review every `meals` row; fill or correct values | Spot checks recorded | **Blocking** | Meals with missing/non-positive calories cannot be logged; values are frozen per entry at logging time |
| L4 | Consumption log (add, remove with audit, idempotent, own data only, local dates) | VERIFIED | Dev | — | — | SQL T01–T12; parallel retries → 1 entry; e2e log/remove/API probes (E-11, E-12) | Blocking | **Local only.** Logging window: today and 6 previous days |
| L5 | History graph (7/30 days; no-log days distinct from logged days) | VERIFIED | Dev | — | — | Screen tests; SQL T08 (NULL vs value); e2e screenshots (E-02, E-11, E-12) | Non-blocking | **Local only.** |
| L6 | Streak (persisted dates, milestones 7/14/30, removals recomputed) | VERIFIED | Dev | — | — | SQL S01–S05, N08 (E-11) | Non-blocking | **Local only.** Date-line travel can skip a calendar day |
| L7 | Reminder preferences (opt-in, local times, quiet hours, caps) and planner | VERIFIED | Dev | — | — | SQL N01–N09, R01–R02; parallel planner runs (E-11) | Blocking (if reminders ship) | **Local only.** Default cadence in the feature doc is a proposal: **OWNER ACTION REQUIRED** to approve |
| L8 | Dispatcher (Expo Push, tickets, receipts, invalid tokens) | IMPLEMENTED — UNVERIFIED | Dev | L9, E3 | Deploy `supabase/functions/dispatch-notifications` after approval | A real push arrives on iOS and Android; `notification_deliveries.status = sent`; a revoked device is deactivated | **Blocking** (if reminders ship) | Verified only against a local fake of the Expo Push API (E-12) and Jest |
| L9 | Scheduler and server secrets | OWNER ACTION REQUIRED | Owner | Approval to change the hosted project | Set `NOTIFICATIONS_CRON_SECRET` (Edge Function secrets + Vault), optional `EXPO_ACCESS_TOKEN`; create the `pg_cron` job (SQL in the feature doc) | Job runs every 15 min; function returns 200; no client can call it without the secret | **Blocking** (if reminders ship) | Never put these values in the app or `EXPO_PUBLIC_*` |
| L10 | Notification taps open the nutrition screen (cold start and background) on devices | IMPLEMENTED — UNVERIFIED | Dev | E4, L8 | Tap a delivered reminder signed in and signed out | Signed in → Mon suivi; signed out → welcome | Non-blocking | Whitelist + route gates unit-tested; web has no notifications |
| L11 | Nutrition migration review and staging application | OWNER ACTION REQUIRED | Owner + reviewer | J1–J7 | Review the nine appended monitor entries (generator diff) and the migration; apply after Phase 1C and the onboarding migration | `postdeploy_verify_nutrition_readonly.sql` all OK (monitor md5 `1bbbc1b2…`) | **Blocking** | Phase 1C's own post-deploy file reports a different monitor fingerprint after this migration by design |
| L12 | Minors and reminders | OWNER ACTION REQUIRED | Owner | C7 | Decide whether estimates and reminders are offered to under-18s | Written decision | Blocking | Inputs accept 13–100 |

---

## M. Daily activity, workouts and the Daily Tracking tab
Details: [`ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md`](ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md). Migration `20261030120000_v1_activity_tracking.sql` (proposal; not applied anywhere); rollback `supabase/rollback/v1_activity_tracking_rollback.sql` (run before the nutrition rollback).

| ID | Task | Status | Owner | Dependency | Instructions | Verification | Release impact | Notes |
|---|---|---|---|---|---|---|---|---|
| M1 | Daily Tracking tab replaces Cart; basket with live count in Home and Menu headers; cart contents preserved | VERIFIED | Dev | — | — | Jest navigation tests; e2e tab, basket, cart (E-16, E-19) | Blocking | **Local only (web).** |
| M2 | Daily energy budget (platform total / BMR + active / TDEE), negative remaining, snapshots, no double counting | VERIFIED | Dev | L2 | — | SQL E01–E11; e2e TDEE → BMR + active, workout leaves budget unchanged (E-17, E-19) | Blocking | **Local only.** Real provider totals unverified (M7–M8) |
| M3 | Meals from orders only after delivery, partial portions, never beyond quantity, missing nutrition shown as unavailable | VERIFIED | Dev | H10 (order lifecycle) | — | SQL M01–M06; Jest; e2e served vs confirmed order (E-16, E-17, E-19) | Blocking | `delivered` is not allowed by the staging `orders_status_check`; owner to confirm received statuses |
| M4 | Activity storage and security (owner-only RLS, server-stamped sync, coverage, 30-day window, disconnect deletes) | VERIFIED | Dev | — | — | SQL A01–A17; postdeploy check; rollback (E-17) | Blocking | **Local only.** |
| M5 | Workouts: walk, run, cycling, gym; pause/resume, interruption, upload queue, MET estimate, overlap and duplicate rules | VERIFIED | Dev | M10 | — | SQL W01–W16; Jest workout suite; e2e gym session (E-16, E-17, E-19) | Blocking | **Local only.** GPS distance on a device unverified (M9) |
| M6 | EAS development builds with HealthKit and Health Connect | OWNER ACTION REQUIRED | Owner + Dev | E4, Apple/Google accounts | Enable HealthKit on App ID `com.loption.app`; `eas build --profile development` | Builds install; connection screen shows "available" | **Blocking** | Expo Go cannot run these integrations |
| M7 | Apple Health on iPhone (+ Apple Watch): values match the Health app; methods per day; workouts imported once | NOT STARTED | Dev | M6 | Device checklist §10 items 1–2 | Evidence entry with screenshots | **Blocking** | Includes "access denied" and motion-sensor fallback |
| M8 | Health Connect on Android 14 and Android 9–13 | NOT STARTED | Dev | M6, M11 | Device checklist §10 items 3–4 | Evidence entry | **Blocking** | Granted / partial / revoked / not installed |
| M9 | GPS workout outdoors; app kill mid-session; time zone change | NOT STARTED | Dev | M6 | Device checklist §10 items 5–7 | Evidence entry | Blocking | Foreground-only GPS (DECISIONS #15) |
| M10 | MET tiers, plausibility limits, duplicate rule, received statuses | OWNER ACTION REQUIRED | Owner | — | Review `DECISIONS.md` proposals | Written decision | Non-blocking | Implemented as proposed |
| M11 | Play Console Health Connect declaration; App Store health privacy answers; privacy policy covering health data | OWNER ACTION REQUIRED | Owner | K9, K10 | Play Console → App content → Health Connect; App Store Connect → App Privacy | Approved declaration | **Blocking** | Google approval about 1 week + allow-list propagation |
| M12 | Retention period for health and activity data | OWNER ACTION REQUIRED | Owner | Legal (CNDP) | Decide; Dev adds a purge job | Written decision | Blocking | No automatic purge today |
| M13 | Activity notifications (movement update, workout completed, weekly summary) | OWNER ACTION REQUIRED | Owner | L7 | Approve any frequency increase | Written decision | Non-blocking | Not implemented |
| M14 | Activity migration review and staging application | OWNER ACTION REQUIRED | Owner + reviewer | L11 | Review the seven appended monitor entries and the replaced meal-log trigger; apply after the nutrition migration | `postdeploy_verify_activity_readonly.sql` all ok | **Blocking** | Fingerprint `79b9e433…` |

---

## Evidence log
Add one line per verification. Keep raw outputs outside the repository if they contain personal data.

| ID | Date | Commit | Environment | Command / test | Result |
|---|---|---|---|---|---|
| E-01 | 2026-10-28 | `b036461` | Local container | `npm ci`; `npx expo install --check`; `npx tsc --noEmit`; `npx jest`; `npx eslint .` | OK; up to date; 0 errors; 131/131; 47 errors / 48 warnings (pre-existing files) |
| E-02 | 2026-10-28 | `b036461` | Jest (mocked services) | Onboarding, setup, welcome, sign-up, auth-flow suites | Pass (mocked: proves app logic, not providers or devices) |
| E-03 | 2026-10-28 | `b036461` | Local Docker: Postgres 17.6 + GoTrue v2.186.0 + PostgREST v14.1 + SMTP sink + Chromium | `supabase/tests/e2e/run_app_e2e.sh` | 37/37 checks pass |
| E-04 | 2026-10-28 | `b036461` | Local Docker Postgres 17.6 | `supabase/tests/run_v1_onboarding_offer.sh` | All pass (29 SQL tests; Phase 1C SQL 58/0; concurrency; rollback/re-apply) |
| E-05 | 2026-10-28 | `b036461` | Local `expo start` | Dev bundle requests iOS + Android; `expo export` android/ios/web | HTTP 200 with Fast Refresh; exports exit 0 |
| E-06 | 2026-10-28 | `b036461` | Local Docker | `supabase/tests/run_phase1c.sh` | ALL PHASE 1C LOCAL CHECKS PASSED (CLI cases skipped) |
| E-07 | 2026-10-26 | `46d2c3f` | Local Docker | Phase 1C rev 7 test evidence | See `PHASE1C_TEST_RUN_2026-10-26_rev7.txt` |
| E-08 | 2026-10-29 | `b036461` | Repository | `git check-ignore` on secret file patterns; `git grep` / `git log --all -p` scan for JWT, `sb_secret_`, Google client-secret, Resend-key and private-key patterns; `git grep EXPO_PUBLIC_` | Secret files ignored; only test fixtures and documentation mentions found; app reads two public variables |
| E-09 | 2026-10-29 | `b5bf441` | Local container | `npm ci`; `npx expo install --check`; `npx tsc --noEmit` (typed routes regenerated); `npx jest`; `npx eslint .`; `expo export` android/ios; dev-server bundles iOS + Android | OK; react-native 0.88.1 now expected (K15); 0 errors; 16 suites / 162 tests; 45 errors / 47 warnings (pre-existing files); exports exit 0; bundles HTTP 200 with Fast Refresh |
| E-10 | 2026-10-29 | `b5bf441` | Local Docker Postgres 17.6 | `supabase/tests/run_v1_onboarding_offer.sh` | ALL V1 ONBOARDING/OFFER LOCAL CHECKS PASSED |
| E-11 | 2026-10-29 | `b5bf441` | Local Docker Postgres 17.6 | `supabase/tests/run_v1_nutrition.sh` | ALL V1 NUTRITION LOCAL CHECKS PASSED (21 checks: 32 SQL tests; Phase 1C SQL 58/0; V1 regression; concurrency; rollback/re-apply) |
| E-12 | 2026-10-29 | `b5bf441` | Local Docker: Postgres + GoTrue + PostgREST + SMTP sink + Chromium; fake Expo Push API | `supabase/tests/e2e/run_app_e2e.sh` | 55/55 checks pass |
| E-13 | 2026-10-29 | `b5bf441` | Local container | `npx expo config --type public`; `npx expo prebuild --no-install --platform android` (throwaway copy) | config OK; prebuild fails: ENOENT `assets/notification.wav` |
| E-14 | 2026-10-29 | `b5bf441` | Local Docker | `supabase/tests/run_phase1c.sh` | ALL PHASE 1C LOCAL CHECKS PASSED (215; Supabase CLI cases skipped) |
| E-15 | 2026-10-30 | `ca759f8` | Local container | `npx expo install --check`; `npx tsc --noEmit` (typed routes regenerated); `npx jest`; `npx eslint .` | Dependencies up to date (react-native 0.88.1); 0 errors; 19 suites / 221 tests; 45 errors / 47 warnings, none in files of this work |
| E-16 | 2026-10-30 | `ca759f8` | Jest (mocked native modules and services) | Activity providers (22), workouts (21), Daily Tracking (16) | Pass. Proves mapping and app logic only, not HealthKit, Health Connect, GPS or devices |
| E-17 | 2026-10-30 | `ca759f8` | Local Docker Postgres 17.6 | `supabase/tests/run_v1_activity.sh`; `run_v1_nutrition.sh`; `run_v1_onboarding_offer.sh`; `run_phase1c.sh` | ALL V1 ACTIVITY CHECKS PASSED (50 SQL tests; refusals; fingerprint `79b9e433…`; nutrition/V1/Phase 1C regression with T12 changed on purpose; parallel sync/upload/overlap; rollback, re-apply); nutrition, onboarding and Phase 1C harnesses all passed |
| E-18 | 2026-10-30 | `ca759f8` | Local container | `npx expo export -p web/ios/android`; `npx expo prebuild --no-install --platform all` (throwaway copy) | Exports exit 0; prebuild succeeds (HealthKit entitlement, Health Connect permissions and rationale activity, minSdk 26, motion and HealthKit usage texts) |
| E-19 | 2026-10-30 | `ca759f8` | Local Docker: Postgres + GoTrue + PostgREST + SMTP sink + Chromium (web build) | `supabase/tests/e2e/run_app_e2e.sh` | 63/63 journey checks (71 with service checks): Suivi tab replaces Panier, basket count and cart preserved, TDEE → BMR + active budget, partial-day total dropped, gym session with server MET estimate leaves the budget unchanged, undelivered order refused, delivered order logged once. **Web only: no HealthKit, Health Connect or GPS** |

## Not verifiable from this repository (as of `ca759f8`)
- Anything on the hosted Supabase project (schema drift since 2026-10-15, Auth settings, Storage/CDN headers, Realtime).
- Real Google, Apple and Resend behaviour; Apple private-relay delivery.
- Native permission dialogs, push delivery (APNs/FCM/Expo), notification taps on devices, native builds, store review.
- Apple Health, Health Connect, the iPhone motion sensor and workout GPS on real devices (checklist M6–M9).
- The Edge Function in the Supabase runtime and `pg_cron`/`pg_net` scheduling on a hosted project.
- Whether a previous production build or store listing already exists.
