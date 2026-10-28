# L'OPTION V1 — Sign-in providers and verification e-mail: setup checklist

Status (2026-10-28): **nothing below is configured.** No Google, Apple or Resend credential exists in the repository, the app or any Supabase project touched by this work. The code is ready and shows "Pas encore configuré" for Google and Apple until they are enabled. E-mail sign-up works only once the Supabase project sends e-mail (section 3).

Rule for every credential: **private values go into the Supabase Dashboard (or a secrets manager), never into `.env`/`EXPO_PUBLIC_*`, never into git.** The app ships only the Supabase URL and anon key. Placeholder names: `supabase/server-secrets.env.example`.

## 0. Supabase Auth settings (Dashboard → Authentication)

| Setting | Value | Why |
|---|---|---|
| URL Configuration → Redirect URLs | add `loption://auth-callback` (and, for development builds served by Expo, the `exp://…/--/auth-callback` URL printed by `npx expo start`) | OAuth and verification links return here (`app/auth-callback.tsx`). Supabase rejects redirects that are not allow-listed. |
| Providers → Email → Confirm email | **On** | Unverified e-mail accounts must not be treated as verified. |
| Providers → Email → minimum password length / requirements | at least 8 characters, letters and digits | The app enforces the same rule (`validatePassword`), but the server is the authority. |
| Rate limits → e-mails | review after SMTP is set up | Supabase's built-in mailer is limited and only delivers to project team addresses. |

## 1. Google

**Obtain** (Google Cloud Console → APIs & Services):
1. OAuth consent screen (app name L'OPTION, support e-mail, privacy policy URL).
2. Credentials → Create OAuth client ID → type **Web application**. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Copy the **Client ID** and **Client secret**.

**Configure:** Supabase Dashboard → Authentication → Providers → Google → enable, paste Client ID and Client secret. Nothing goes into the app: the app uses Supabase-hosted OAuth with PKCE in the system browser.

**Verify:**
1. `curl -s -H "apikey: <anon key>" https://<project-ref>.supabase.co/auth/v1/settings` shows `"google": true`.
2. On a development build (not Expo Go), "Continuer avec Google" opens Google, returns to the app and lands on onboarding (new account) or home (returning account).
3. In Supabase → Authentication → Users the account shows provider `google`; `user_profiles` has exactly one row for it.
4. Sign in again with Google: same user id, still one profile row.

## 2. Apple

**Obtain** (Apple Developer → Certificates, Identifiers & Profiles; requires the paid Apple Developer Program):
1. App ID `com.loption.app` → enable **Sign in with Apple**. (EAS can sync this capability when it manages credentials; `app.json` sets `ios.usesAppleSignIn: true`.)
2. For Android/web sign-in only: a **Services ID** (e.g. `com.loption.app.signin`) with Sign in with Apple enabled, domain `<project-ref>.supabase.co`, return URL `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Keys → new key with Sign in with Apple → download the **.p8** once; note **Key ID** and **Team ID**. Keep the .p8 outside the repo (`*.p8` is git-ignored).
4. Generate the **client secret** (a JWT signed with the .p8) — Supabase documents a generator. It expires after at most **6 months**; put a renewal reminder in the calendar.
5. To send e-mail to Apple private-relay addresses (`…@privaterelay.appleid.com`): Apple Developer → Services → Sign in with Apple for Email Communication → register the sending domain/address used with Resend (SPF must pass).

**Configure:** Supabase Dashboard → Authentication → Providers → Apple → enable.
- Client IDs: `com.loption.app` (native iOS sign-in, identity token) and the Services ID (web/Android OAuth), comma-separated.
- Secret key: the generated JWT (needed only for the OAuth flow).

**Verify:**
1. `/auth/v1/settings` shows `"apple": true`.
2. iOS development build on a device: "Continuer avec Apple" shows the Apple sheet; choosing "Hide My Email" creates an account with a `privaterelay.appleid.com` address and reaches onboarding.
3. Cancel the sheet: the app stays on the welcome screen without an error.
4. An error "Unacceptable audience" means `com.loption.app` is missing from the Client IDs (the app shows "not configured").
5. Android: the button opens the browser flow (needs the Services ID and secret).

## 3. Verification e-mails through Resend

**Obtain** (resend.com): an account, a **verified sending domain** (DNS: SPF/DKIM records Resend provides), and an **API key** with sending access.

**Configure:** Supabase Dashboard → Authentication → SMTP Settings → enable custom SMTP:
- Host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key.
- Sender e-mail on the verified domain (e.g. `no-reply@<domain>`), sender name `L'OPTION`.
- Optional: Authentication → Email Templates → "Confirm signup" in French. Keep `{{ .ConfirmationURL }}`.

The API key is stored only there. It is never in the app, an `EXPO_PUBLIC_` variable or source control.

**Verify:**
1. Sign up with a real address you control (not a team member address).
2. The app shows "Vérifiez votre e-mail"; the e-mail arrives from the Resend domain (check Resend → Logs).
3. Open the link **on the same phone**: the app opens `auth-callback`, signs in, and continues to onboarding.
4. Open a link a second time or after expiry: the app shows "Lien expiré" and offers to resend.
5. "Renvoyer l'e-mail" sends a new message (60 s cooldown in the app; Supabase rate limits apply).
6. Without SMTP configured, sign-up shows "E-mail non envoyé … Aucun e-mail n'a été envoyé" when Supabase reports the failure. With Supabase's built-in mailer, messages reach only team addresses; Supabase may report `email_address_not_authorized`, which the app shows the same way.

## 4. Account linking (decision needed before launch)

Supabase links a new Google/Apple sign-in to an existing account when the provider e-mail is verified and identical. It does **not** link:
- Apple "Hide My Email" (relay address differs from the customer's real e-mail),
- different e-mail addresses across providers.

Those become separate accounts, each with exactly one profile (`user_profiles.user_id` is unique; the database test B07 covers repeated profile creation). Manual linking (`linkIdentity`) is not implemented; decide whether support should merge accounts on request.

## 5. Every credential still to obtain

| Credential | Where it is configured | Public? |
|---|---|---|
| Google OAuth Client ID | Supabase → Providers → Google | Not secret, but not needed in the app |
| Google OAuth Client secret | Supabase → Providers → Google | **Secret** |
| Apple Team ID, Key ID | used to generate the Apple client secret | Not secret |
| Apple Sign in with Apple key (.p8) | your machine / secrets manager only | **Secret** |
| Apple client secret (JWT, ≤ 6 months) | Supabase → Providers → Apple | **Secret** |
| Apple Services ID | Supabase → Providers → Apple (Client IDs) | Not secret |
| Resend API key | Supabase → SMTP Settings (password) | **Secret** |
| Resend verified domain + sender address | Resend DNS + Supabase → SMTP Settings | Not secret |
| Supabase redirect URL `loption://auth-callback` | Supabase → URL Configuration | Not secret |
