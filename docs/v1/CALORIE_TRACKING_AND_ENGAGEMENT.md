# L'OPTION V1 — Calorie engine, daily tracking, streaks and engagement notifications

Status: **implemented and verified locally; not deployed.** Branch `claude/v1-nutrition-tracking` (based on `claude/v1-release-checklist` → `claude/v1-app-integration`, which already integrates Phase 1A, Phase 1C revision 7 and redesign V2 / Expo SDK 58). Phase 1C remains **NOT READY FOR STAGING**; this work depends on it and does not change that. Checkout stays disabled. No hosted Supabase project, Expo account or provider was contacted.

## 1. Calculation engine

| | |
|---|---|
| BMR (man) | 10 × weight (kg) + 6.25 × height (cm) − 5 × age + 5 |
| BMR (woman) | 10 × weight (kg) + 6.25 × height (cm) − 5 × age − 161 |
| TDEE | BMR × activity multiplier: sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very_active 1.9 |
| Rounding | whole kcal; TDEE from the unrounded BMR |
| Valid inputs | age 13–100 (whole years), weight 30–300 kg, height 100–250 cm, one of the five activity levels |
| No estimate | sex input "prefer not to say" (`unspecified`), or any input missing/out of range → BMR, TDEE and target are `NULL` and the app says a personalised estimate is unavailable |

- **One implementation per side, same rules:** `src/nutrition/energy.ts` (app preview, unit-tested) and `public.estimate_energy()` (database, used by the `user_profiles` trigger from the onboarding migration). The SQL tests and Jest tests assert the same reference values (1649/2556 kcal and 1345/1614 kcal).
- **Stored server-side only:** `user_profiles.bmr_kcal`/`tdee_kcal` are trigger-computed on every profile change; clients cannot write them. Editing the profile (`Mon suivi › Vos estimations › Modifier`) recalculates immediately.
- The multipliers are the ones the app already used; no second set exists.

### Daily target policy (`tdee_baseline_v1`)
**Daily target = TDEE.** No calorie deficit or surplus is applied. The legacy client goal adjustment (−500 kcal for "lose fat", +300 for "gain muscle") was not an approved policy and was removed from the app; the `goal` column and data are kept. Weight-loss / maintenance / weight-gain targets need an approved product decision (and probably medical review). All figures are labelled as estimates, not medical advice.

## 2. Data model (migration `20261029120000_v1_nutrition_tracking_engagement.sql`)

