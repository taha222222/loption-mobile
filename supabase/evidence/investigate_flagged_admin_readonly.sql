-- =====================================================================
-- READ-ONLY investigation of the owner-confirmed illegitimate account
-- (user_profiles.role = 'customer' AND is_admin = true). Run in the
-- STAGING SQL Editor. Changes nothing. Returns ids, timestamps and counts
-- only; no names, phones, e-mails or addresses.
--
-- What it can establish: when the profile was created/last updated,
-- whether the account placed or was assigned orders, whether admin_logs or
-- the Auth audit log hold entries for it, and how many menu, order and
-- driver rows changed while the flag could have been active.
-- What it CANNOT establish: which rows this account changed. No staging
-- table records who made an UPDATE (no updated_by columns, no triggers,
-- admin_logs had no insert policy). Only Supabase API/Postgres logs in
-- the dashboard (Logs Explorer; short retention) could show that.
-- =====================================================================
with flagged as (
  select user_id, created_at, updated_at
    from public.user_profiles
   where role = 'customer' and is_admin = true
)
select jsonb_pretty(jsonb_build_object(
  'flagged_accounts', (select count(*) from flagged),
  'profile', (select jsonb_agg(jsonb_build_object(
                 'user_id', f.user_id,
                 'profile_created_at', f.created_at,
                 'profile_updated_at', f.updated_at,
                 'auth_user_created_at', u.created_at,
                 'last_sign_in_at', u.last_sign_in_at))
                from flagged f left join auth.users u on u.id = f.user_id),
  'orders_owned', (select count(*) from public.orders o join flagged f on o.user_id = f.user_id),
  'orders_as_driver', (select count(*) from public.orders o join flagged f on o.driver_id = f.user_id),
  'has_driver_row', (select count(*) from public.drivers d join flagged f on d.id = f.user_id),
  'has_collaborator_row', (select count(*) from public.collaborators c join flagged f on c.user_id = f.user_id),
  'admin_logs_rows_total', (select count(*) from public.admin_logs),
  'auth_audit_entries_for_account', (select count(*) from auth.audit_log_entries a join flagged f
                                       on a.payload ->> 'actor_id' = f.user_id::text),
  'changes_since_flagged_profile_updated', (select jsonb_build_object(
      'meals_updated', (select count(*) from public.meals m where m.updated_at >= (select min(updated_at) from flagged)),
      'orders_updated', (select count(*) from public.orders o where o.updated_at >= (select min(updated_at) from flagged)),
      'drivers_updated', (select count(*) from public.drivers d where d.updated_at >= (select min(updated_at) from flagged))))
)) as flagged_admin_investigation;
