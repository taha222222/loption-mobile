# L'OPTION V1 — Standalone activity and calorie tracking (phone sensors)

The phone itself is the primary activity source. Apple Health and Health Connect remain optional
(`ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md`). Branches `claude/v1-standalone-tracking`, hardening on
`claude/v1-production-hardening`.

**Verified status:** Jest, SQL harnesses in Docker, the web e2e journey, Expo prebuild for both platforms and a full
Android **release** build (`assembleRelease`, evidence E-28). The standalone migration is applied to `loption-mobile`
(E-27); the account deletion migration is **not** applied. **The Swift module has not been compiled** (no Xcode in
this environment) and **no physical device has been tested**: every item of `DEVICE_TEST_PROCEDURES.md` is NOT
VERIFIED. Privacy and store material: `PRIVACY_AND_STORE_RELEASE.md`.

## 1. What works without a health app

| Feature | iPhone | Android |
|---|---|---|
| Daily steps | Core Motion (`CMPedometer`), measured by the motion coprocessor | Hardware step counter (`TYPE_STEP_COUNTER`) |
| Walking distance | Measured by Core Motion | Estimated from steps × stride (0.415 × height), labelled "estimée" |
| History when the app was closed | The system keeps 7 days; read when the app opens | The counter keeps counting; the app saves a reading at least every ~15 min (WorkManager), more often when open |
| After a reboot | Unaffected (system history) | Steps between the last reading and the reboot are unknown and **not counted** |
| No sensor | "Cet appareil ne compte pas les pas" + manual workouts | Same |
| Live updates | On screen open and every minute while the dashboard is visible | Same (sensor batching, no polling loop) |
| GPS workouts | Background location for a session started on screen (blue indicator) | Foreground service with a "Votre activité est en cours" notification |

Native code: `modules/loption-motion` (Swift `LoptionMotionModule`, Kotlin `LoptionMotionModule`,
`StepSnapshotWorker`, `StepSnapshotStore`, `StepCounterReader`). Expo Go has no native module: the app shows
"needs the L'OPTION app build" instead of numbers.

## 2. Steps on Android: from counter readings to days (`src/activity/stepCounter.ts`)

- A day's steps are the increases between consecutive readings inside that local day.
- Reboot (boot count changed, or boot instant moved): only the steps the new boot measured are counted, from the boot time.
- Sensor reset (value went down, same boot): at most the new value.
- An interval crossing midnight is split by time only if ≤ 3 h; a longer one is left out (a gap, shown nowhere as a number).
- More than 5 steps per second is a sensor glitch and is dropped.
- DST and time zones: days use the device's IANA zone (`startOfLocalDay`), so 23- and 25-hour days are handled (tested).
- A day with readings but no increase is a measured **0**; a day without readings is **no data**.

## 3. Sync, battery and offline

- The sensor batches on its own; the app never streams sensor events to the server.
- Upload: at most every 2 minutes (`MIN_SYNC_MS`), on dashboard focus, on "Actualiser", and one row per day and source.
- Server rule for phone days: a re-sync never lowers the stored count (`activity_daily_prepare`), the measured window
  must lie inside the local day, ≤ 4 steps/s of measured time, ≤ 2.5 m per step.
- Workouts are queued on the device and retried with the same `client_session_id` (no duplicates); the gym log is
  replaced atomically by `save_gym_log()` (retries are idempotent).
- GPS: 3 s / 5 m sampling only during a running session; stops on pause, finish and discard.
- Offline: with data already on screen, a failed refresh shows "Hors connexion" and keeps the last values.

## 3a. Production hardening (branch `claude/v1-production-hardening`)

- **One phone, several accounts.** The device remembers which account last read the motion sensor
  (`src/activity/motionOwner.ts`). When a different account connects, Android readings are wiped and the account's
  history starts at that moment (`historyFrom`, passed to `syncActivity` as `notBefore`): steps measured on the phone
  before that account signed in are never uploaded to it. Background readings stop on sign-out and account change.
