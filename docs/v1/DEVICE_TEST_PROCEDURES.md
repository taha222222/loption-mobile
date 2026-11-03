# L'OPTION V1 — Physical device test procedures (activity tracking)

**Status: every test below is NOT VERIFIED.** No physical iPhone or Android device has been used. Record each result in
the evidence log of `REMAINING_SETUP_AND_RELEASE_TASKS.md` (device model, OS version, build number, date, screenshots).
A test passes only when the expected result is observed on the device; a mock or emulator result does not count.

## 0. Setup

- Build: an EAS **development** or **preview** build (Expo Go has no native module). `eas build -p ios --profile preview`
  and `eas build -p android --profile preview` (needs the owner's Expo account; not run from this repository).
- Two test customer accounts A and B on the hosted project, both with a completed nutrition profile.
- Devices: iPhone with iOS 17 or later (motion coprocessor); Android 10+ phone **with** a step counter, and if possible
  one **without** (`android.hardware.sensor.stepcounter` absent) or an emulator for that case only.
- On Android, open Suivi → "Compter mes pas" to see the reading statistics (`reading-stats`): last reading, readings
  and background readings over 24 h, median and longest gap.
- Compare with the server: Supabase dashboard (read-only), table `activity_daily_totals` for the account, or the app's
  Daily Tracking values after "Actualiser".

## 1. iPhone

| # | Procedure | Expected |
|---|---|---|
| I1 | Fresh install, sign in A, Suivi → connect "Capteur du téléphone"; accept Motion & Fitness | Steps for today appear within a minute; matches the iOS Health/Fitness step count within a few % |
| I2 | Walk 500 steps (count them) with the app open | Increase ≈ 500 (±5 %) after the next refresh |
| I3 | Close the app (swipe away), walk 1 000 steps, reopen | The steps taken while closed are included (Core Motion history) |
| I4 | Leave the phone overnight; open after midnight | Yesterday's total kept; today starts from the steps since 00:00 |
| I5 | Settings → Privacy → Motion & Fitness → turn L'OPTION off; open Suivi | "Accès au mouvement retiré…" warning; no new numbers; nothing invented |
| I6 | Turn it back on | Steps return without reinstalling |
| I7 | Restart the phone, reopen | Same day's total (system history), no drop to 0 |
| I8 | Start a walk, allow location "While Using", lock the screen 5 min while walking, unlock | Blue indicator while locked; distance increased; GPS stops after Terminer (indicator gone) |
| I9 | During a walk, revoke location in Settings | "Localisation désactivée : la distance n’est plus mesurée." ; time keeps running; no invented distance |
| I10 | Start a walk, force-quit the app, reopen | Session restored **paused** at the last heartbeat ("L’application a été fermée pendant la séance…") |
| I11 | Airplane mode, record a gym session, finish; disable airplane mode | Session uploaded once (no duplicate after several refreshes) |

## 2. Android

| # | Procedure | Expected |
|---|---|---|
| D1 | Fresh install, sign in A, connect the phone sensor; accept "Physical activity" | Today shows steps **counted from the first reading** (Android keeps no history before it) |
| D2 | Walk 500 counted steps with the app open | Increase ≈ 500 (±5 %) |
| D3 | Close the app (swipe away) for 3 hours while carrying the phone | Background readings > 0 in the stats; steps of those hours counted; note median/longest gap honestly |
| D4 | Battery saver on, screen off for 2 h | Readings may be delayed: note the longest gap; the app shows "Dernière lecture du capteur à HH:MM…" when > 60 min |
| D5 | Force-stop in Settings → Apps | Background readings stop until the app is opened (Android rule); after reopening, steps since the last reading are counted |
| D6 | Reboot the phone after walking, then walk 300 steps and open | Steps between the last reading and the reboot are **not** counted (gap); the 300 after it are |
| D7 | Revoke "Physical activity" permission | Denied state; no new numbers |
| D8 | Device without a step counter | "Cet appareil ne compte pas les pas" + manual workouts available |
| D9 | Start a run, screen off 5 min while moving | "Séance en cours" notification visible the whole time; distance increased; notification removed after Terminer |
| D10 | Pause a GPS session | Notification and GPS stop while paused; resume restarts them |
| D11 | Kill the app process during a session (developer options or `adb shell am kill com.loption.app`) | Session restored paused on reopen |
| D12 | Midnight with the phone on the counter (app closed) | Interval split only if ≤ 3 h; otherwise a gap; never more than measured |

## 3. Both platforms

| # | Procedure | Expected |
|---|---|---|
| B1 | Account switch: A has steps; sign out, sign in B on the same phone | B's day starts at the sign-in time (`historyFrom`); none of A's steps or workouts appear for B; A's rows on the server unchanged |
| B2 | Sign back in as A | A's history from the server; device readings taken while B was signed in are not attributed to A |
| B3 | Two devices signed in as A | One row per day and source; the higher count is kept; no duplicate workouts |
| B4 | Change the phone's time zone and cross midnight | Days follow the device's local zone; no double day |
| B5 | Worked example: profile man 30 y, 70 kg, 175 cm; walk with the app recording 30 min | Budget = base (BMR × 1,1) + steps outside the walk + walk energy; steps of the walk counted once (info sheet lines) |
| B6 | Log an L'OPTION meal and a manual meal | Consumed kcal updated; manual meal labelled "saisi par vous" |
| B7 | Offline: open Suivi in airplane mode after a successful sync | "Hors connexion" banner with the last values; no error screen |
| B8 | Delete account (test account only, after the migration is applied) | Signed out; signing in again fails; server rows for that user gone; orders kept without the account link |
| B9 | Battery: 8 h of normal use with background readings on | Note battery use attributed to L'OPTION in system settings (target: no significant share) |
