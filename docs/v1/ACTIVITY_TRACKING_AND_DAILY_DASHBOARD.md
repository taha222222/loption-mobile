# L'OPTION V1 — Daily activity, workouts and the Daily Tracking tab

**Status (2026-10-30, branch `claude/v1-activity-tracking`):** implemented and tested locally (Jest, SQL harness, web e2e). **Not verified on any real iPhone or Android device, no native build has been made, and nothing is applied to a hosted database.** Real HealthKit and Health Connect behaviour is therefore unverified. Do not call this feature complete until the device checklist in §10 passes.

Builds on [`CALORIE_TRACKING_AND_ENGAGEMENT.md`](CALORIE_TRACKING_AND_ENGAGEMENT.md): meal logging, server-side calories, target snapshots, streaks and reminders are reused, not rebuilt.

## 1. What the customer gets
- **Suivi tab** (`app/(app)/tracking.tsx`) replaces the Cart tab. In order: the day's balance (budget, eaten, remaining, activity energy), how the budget was computed, steps/distance/active energy with source and sync time, workout quick starts, the day's meal and workout journal, and a 7/30-day chart. Tapping a day in the chart inspects it.
- **Basket:** the cart screen, store and add-to-cart are unchanged. It opens from a basket with a live count in the Home and Menu headers (`BasketButton`). Checkout behaviour is unchanged and still not enabled for real orders (trusted order creation is not approved).
- **Workouts** (`workout.tsx`, `workout-history.tsx`): walk, run, cycling, gym. Start, pause, resume, finish, abandon, history.
- **Health connection** (`activity-connect.tsx`): optional, read-only, with disconnect and "disconnect and delete imported data".
- **"J'ai mangé ce repas"** on a received order (`order-tracking/[id].tsx` → `log-meal?orderId=`).

Design: one original visualisation, the **energy path** (`DailyBalanceCard`). It is a single bar for the day's budget. Its lighter-gold end is the part earned by measured movement, and the solid gold fill is what was eaten. Over budget, the bar is full and a coral tab says by how much. It uses only existing V2 tokens (indigo `brand`, gold `highlight`, `coral`), V2 cards and typography. There are no rings and no route maps. Customer copy is French, like the other V2 customer screens. No new language was added (the language strategy is still undecided, checklist I9).

## 2. Platform integrations

| Platform | Source | Library | Reads | Needs |
|---|---|---|---|---|
| iOS | Apple Health | `@kingstinct/react-native-healthkit` 16.2 (+ `react-native-nitro-modules`) | step count, walking+running distance, active energy, basal energy, workouts | dev/store build with the HealthKit entitlement |
| iOS (fallback) | iPhone motion coprocessor | `expo-sensors` Pedometer | steps only, last 7 days | Motion & Fitness permission |
| Android | Health Connect | `react-native-health-connect` 4.1 (Expo plugin bundled) | Steps, Distance, ActiveCaloriesBurned, TotalCaloriesBurned, ExerciseSession | dev/store build; minSdk 26; Health Connect installed (built in from Android 14) |
| Web | — | — | nothing | the screen says so |

- **Expo Go is not supported.** The native modules load lazily, and their absence shows "Version de l'application requise" instead of crashing (tested).
- **Android without Health Connect:** the platform step sensor only counts while the app is open and keeps no history, so it cannot give an honest daily total. It is not offered.
- **Background:** HealthKit background delivery is disabled (`background: false`) and Health Connect background reads are not requested. Data is read when the app opens or the Suivi tab gets focus. The UI says there is no continuous background tracking.
- Only one source is connected per device. The server also uses only one source per day (§4).