| Object | Purpose | Written by |
|---|---|---|
| `user_profiles.time_zone` | Customer's IANA zone (synced from the device; validated) | Owner (column grant) |
| `nutrition_log_entries` | A meal the customer says they ate: local date, time zone, meal, servings (¼ steps, ≤ 10), optional order item, **calories/macros copied from `meals` by a trigger**, `client_request_id` (idempotency, unique per user), `deleted_at` (removal mark) | Owner inserts the 6 client columns only; triggers set the rest |
| `nutrition_daily_targets` | Target that applied to a day: target, BMR, TDEE, policy, formula, profile inputs, time | Triggers only (first entry of a day; today's row follows profile changes) |
| `nutrition_daily_summary(from, to, today)` | One row per day: entries, consumed kcal, macros, `has_log`, target and its source | Read function (invoker, RLS) |
| `nutrition_streak(today)` | Current/longest streak, last logged day, next milestone | Read function (invoker, RLS) |
| `notification_preferences` | Opt-in reminders, times, quiet hours, time zone | Owner |
| `notification_settings` | Global caps, send window, re-engagement rules, kill switch | Server only |
| `notification_deliveries`, `notification_delivery_tickets` | Outbox with dedupe keys; provider tickets and receipts | Server only |
| `register_push_token()`, `deactivate_push_token()` | Bind a device token to the signed-in account / stop it at sign-out | Owner (SECURITY DEFINER, reviewed) |
| `nutrition_plan_notifications()`, `nutrition_claim_deliveries()`, `nutrition_record_delivery()`, `nutrition_pending_receipts()`, `nutrition_record_receipts()` | Planner and dispatcher steps | `service_role` only |

**Calorie source:** `public.meals.calories` (and `protein`, `carbs`, `fat`), entered by L'OPTION staff. These values are **not independently verified** (owner action, see the release checklist). Meals with a missing or non-positive calorie value cannot be logged. `order_items` has no nutrition snapshot, so an ordered meal is logged with the meal's current values at logging time, which are then frozen in the entry.

**Ordered ≠ eaten:** nothing is logged automatically. The customer picks an ordered meal and a serving count; the server refuses more servings than were ordered and items from someone else's order.

**History:** an entry freezes its calories; a day's target is frozen in `nutrition_daily_targets`; profile changes update only *today's* target. A day with no entries shows no target (unless a snapshot exists) and never a fabricated value.

## 3. Access controls
| Data | Customer (authenticated) | anon | service_role | Enforcement |
|---|---|---|---|---|
| Own log entries | read, insert (6 columns), mark removed | — | full | RLS owner policies, column grants, triggers |
| Other customers' entries | none | — | full | RLS |
| Calories of an entry | never writable | — | — | no column privilege; trigger overwrites |
| Daily targets | read own | — | full | RLS; triggers write (definer) |
| Summary / streak | own only | — | — | invoker functions + RLS |
| Preferences | own read/insert/update | — | full | RLS, column grants, validation trigger |
| Push tokens | register / deactivate own device | — | full | definer RPCs (token format checked) |
| Settings, outbox, tickets | none | none | full | no client privileges |
| Planner / dispatch functions | none | none | execute | EXECUTE revoked from clients |

**Phase 1C monitor:** `containment_violations()` is re-created with exactly nine reviewed entries appended (7 owner policies, 2 definer RPCs), generated mechanically from the Phase 1C migration by `supabase/tools/generate_nutrition_monitor.py`; the migration refuses to run unless the monitor is the reviewed revision-7 function (md5 `86b0dca9…`) and requires zero violations before COMMIT. New monitor md5: `1bbbc1b29865c5700a680b3711ef84e3` (checked by `supabase/tests/postdeploy_verify_nutrition_readonly.sql`; Phase 1C's own post-deploy file reports a different fingerprint after this migration by design). No RLS was weakened.

## 4. App (V2)
| Where | What |
|---|---|
| Home (`app/(app)/index.tsx`) | Today card: remaining / consumed / target / % of target and streak — real data; replaces the placeholder "40 % consommé" card and fake macro bars. Tap → Mon suivi. Bell → Rappels. |
| Mon suivi (`app/(app)/nutrition.tsx`) | Today card, "Ajouter un repas consommé", estimates (BMR, TDEE, target with the policy text), today's entries with removal, streak card, 7/30-day chart, loading/error/empty states. Replaces the hard-coded `progress.tsx`. |
| Ajouter un repas (`app/(app)/log-meal.tsx`) | Today/yesterday, recent own orders, menu meals with calories, servings stepper, calorie preview, idempotent save with retry. |
| Profil nutritionnel (`app/(app)/nutrition-profile.tsx`) | Edit sex input, age, weight, height, activity → server recalculation. |
| Rappels (`app/(app)/nutrition-reminders.tsx`) | Opt-in switch (off by default), per-type toggles and times, quiet hours, permission state with settings link. |
| Profil tab | Real current/longest streak; the fake "+50 pts" streak and "65 % plan" cards removed (other V2 placeholders remain, see checklist I1). |

**Graph semantics:** filled bar = calories logged that day; yellow tick = the target that applied that day (when known); dashed outline = **no meal logged** (never drawn as 0); coral bar = above target; today highlighted. Every day has an accessibility label ("aucun repas enregistré" or "N kcal consommées, objectif T kcal").

**Fixed while integrating (pre-existing since the SDK 58 upgrade):** screens declared with `href: null` in the customer tabs (checkout, order tracking, my-plan, reorder, upgrade) could not be opened at all — Expo Router 58 turns `href: null` into a hidden route that redirects. They are now normal routes without a tab button (the V2 pill bar draws only its five tabs), and back navigation follows history.

## 5. Streak rules
- A day counts when it has at least one non-removed entry (local calendar date stored with the entry). Calories need not match the target.
- Current streak = consecutive days ending today, or yesterday while today has no entry yet (the day is not over). Longest = longest run ever. Both are recomputed from records, so removals/edits are reflected immediately.
- Multiple entries or time zones on the same date count once; a travel day that skips or repeats a date is handled by the dates themselves (documented limitation: crossing the date line can skip a calendar day).
- Milestones: 7, 14, 30, then every 30 days; the next milestone is shown. No points or rewards.
- Opening the app or tapping a notification never changes a streak.

## 6. Notifications
### Templates (French; stored in `public.nutrition_notification_text`)
| Kind | Title | Body | Sent only when |
|---|---|---|---|
| daily_target | Votre objectif du jour est prêt 🎯 | Ouvrez L'OPTION pour consulter votre objectif calorique d'aujourd'hui. | a target exists; user not inactive |
| progress | Votre suivi du jour | Vous avez enregistré {{consumed_kcal}} kcal aujourd'hui. Consultez les calories restantes dans L'OPTION. | a target exists and ≥ 1 meal logged today |
| evening | Votre journal du jour | Avant la fin de la journée, pensez à enregistrer les repas que vous avez réellement consommés. Vos progrès se construisent jour après jour. | nothing logged today |
| milestone | 🔥 {{n}} jours de suivi d'affilée ! | Bravo pour votre régularité. Jetez un œil à vos progrès de la semaine. | today's entry completes a 7/14/30/… streak (once per streak and milestone) |
| reengagement | Votre suivi vous attend | Votre journal nutritionnel est prêt quand vous l'êtes. Revenez sur L'OPTION pour continuer. | logged before; inactive ≥ 3 days; cooldown and monthly cap |

Every notification carries `data = {screen: 'nutrition', url: 'loption://nutrition', kind}`. The app maps only known `screen` values to routes (`src/navigation/notificationLinks.ts`) and the routing policy still applies: signed-out → welcome; staff → their own area.

### Proposed default cadence (for review; all configurable)
| Setting | Default | Where |
|---|---|---|
| Reminders | **off until the customer opts in** | per user |
| Daily target reminder | on (when opted in), 12:00 local | per user |
| Progress reminder | off, 16:00 local | per user |
| Evening reminder | off, 20:30 local | per user |
| Milestones | on (when opted in) | per user |
| Re-engagement | off | per user |
| Quiet hours | 22:00–08:00 local (reminder times inside them are refused) | per user |
| Max notifications per user per local day | 2 | `notification_settings` |
| Send window after a reminder time | 120 min (a late run sends nothing) | `notification_settings` |
| Re-engagement | after 3 inactive days; cooldown 7 days; ≤ 2 per 30 days; replaces the daily reminder while inactive | `notification_settings` |
| Global kill switch | `sending_enabled` | `notification_settings` |

Idempotency: each notification has a dedupe key (user + kind + local day; milestone: user + streak start + n); parallel planner runs and retries never queue twice (tested with 4 parallel runs). Claims use `FOR UPDATE SKIP LOCKED`; a crashed claim is retried after 10 min, at most 3 attempts.

### Delivery path
`pg_cron` (every 15 min) → Edge Function `dispatch-notifications` (`supabase/functions/dispatch-notifications/`) → planner → claim → Expo Push API (chunks of 100) → tickets recorded → receipts checked after 15 min → `DeviceNotRegistered` deactivates the token. Sign-out deactivates the device token; a token registered by another account on the same device moves to that account.

### Environment / owner configuration (placeholders only)
| Item | Where | Notes |
|---|---|---|
| EAS project id | `app.json` → `expo.extra.eas.projectId` (already set) | Needed for `getExpoPushTokenAsync` in dev/production builds |
| APNs key (iOS) | EAS → Credentials (or Apple Developer → Keys) | **OWNER ACTION REQUIRED** |
| FCM V1 service-account credentials (Android) | Firebase project → upload to EAS | **OWNER ACTION REQUIRED** |
| `EXPO_ACCESS_TOKEN` (optional, Expo enhanced push security) | Supabase → Edge Functions → Secrets | server-side only |
| `NOTIFICATIONS_CRON_SECRET` | Supabase → Edge Functions → Secrets, and Supabase Vault for the cron job | random value chosen by the owner; never in the app |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | provided to Edge Functions by Supabase | never in the app or `EXPO_PUBLIC_*` |
| Deploy | `supabase functions deploy dispatch-notifications` | after approval only |
| Schedule | SQL below, after deployment | after approval only |

```sql
-- OWNER ACTION, after the function is deployed (values are placeholders).
select vault.create_secret('<NOTIFICATIONS_CRON_SECRET>', 'notifications_cron_secret');
select cron.schedule('dispatch-notifications', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer <anon-key>',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_cron_secret')),
    body := '{}'::jsonb)
$$);
```

## 7. Tests
| Suite | Command | Covers |
|---|---|---|
| Jest | `npx jest` | energy formulas/multipliers/boundaries; target policy; recalculation; dates & time zones; summaries (no-log vs logged), remaining, chart scale; streak display; reminder times & quiet hours; deep-link whitelist; store idempotency key reuse; screens (real values, no-log days, missing target, ordered-meal flow, retry); dispatcher (tickets, DeviceNotRegistered, HTTP failure, chunking, receipts, secret check) |
| Database | `supabase/tests/run_v1_nutrition.sh` | generator check; refusals (no V1 migration, wrong role, altered monitor, gated COMMIT under ON_ERROR_ROLLBACK); 32 SQL tests (tracking, history, time zones, ordered meals, streaks, tokens, preferences, planner: local time/window/idempotency/cap/quiet hours/eligibility/opt-out/no token/milestone/re-engagement cooldown, dispatch outcomes); V1 and Phase 1C SQL tests still pass; parallel planner and log retries; rollback/re-apply |
| End to end | `supabase/tests/e2e/run_app_e2e.sh` | web build + local GoTrue/PostgREST/Postgres: onboarding → home with real calorie card → log/remove/log a meal → streak → API protections → reminder opt-in → token registration → dispatcher run against a **fake** Expo push service (sent, idempotent re-run, progress text with the real total, DeviceNotRegistered deactivation) |

## 8. Known limitations and open decisions
- **Not verified:** real push delivery (APNs/FCM/Expo), native permission dialogs, notification taps on a device, background/cold-start deep links on a device, the Edge Function in the Supabase runtime, `pg_cron`/`pg_net` on a hosted project.
- **Meal nutrition data** is staff-entered and unaudited; an owner must verify calories/macros before customers rely on them.
- **Goal-adjusted targets** (loss/gain) are not implemented by design (decision needed).
- **Minors:** inputs accept 13–100; whether estimates and reminders are offered to minors is an owner decision (checklist C7).
- **Time zones:** "today" follows the device zone at logging time; crossing the international date line can skip or repeat a calendar date; a past day's target stays the one captured that day.
- **Re-engagement** is limited to users who logged before; never-logged users get nothing.
- **Logging window:** today and the previous 6 days.
- **Rollback order:** `v1_nutrition_tracking_rollback.sql` first (archives data, restores the Phase 1C monitor), then the onboarding/offer rollback, then any Phase 1C rollback.
