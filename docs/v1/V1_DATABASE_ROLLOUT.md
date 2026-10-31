# L'OPTION V1 — Applying the V1 database update to a Supabase project

**Why:** the app's calorie tracking, Suivi, server-side estimates, delivery address and first-order offer need five
migrations. A project without them shows "pas encore disponible" (reproduced locally, evidence E-20).

| Order | Migration | Adds |
|---|---|---|
| 1 | `20261016170000_phase1c_security_containment.sql` | Security containment, staff roles, Kitchen A, the security monitor |
| 2 | `20261016171000_phase1c_storage_meal_images.sql` | Meal-image storage limits and policies |
| 3 | `20261028120000_v1_onboarding_first_order_offer.sql` | BMR/TDEE on the server, onboarding completion, delivery address, first-order offer (existing onboarded customers are backfilled) |
| 4 | `20261029120000_v1_nutrition_tracking_engagement.sql` | Meal log, daily targets, streaks, reminders |
| 5 | `20261030120000_v1_activity_tracking.sql` | Activity days, workouts, daily balance (Suivi) |

**Status:** Phase 1C is still marked *NOT READY FOR STAGING* (no independent review). Applying this is the owner's
decision. **Use a test or staging project first, not a project with real customers.**

Every migration checks its preconditions and refuses to run, changing nothing, if anything is unexpected. The supported
procedure is `supabase db push` (`PHASE1C_DATABASE_SECURITY_PLAN.md`, "Supported migration procedure"). The Dashboard
SQL Editor is used below **only for read-only checks**, never to apply a migration.

## Steps (Windows PowerShell; run from the `loption-mobile` folder)

**1. Backup.** Dashboard → Database → Backups: confirm a backup (or point-in-time recovery) newer than now.

**2. Your administrator account id (read-only).** Dashboard → SQL Editor, replace the e-mail and run:

```sql
select id, email, email_confirmed_at from auth.users where email = 'your-admin@example.com';
```

Then open `supabase/tests/verify_initial_admin_readonly.sql`, replace the marked value with that `id`, run it in the
SQL Editor: every required check must be `true`. Send the `id` to the developer. It is written into the migration in its
own commit (only the line marked `-- PHASE1C_INITIAL_ADMIN_USER_ID` changes), then you pull that commit.

**3. Compatibility check (read-only).** Run `supabase/tests/preflight_staging_readonly.sql` in the SQL Editor.
`all_required_checks_ok` must be `true`. If not, stop and send the JSON output: nothing has changed.

**4. Manual checks.** Dashboard → Authentication → Hooks: none enabled. Dashboard → Project Settings → API → exposed
schemas: `public` and `graphql_public` only.

**5. Link the CLI** (asks for your Supabase login and the database password):

```bash
npx supabase@2.122.0 login
```

```bash
npx supabase@2.122.0 link --project-ref <your-project-ref>
```

**6. Dry run.** It must list exactly the five versions above, in that order, and nothing else:

```bash
npx supabase@2.122.0 db push --linked --dry-run
```

**7. Apply:**

```bash
npx supabase@2.122.0 db push --linked
```

If any migration refuses, the ones before it stay applied and it applies nothing itself. Send the error text; do not
edit or re-order files.

**8. Verify (read-only, SQL Editor):** run `supabase/tests/postdeploy_verify_activity_readonly.sql`;
`all_required_checks_ok` must be `true`. Then `select user_id from public.staff_roles where role = 'admin' and is_active;`
must return exactly your id.

**9. App:** close and reopen the app. Home shows today's calories, Suivi shows the daily balance, Nutrition shows your
estimate, and the delivery address can be saved.

## Rollback
Only with an approved task and the backup from step 1, newest first: `v1_activity_tracking_rollback.sql`,
`v1_nutrition_tracking_rollback.sql`, `v1_onboarding_offer_rollback.sql`, then `supabase/rollback/phase1c_rollback.sh`
(see each file's header).
