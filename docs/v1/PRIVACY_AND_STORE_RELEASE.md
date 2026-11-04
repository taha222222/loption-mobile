# L'OPTION V1 — Privacy declarations and store release preparation

Draft material for the owner and a legal reviewer. **Nothing here has been submitted** to App Store Connect, the Play
Console or the CNDP. Items marked **LEGAL REVIEW** must be checked by a Moroccan data-protection lawyer before release.
Tracking design: `STANDALONE_TRACKING.md`, `ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md`. Release checklist:
`REMAINING_SETUP_AND_RELEASE_TASKS.md` (K, M).

## 1. What the app collects (source of every store answer below)

| Data | Where it comes from | Stored on the server | Purpose |
|---|---|---|---|
| Name, e-mail, phone | Sign-up / Apple / Google sign-in | `user_profiles`, Auth | Account, delivery contact |
| Delivery addresses (with coordinates once confirmed) | Customer, optional GPS suggestion | Yes | Delivery |
| Orders (cash on delivery) | Customer | Yes (kept for accounting; detached on account deletion) | Orders |
| Sex, age, weight, height, activity level | Nutrition onboarding | `user_profiles`, daily target snapshots | Calorie estimates |
| Daily steps and walking distance | iPhone Core Motion / Android step counter; optionally Apple Health or Health Connect | One row per day (`activity_daily_totals`) | Daily balance |
| Workouts: kind, times, duration, steps, distance, intensity, gym exercises and sets | Started by the customer in the app | `workout_sessions`, `workout_exercises`, `workout_sets` | Daily balance, history |
| Workout route (GPS points) | Phone GPS, **only during a session the customer starts** | **No — stays on the device**; only the distance is uploaded | Distance, route sketch |
| Meals logged | Customer (L'OPTION meals or manual entries) | `nutrition_log_entries` | Daily balance |
| Push token | Device (drivers / notifications) | Yes | Notifications |
| Driver position during a delivery | Driver app, foreground only | Delivery tracking | Delivery (drivers only) |

Live workout map (branch `claude/v1-gps-live-map`): the map tiles come from Apple Maps (iPhone) or Google Maps SDK for
Android, which receive requests for the area on screen. The route itself stays on the phone. **LEGAL REVIEW:** mention
the map providers in the privacy policy, and check Google Play's Data safety guidance for the Maps SDK (SDK data
collection must be declared by the app).

Not collected: contacts, photos (except optional uploads already in the app), advertising ID, analytics or crash SDKs
(none in `package.json`), heart rate, sleep, any health-app data the customer did not grant. No data is sold, used for
advertising or shared for tracking. Processors: Supabase (database/Auth, project region **eu-west-1, Ireland**), Expo
push service (push tokens), Apple / Google (sign-in). Transport is HTTPS only.

## 2. Apple App Store

### 2.1 App Privacy ("nutrition label") — proposed answers

| Category | Type | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Health & Fitness | Health (weight, height, sex, age), Fitness (steps, distance, workouts) | Yes | No | App Functionality |
| Location | Precise Location (delivery address suggestion, driver delivery tracking) | Yes | No | App Functionality |
| Contact Info | Name, Email Address, Phone Number, Physical Address | Yes | No | App Functionality |
| Purchases | Purchase History (orders) | Yes | No | App Functionality |
| User Content | Other User Content (manual meal names) | Yes | No | App Functionality |
| Identifiers | User ID; Device ID (push token) | Yes | No | App Functionality |

The workout route is processed on the device only; Apple counts data as "collected" only when it leaves the device, so
the route does not need a Location entry by itself — the delivery features already declare Precise Location.
**LEGAL REVIEW** of the final answers.

### 2.2 Info.plist purpose strings (in `app.json`, French)

- `NSMotionUsageDescription` (expo-sensors plugin): step counting with the motion sensor, no health app needed.
- `NSLocationWhenInUseUsageDescription`: delivery address, distance of a session the customer starts (including with the
  screen locked), driver tracking. **No "Always" location strings** (verified in the prebuild plist, E-25).
- `NSHealthShareUsageDescription` (HealthKit plugin): read steps, distance, active energy and workouts. No write string.