### Configuration in this branch (`app.json`)
- `@kingstinct/react-native-healthkit` plugin: `NSHealthShareUsageDescription` (French), `NSHealthUpdateUsageDescription: false` (read-only), `background: false`. It adds the `com.apple.developer.healthkit` entitlement (checked by prebuild).
- `react-native-health-connect` plugin: the permission-rationale intent filter and the Android 14 `VIEW_PERMISSION_USAGE` alias. `android.permissions` adds `health.READ_STEPS`, `READ_DISTANCE`, `READ_ACTIVE_CALORIES_BURNED`, `READ_TOTAL_CALORIES_BURNED` and `READ_EXERCISE`.
- `expo-build-properties`: `android.minSdkVersion = 26`.
- `expo-sensors` plugin: `NSMotionUsageDescription` (French).
- Location text updated: GPS is used only while a workout the customer started is running.
- **Native build blockers fixed:**
  - Removed the `sounds` entry that pointed at the missing `assets/notification.wav`. The code never used it (`sound: 'default'`). A licensed custom sound can be added later.
  - `react-native` 0.88.0 → 0.88.1, as `npx expo install --check` required.
  - `npx expo prebuild --no-install --platform all` now succeeds (throwaway copy).

### Owner actions for a device build
1. Apple: enable the HealthKit capability on App ID `com.loption.app`. Regenerate the provisioning profiles (EAS does this on the next build when credentials are EAS-managed). Answer the App Store privacy questions for health and fitness data.
2. Google: in the Play Console, complete the Health Connect permission declaration for the five read permissions, and link a privacy policy. Approval can take about a week, plus allow-list propagation.
3. `eas build --profile development --platform ios` / `android`, then install on devices.
4. Privacy policy text covering health and activity data (checklist K9; CNDP declaration in Morocco).

## 3. Permissions
- **Health data:** asked only from the connection screen, after an explanation. Read access only, using the minimum set in §2. iOS never reveals whether read access was granted. After the request the app says "Accès demandé" and, if no data arrives, explains where to enable it (Santé › Partage › Apps). Health Connect reports granted, partial and refused, and each is handled. Refusing keeps the app fully usable.
- **Motion (iPhone fallback):** asked when connecting that source.
- **GPS:** foreground "while in use" permission, asked when starting a walk, run or ride with "Mesurer la distance avec le GPS" on. If it is refused, the session starts without distance and says so. No background location.

## 4. Data model (migration `20261030120000_v1_activity_tracking.sql`)
- `activity_daily_totals`: one row per customer, local date and source.
  - **Client sends:** date, source, time zone, steps, distance, active energy, total energy.
  - **Server stamps:** owner and sync time, and enforces the window (today and the previous 30 days in the given zone).
  - **Coverage:** `complete` only if the local day was over at sync time. A partial day never keeps a total energy value, and a total below the active energy is dropped.
  - **Missing vs zero:** NULL means "no data"; 0 means a measured zero.
  - **First sync of a day:** records that day's BMR/TDEE snapshot (same as the first meal).
- `workout_sessions`: app sessions and imported provider sessions.
  - **App sessions:** cannot send an energy value. The server computes a MET estimate from the profile weight (§6).
  - **Imported sessions:** keep the provider's measured energy.
  - **Idempotency:** by `client_session_id` (app) and `(source, external_id)` (imports).
  - **Validation:** app sessions cannot overlap, and an implausible average speed is refused (walk > 3.5 m/s, run > 7, cycle > 25). Gym sessions have no distance. Sessions are limited to the last 30 days.
- **Read functions** (SECURITY INVOKER, own rows via RLS): `activity_workouts()`, `activity_energy_estimate()`, `activity_daily_summary()`.
- **Meals from orders:** `order_received()` returns true for `delivered` and `served`. `nutrition_log_entry_prepare()` is replaced by the same function plus that check. The migration refuses unless the function is the reviewed nutrition version (md5), and the rollback restores it (generated, md5 checked).
- **Sync** (`src/activity/sync.ts`): the last 7 local days, with day bounds computed per IANA zone (DST-safe). Transport failures are retried with 1 s and 2 s backoff; server refusals are not retried. Days are upserts (one row each) and workouts are inserted once.

## 5. Daily energy calculation
One method per day. The result and the method are returned by `activity_daily_summary()` and shown on the card.

| Method | When | Budget |
|---|---|---|
| `platform_total` | finished day, the platform reported a total, and total ≥ BMR (otherwise basal coverage was incomplete) | platform total |
| `bmr_plus_active` | platform active energy exists and BMR is known (today: active energy so far, so the budget grows during the day) | BMR + active |
| `tdee_baseline` | otherwise | TDEE (BMR × declared activity level) |
| none | no BMR/TDEE (missing inputs or "prefer not to say") | no budget. Consumed calories, steps and workouts are still shown, with a "complete your profile" action |