- **Revoked access.** iOS: `E_MOTION_DENIED` (or authorization `denied`) becomes `PermissionRevokedError`; the store
  sets the permission to denied and the dashboard says "Accès au mouvement retiré…". Android: `inspect()` re-reads the
  runtime permission and the same warning shows; readings stored before the revocation are real and still count.
- **Measured background behaviour, not the schedule.** `readingStats()` reports the last reading, readings and
  background readings over 24 h, median and longest gap; the activity screen shows them and the dashboard warns when
  the last reading is more than 60 minutes old ("En économie d'énergie, Android peut retarder les lectures…").
- **Interrupted workouts** are restored paused with "L’application a été fermée pendant la séance…".
- **iOS module**: no step counting → `E_MOTION_UNAVAILABLE`; a missing distance is sent as null, never 0.
- **Account deletion** (App Store 5.1.1(v), Google Play): Profil → Supprimer mon compte → `delete_my_account('SUPPRIMER')`
  (`20261104120000_v1_account_deletion.sql`, harness `run_v1_account_deletion.sh`, tests D01–D10). Deletes the Auth user
  and, by cascade, the profile, activity, workouts, gym log, meals, targets, notifications, push tokens and offer
  redemptions; orders are kept with the account link removed; staff, driver and partner accounts are refused (support
  closes them). On success the app clears the motion readings and signs out. **Not applied to the hosted project.**

## 4. Calorie engine (`activity_daily_summary`, method `bmr_plus_movement`)

One method per day, never a sum of overlapping measures:

| Method | When | Budget |
|---|---|---|
| `platform_total` | Health platform total for a finished day | the platform's total |
| `bmr_plus_active` | Health platform active energy | BMR + active energy (contains workouts; nothing added) |
| **`bmr_plus_movement`** | **Phone steps, no health platform** | **BMR × 1.1 + step energy + recorded workout energy** |
| `tdee_baseline` | No activity data | TDEE (BMR × declared activity level) |

- **BMR × 1.1**: rest + digestion (thermic effect of food ≈ 10 %, Westerterp 2004).
- **Step energy**: net walking cost 0.5 kcal per kg per km (horizontal term of the ACSM walking equation:
  0.1 mL O₂·kg⁻¹·m⁻¹ × ≈5 kcal/L). Distance measured by the phone, else steps × stride.
- **No double counting**: steps taken during a recorded walk/run are subtracted before step energy is computed (the
  session's own phone count; else its GPS distance ÷ stride; else a typical cadence of 1.8 steps/s walking,
  2.7 running). The workout's own estimate (MET) is then added once.
- **Workouts**: `(MET − 1) × weight × active hours`. Gym intensity: Compendium of Physical Activities 2011,
  02054 light 3.5, 02052 moderate 5.0, 02050 vigorous 6.0. Always labelled as estimates.
- A workout alone (no phone steps that day) does not create a movement budget: the day stays on the TDEE baseline.
- Without a BMR (missing profile data, sex "prefer not to say"), no personalised budget is shown.
- Remaining can be negative ("kcal au-delà"). `confidence`: measured / estimated / baseline.
- Past days use the target snapshot (weight and height of that day).

Worked example (SQL tests E01–E04, Jest `calorieWorkedExample.test.ts`; E12 checks a past day keeps its snapshot
weight, E13 the confidence label of a platform total): man, 70 kg, 175 cm, BMR 1 649 → base 1 814; 8 000 steps / 6 km measured →
210 kcal; after a 30-minute walk with 3 000 phone steps (88 kcal) → steps outside the walk 5 000 (131 kcal);
budget 1 814 + 131 + 88 = 2 033 kcal.

**Pending owner review** (`DECISIONS.md`): the 1.1 factor, the 0.5 kcal/kg/km cost and the gym MET values.