### 2.3 Background location mode — App Review justification (draft)

> L'OPTION uses the `location` background mode only while a customer is recording a walk, run or ride that they started
> on the Workout screen. The app shows the session on screen, iOS shows the blue location indicator, and GPS stops as
> soon as the customer pauses, finishes or discards the session. Location is requested "While Using the App" only; the
> app never asks for "Always" permission and never collects location in the background otherwise. The route stays on
> the device; only the session's distance is saved to the customer's account to estimate the energy spent. Steps to
> review: sign in → Suivi → Démarrer une marche → allow location → lock the screen for 2 minutes → unlock → the distance
> has increased → Terminer.

Attach a short screen recording of these steps (§4).

### 2.4 HealthKit

- Apple Health is **optional**; the app works with Core Motion alone. But while `@kingstinct/react-native-healthkit` is
  in `app.json`, the binary links HealthKit and gets the `com.apple.developer.healthkit` entitlement: the App ID needs
  the **HealthKit capability** in the Apple Developer portal, the privacy policy must describe Health data, and
  App Review checks that the HealthKit feature is visible (the "Connecter Apple Health" option on the activity screen).
- Health data must not be used for advertising or stored in iCloud (it is not).
- If the owner does not want Apple Health at launch, remove the plugin and the provider instead (decision, DECISIONS #20).

### 2.5 Privacy manifest (`PrivacyInfo.xcprivacy`)

Expo SDK 58 modules ship their own manifests for required-reason APIs; the app's own Swift module
(`modules/loption-motion/ios`) uses no required-reason API (no `UserDefaults`, file timestamps, boot time or disk
space). `app.json` sets no `ios.privacyManifests`. **NOT VERIFIED:** generate Xcode's privacy report
(Product → Archive → Generate Privacy Report) on a Mac with the EAS/Xcode archive and add any missing reason.

### 2.6 Account deletion (guideline 5.1.1(v))

In-app: Profil → Supprimer mon compte (typed confirmation `SUPPRIMER`). Needs the migration
`20261104120000_v1_account_deletion.sql` on the hosted project (**not applied**, awaiting owner authorization).

## 3. Google Play

### 3.1 Data safety form — proposed answers

| Play category | Data types | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|---|
| Location | Approximate, Precise | Yes | No | Yes (address can be typed; workouts work without GPS) | App functionality |
| Personal info | Name, Email, Phone, Address, User IDs | Yes | No | Phone/address required to order | App functionality, Account management |
| Financial info | Purchase history | Yes | No | Required to order | App functionality |
| Health and fitness | Health info (weight, height, sex, age), Fitness info (steps, distance, workouts) | Yes | No | Yes | App functionality |
| App activity | Other user-generated content (manual meals) | Yes | No | Yes | App functionality |
| Device or other IDs | Push token | Yes | No | Yes | App functionality |

- Data is encrypted in transit: **Yes**. Users can request deletion: **Yes** (in-app, once the migration is applied).
- Play also requires an **account deletion web link** (a page or form outside the app). Owner action (K9).
- Data processed only on the device (workout route) is not "collected" in Play's definition.

### 3.2 Permissions in the release manifest

Merged release manifest of the `assembleRelease` build (evidence E-28): `INTERNET`, `ACCESS_NETWORK_STATE`,
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACTIVITY_RECOGNITION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION` (expo-location `LocationTaskService`, `foregroundServiceType="location"`), the five
`android.permission.health.READ_*` permissions, `POST_NOTIFICATIONS`, `VIBRATE`, FCM `c2dm.RECEIVE`, WorkManager's
`RECEIVE_BOOT_COMPLETED` / `WAKE_LOCK`, `READ_`/`WRITE_EXTERNAL_STORAGE` up to Android 12 (admin photo picker), and
launcher-badge permissions from the notification library. **No `ACCESS_BACKGROUND_LOCATION`.**
`CAMERA`, `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` were in the first build (image-picker library and the Expo template)
although nothing uses them; they are now removed with `android.blockedPermissions` in `app.json` (E-29).

- `ACTIVITY_RECOGNITION`: runtime permission for the step counter; no Play declaration form, but it must appear in
  Data safety (Fitness info).
- Health Connect `READ_*`: Play requires the **Health Connect permissions declaration** (each data type and why) and the
  privacy-policy rationale screen. If Health Connect is not offered at launch, remove the permissions and the plugin
  instead (DECISIONS #20).

### 3.3 Foreground service declaration (Play Console → App content → Foreground service permissions)

- Type: `location` (`FOREGROUND_SERVICE_LOCATION`), declared by expo-location's `LocationTaskService`.
- Use case (draft): *"User-initiated workout tracking. The service runs only while a walk, run or ride that the user
  started is being recorded, so the distance keeps being measured when the screen is off. A persistent notification
  'Votre activité est en cours' is shown for the whole session; the service stops when the user pauses, finishes or discards the
  session. Deferring or interrupting the task would lose the distance of the workout the user is doing."*
- Demo video (required): see §4.

### 3.4 Background readings (WorkManager)

The step counter is read by a periodic WorkManager job ("about every 15 minutes"); Android may delay it in Doze, battery
saver or app standby, and the app says so on screen with the measured reading times. No exact-alarm or
battery-optimization exemption is requested (none needed, and Play restricts both).

## 4. Demo video script (both stores, about 60 s, record on a real device)

1. Sign in with a test customer. Open **Suivi**: steps from the phone sensor.
2. Tap **Démarrer une marche**; show the on-screen explanation, then the system "while using the app" prompt.
3. Android: pull down the notification shade — **"Votre activité est en cours"** is visible. iPhone: the blue location indicator.
4. Lock the screen, walk for about a minute, unlock: the distance increased.
5. **Pause** (notification disappears on Android / indicator stops), **Reprendre**, **Terminer**: the summary shows the
   distance; mention that the route stays on the phone.
6. Profil → Supprimer mon compte (show the screen only; do not delete the review account).

## 5. Morocco — Law 09-08 and the CNDP (**LEGAL REVIEW**)

- **Sensitive data:** health data (weight, health-derived activity, calorie estimates) is sensitive under Law 09-08;
  processing needs the person's explicit consent and, as a rule, prior **authorization** by the CNDP (not a simple
  declaration). The other processing (accounts, orders, delivery) needs a prior **declaration**.
- **Transfer abroad:** Supabase stores the data in Ireland (eu-west-1) and Expo's push service is in the US: a transfer
  outside Morocco needs CNDP authorization (or a recognised adequacy basis); list the processors and countries.
- **Consent in the app:** onboarding collects the profile with an explanation; the activity screens ask before
  connecting a source. A reviewer should confirm whether an explicit, separate health-data consent screen is required
  (currently not implemented — DECISIONS #21).
- **Information notice / privacy policy (K9):** controller identity, purposes, recipients, transfers, retention,
  rights of access, rectification and objection, CNDP receipt/authorization number.
- **Rights:** access and rectification in the profile; deletion in-app (§2.6); a contact address for requests.
- **Retention (DECISIONS #14, M12):** no automatic purge yet. Proposal to decide: activity and meal history kept while
  the account exists, deleted with the account; orders kept for the legal accounting period with the customer link
  removed. Whether the orders' contact fields (name, phone, address) must also be anonymised on deletion is open
  (DECISIONS #22).

## 6. Owner checklist before submission

- [ ] Authorize applying `20261104120000_v1_account_deletion.sql` to `loption-mobile` (DECISIONS #23).
- [ ] Decide Apple Health / Health Connect at launch (DECISIONS #20); adjust plugins or file the declarations.
- [ ] Privacy policy, terms and the account-deletion web page published (K9).
- [ ] CNDP declaration, health-data authorization and transfer authorization filed (**LEGAL REVIEW**).
- [ ] App Privacy and Data safety answers entered (§2.1, §3.1), reviewed by legal.
- [ ] Foreground-service declaration and background-location justification with the demo video (§3.3, §2.3, §4).
- [ ] Device tests passed (`DEVICE_TEST_PROCEDURES.md`) and calorie constants approved (DECISIONS #19).