- `remaining = budget − consumed`. It is not clamped and is shown as "Au-delà du budget +N".
- BMR and TDEE come from that day's snapshot. For today without a snapshot, the current profile is used. A profile change recalculates today, and past days keep their snapshot and method.
- No deficit or surplus is applied (target policy `tdee_baseline_v1` is unchanged).

## 6. Double-counting prevention
- **Never `TDEE + steps + workouts`:** the TDEE already contains habitual activity, and the platform's active energy already contains walking, running and workouts.
- **Steps and distance:** shown as movement metrics only; never converted to calories.
- **Workout energy:** never added to the budget. It is shown in the journal, labelled measured or estimated.
- **One activity source per day:** the health platform wins over the iPhone sensor, then a complete day, then the latest sync. Sources are never summed.
- **App vs imported duplicates:** an app session and an imported session of the same kind that overlap by at least 50% of the shorter one are paired. The preferred one is counted: imported with measured energy, then imported, then app. The other is listed as "Doublon … non compté".
- **GPS:** gives distance only, never calories.

## 7. Workouts
- **Time:** measured from timestamps, so it stays correct in the background; pauses are excluded.
- **Interrupted sessions:** a session left running when the app was terminated is restored paused at its last heartbeat (15 s) and marked "Séance interrompue". The unknown gap is never counted.
- **Upload queue:** finished sessions wait in a persisted queue until the server confirms them. A network failure keeps the session; a server refusal is explained. An implausible GPS distance is dropped and the session is kept.
- **GPS:**
  - **When:** foreground only, while the workout screen is open.
  - **Filtering:** fixes worse than 30 m accuracy, jitter and impossible speeds are ignored, and gaps longer than 30 s are never bridged.
  - **Storage:** the route stays in memory and only the distance is uploaded.
- **Pace and speed:** pace (walk, run) and average speed (cycling) are shown only from 100 m and 1 min.
- **Energy estimate:**
  - **Formula:** `(MET − 1) × weight_kg × active hours`, which is net energy above rest and comparable with a platform's active energy.
  - **MET values:** approximate tiers from the Compendium of Physical Activities (Ainsworth et al. 2011), by average speed. Walk 2.0–5.0 (3.5 without distance), run 6.0–14.5 (7.0), cycling 4.0–12.0 (7.5), gym 3.5.
  - **Labels:** shown as "estimation (MET × poids × durée)". Without a valid weight, "Calories indisponibles".
  - **Review:** the values are pending owner review (DECISIONS).
- **Gym:** a timer only. Exercises are not recognised.
- **Imported workouts:** walking, running, cycling and strength types from Apple Health and Health Connect. Other types are ignored.

## 8. Notifications
Not extended in this phase. Each possible activity message (daily movement update, workout completed, weekly summary) would add notifications, and frequency increases need owner approval. They are listed as proposals in `DECISIONS.md`. The existing dispatcher, quiet hours, caps and idempotency are unchanged.

## 9. Privacy and security
- **Access:** owner-only RLS on both new tables, column-level insert grants, no client UPDATE on workouts, no anon access. Server-derived columns (owner, sync time, coverage, energy, MET, weight) are not client-writable; the postcondition checks this.
- **Phase 1C monitor:** extended by `supabase/tools/generate_nutrition_monitor.py` with seven reviewed owner-only policies, and no client-callable SECURITY DEFINER function. The migration refuses unless the monitor is the nutrition-migration version (`1bbbc1b2…`) and requires 0 violations before COMMIT. New fingerprint `79b9e433ed0e38d803cdeb89b9847d89` (`supabase/tests/postdeploy_verify_activity_readonly.sql`). **This extension needs the same independent review as Phase 1C.**
- **Minimal collection:** the sync window is 7 days and only daily totals are stored, with no per-sample data and no GPS route.
- **Retention:** no automatic purge yet. The period is an owner decision.
- **Deletion:** health data is deleted with the account (`on delete cascade`). "Disconnect and delete" removes the source's days and imported workouts.
- **On the device:** only the connection choice and an in-progress workout are stored per account, and both are cleared when another account signs in.
- **No sharing:** no public feed and no sharing in this phase. No service-role key or secret in the app.