## 5. Workouts

- Start, pause, resume, finish, discard; history with steps, intensity and the gym log.
- Time from timestamps; a session killed with the app is restored paused at its last heartbeat.
- GPS: explained on screen before the system prompt; "while in use" permission only (no background-location
  permission). Inaccurate fixes (> 30 m), jitter and impossible speeds are ignored; gaps are never bridged; a
  revoked permission stops distance and says so; "Signal GPS faible" after 30 s without a fix.
- The route stays on the device; only the distance is uploaded.
- Elevation is not shown (phone barometer/GPS altitude not validated).

### 5a. Live GPS map (branch `claude/v1-gps-live-map`)

- **Flow:** choose (Marche, Course, Vélo, Randonnée, Salle de sport) → pre-start for outdoor activities (explanation,
  then the system prompt; the map shows the position, "Recherche de votre position…" → "Prêt à démarrer", or
  "Signal GPS faible" with Start still allowed; nothing is recorded before Démarrer) → live → summary. Gym never asks
  for location. A refused permission offers "Autoriser dans les réglages" (only the phone's settings can change it)
  or "Démarrer sans carte".
- **Live screen:** map following the position (system location dot; "Recentrer" after the customer pans), route drawn
  stretch by stretch from accepted points only (a gap or a pause is never joined), duration, distance, current and
  average pace (on foot) or speed (cycling), calorie estimate, large Pause/Reprendre and Terminer.
- **Current pace/speed** (`currentSpeedMps`): last minute of the running stretch, needs ≥ 15 s and ≥ 20 m and a fix
  < 30 s old, else "—".
- **Calorie preview** (`src/activity/metPreview.ts`): the server's MET tables mirrored and compared with the
  migrations by a test; the saved value is still computed by `workout_session_prepare`. No weight → "—" and a hint.
  No new constant (MET values remain pending, DECISIONS #16/#19).
- **Hiking** is saved as `kind = walk` (walking MET by speed) and labelled "Randonnée" on the phone only; history from
  the server shows "Marche" (DECISIONS #25).
- **Maps:** iPhone Apple Maps (no key). Android Google Maps only when the build has `GOOGLE_MAPS_ANDROID_API_KEY`
  (EAS environment variable read by `app.config.js`; key restricted to `com.loption.app` + signing SHA-1 and the Maps
  SDK for Android). Without it the route is drawn without map tiles (no crash). Offline: tiles may be missing; the
  route still draws.
- **Sampling** (`samplingFor`): walk/hike/run every 3 s or 5 m (High accuracy for walking/hiking, best for running),
  cycling every 2 s or 10 m with the best accuracy; nothing while paused or outside a session.
- **Background:** iOS `location` background mode with "while in use" permission, blue indicator,
  `pausesUpdatesAutomatically: false`, activity type fitness. Android location foreground service with the notification
  "Votre activité est en cours" (tap returns to the app); no `ACCESS_BACKGROUND_LOCATION`.
- **Buffer and recovery:** background fixes are stored one batch per key (no lost or doubled batch when the app drains
  at the same moment). If the system closes the app, the session reopens paused at the later of its last heartbeat and
  its last buffered real fix, and those fixes are counted. A second Terminer while saving does nothing.
- **Limits (OS rules, documented, not worked around):**
  - A force-quit (iOS swipe-away, Android "Force stop" or swipe-away with `killServiceOnDestroy`) stops GPS; the
    session is restored paused when the app is opened again.
  - iOS does not relaunch an app for standard location updates after it was terminated.
  - Android battery saver and some manufacturers' power managers may delay or stop location; the app shows the gaps
    and never fills them. The app does not ask for a battery-optimization exemption.
  - Android 13+: if notifications are refused, the service still runs but its notification may be hidden (device test
    G16).
  - The notification has no Stop button: expo-location's service supports a title and text only; Pause/Terminer are
    in the app (DECISIONS #26).
  - Signing out discards activities not yet uploaded (account isolation; DECISIONS #28).

### 5b. Database and privacy assessment (live map)

No migration is needed. `workout_sessions` already gives one row per session (`client_session_id` idempotency key,
upsert ignoring duplicates), owner-only RLS, server validation of distance (speed per kind), duration, steps and
intensity, server-only energy columns, and the one-session-at-a-time rule; the offline queue retries with the same id.
The route (GPS points) stays on the device: in the running session and up to the last 10 finished sessions, deleted by
discard, by "Supprimer le tracé de ce téléphone", by sign-out/account change and by account deletion on this phone. No
coordinates are sent to Supabase and nobody else (drivers, kitchens, staff) can see a customer's position. Map tiles are
fetched by Apple Maps / Google Maps for the visible area, which tells the map provider the approximate area; this is
listed in `PRIVACY_AND_STORE_RELEASE.md` for legal review. Storing routes on the server stays a separate decision
(DECISIONS #24).
- Gym: intensity, exercises (name, category), sets with repetitions, weight and rest timer. Nothing is detected
  automatically; calories are an estimate.

## 6. Nutrition

- Only meals the customer confirms are logged; L'OPTION meals take calories from the database.
- Manual meals ("Autre repas"): name and calories per portion entered by the customer, labelled "saisi par vous";
  the server validates ranges (1–3 000 kcal per portion, macros 0–300 g) and labels the entry `manual`.
- Portions in quarters; retries never duplicate; logging the same meal twice in a day asks first.

## 7. Database (`20261103120000_v1_standalone_tracking.sql`)

Extends existing tables (no competing system): `activity_daily_totals` (+ `measured_from`, `measured_to`; phone
distance allowed), `workout_sessions` (+ `steps`, `intensity`), new owner-only `workout_exercises` and
`workout_sets`, `nutrition_log_entries.entry_source`. Monitor extended by the generator; archiving rollback
`supabase/rollback/v1_standalone_tracking_rollback.sql`; harness `supabase/tests/run_v1_standalone.sh` (40 SQL
tests incl. cross-account cases, refusals, concurrency, rollback, regression). Applied to `loption-mobile` on
2026-11-03 with the owner's authorization (evidence E-27).

## 8. Daily Tracking screen

Plate (eaten fills the plate, calories left in the middle), info button for the method and the technical terms,
four movement tiles, large workout shortcuts or the running session, meals with calories each and a split bar, the
day's workouts, Day/Week/Month with Calories, Steps and Session-minute charts (tap for details; missing days drawn
as missing). Designed states: loading, no profile, Expo Go, no sensor, permission denied, not synced, no data, stale,
server update pending.

## 9. Device test checklist (all NOT VERIFIED)

Step-by-step procedures with expected results: `DEVICE_TEST_PROCEDURES.md`. Summary:

iPhone: step tracking with permission; app closed and backgrounded; daily reset at midnight; GPS walk/run/ride with the
screen locked; permission denied and later revoked; device restart.

Android: devices with and without a step sensor; background readings with the app closed (several hours); app
process killed; counter reset and reboot; GPS workouts with the screen off (notification visible); permission denied
and revoked; battery saver / Doze delays.

Both: duplicate prevention (retries, two devices); time-zone change and midnight; offline workout then sync;
interrupted workout; calorie values against the worked example; no double counting with a recorded walk;
cross-account (sign out / sign in another account on the same phone); manual and menu meals; dashboard values against
the server.

## 10. Owner actions

- EAS development builds for iOS and Android (Expo Go cannot run the sensors); the iOS build is also the first compile
  of the Swift module.
- Store declarations, demo video, CNDP and privacy policy: `PRIVACY_AND_STORE_RELEASE.md` §6.
- Approve the calorie-engine constants (§4, DECISIONS #19) and authorize the account deletion migration (DECISIONS #23).