## 10. Testing

| Check | Command | Result (2026-10-30) |
|---|---|---|
| Unit and screen tests | `npx jest` | 19 suites, 221 tests pass (new: activity providers 22, workouts 21, daily tracking 16). All results at commit `ca759f8` |
| Types | `npx tsc --noEmit` (typed routes regenerated) | 0 errors |
| Activity SQL harness | `bash supabase/tests/run_v1_activity.sh` | ALL V1 ACTIVITY CHECKS PASSED: 50 SQL tests; refusals; fingerprint; nutrition/V1/Phase 1C regression (nutrition T12 changed on purpose: confirmed orders can no longer be logged); parallel sync, upload and overlap; rollback, re-apply; nutrition rollback refused while applied |
| Native config | `npx expo prebuild --no-install --platform all` (throwaway copy) | succeeds; HealthKit entitlement, Health Connect permissions and minSdk 26 generated |
| Exports | `npx expo export -p web/ios/android` | pass |
| App e2e (web, real local Auth/PostgREST/Postgres) | `bash supabase/tests/e2e/run_app_e2e.sh` | 63/63 journey checks: tab and basket, TDEE → BMR + active budget, gym session (MET estimate, budget unchanged), meals from undelivered/delivered orders (E-19). Web only |

Mocked tests prove the app's mapping and logic, not HealthKit or Health Connect.

**Device checklist (not done; required before release):**
1. **iPhone with Apple Watch:**
   - connect Apple Health;
   - step, distance and active-energy values match the Health app for today and yesterday;
   - yesterday uses `platform_total`, today `bmr_plus_active`;
   - a watch workout is imported once;
   - a parallel app session is marked as a duplicate.
2. **iPhone without a watch:**
   - no basal energy, so no platform total;
   - deny access: "aucune donnée" with instructions;
   - the motion-sensor fallback gives steps only.
3. **Android 14 with Health Connect and a fitness app:**
   - granted, partial and denied permissions;
   - revoke in Health Connect settings: the next sync shows a denied or no-data state;
   - imported sessions.
4. **Android 9–13:** Health Connect missing, then the install path.
5. **GPS walk outdoors:**
   - distance and pace are plausible;
   - after background and return, no straight-line jump;
   - GPS denied: the session continues without distance.
6. **Kill the app mid-session:** relaunch, "Séance interrompue", resume and finish.
7. **Time zone change mid-day:** dates and sync follow the device zone.

## 11. Known limitations
- Real provider behaviour is unverified. In particular, whether Health Connect's TotalCaloriesBurned aggregate includes derived basal energy, and how HealthKit reports partial basal coverage.
- GPS distance only while the workout screen is open (no background location). The health platform's own step and distance counts continue in the pocket.
- Imported workouts are not updated if later edited in the health app (first import wins).
- The order lifecycle is undecided. `delivered` (app driver flow) is not allowed by the staging schema's `orders_status_check`; `served` is. Both count as received.
- Today's `bmr_plus_active` budget starts at BMR in the morning and grows with measured activity. This is by design, and the screen explains it.
- Activity-specific notifications are not implemented (§8).

## 12. Migration and rollback
- Apply only after Phase 1C, `20261028120000` and `20261029120000`, as role `postgres`, after approval: `psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261030120000_v1_activity_tracking.sql`. Then run `supabase/tests/postdeploy_verify_activity_readonly.sql`.
- Rollback, newest first, with an approved task and a backup: `psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/v1_activity_tracking_rollback.sql`.
  - **Archive:** both tables go to the private schema `v1_activity_rollback_archive`.
  - **Restore:** the nutrition monitor (md5 checked) and the original meal-log trigger (md5 checked).
  - **Order:** then the nutrition rollback, the onboarding rollback, then Phase 1C. The nutrition rollback refuses to run while this migration is applied.
