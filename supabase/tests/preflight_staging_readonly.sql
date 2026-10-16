-- =====================================================================
-- Phase 1C — READ-ONLY staging preflight. Safe to run in the Supabase
-- Dashboard SQL Editor of the STAGING project. It only reads catalogs
-- and aggregate counts (no personal data) and changes nothing.
--
-- Purpose: prove (or disprove) that live staging still matches the
-- 2026-10-15 evidence the migration was built and tested against, and
-- answer the open evidence gaps (U3-U6, U9). Every row should say
-- ok = true before the migration is approved for staging. Share the
-- result (one JSON cell) with the CTO / reviewers.
-- =====================================================================
with
expected_policies(t, n) as (values
  ('collaborator_analytics','admin_full_access_collaborator_analytics'),
  ('collaborator_orders','admin_full_access_collaborator_orders'),
  ('collaborator_orders','collaborators_update_own_orders'),
  ('collaborator_orders','collaborators_view_own_orders'),
  ('collaborator_payouts','admin_full_access_collaborator_payouts'),
  ('collaborators','admin_full_access_collaborators'),
  ('collaborators','collaborators_view_own'),
  ('daily_closings','Allow all on daily_closings'),
  ('daily_closings','ceo_all_closings'),
  ('driver_push_tokens','Drivers can insert own push tokens'),
  ('driver_push_tokens','Drivers can view own push tokens'),
  ('drivers','Users can insert own driver record'),
  ('drivers','Users can update own driver record'),
  ('drivers','Users can view own driver record'),
  ('kiosks','ceo_all_kiosks'),
  ('kiosks','public_read_active_kiosks'),
  ('meals','Anyone can view meals'),
  ('meals','Enable delete for admins'),
  ('meals','Enable insert for admins'),
  ('meals','Enable read access for all users'),
  ('meals','Enable update for admins'),
  ('order_items','Admins full access order_items'),
  ('order_items','Service role full access order_items'),
  ('order_items','Users can insert their own order items'),
  ('order_items','Users can view their own order items'),
  ('order_status_updates','public_read_status'),
  ('order_status_updates','staff_insert_status'),
  ('orders','Admins can view all orders'),
  ('orders','Allow public insert orders'),
  ('orders','Allow public update orders'),
  ('orders','Drivers can view assigned orders'),
  ('orders','Service role full access'),
  ('orders','Staff can update order status'),
  ('orders','Users can insert orders'),
  ('orders','Users can insert their own orders'),
  ('orders','Users can update their own orders'),
  ('orders','Users can view their own orders'),
  ('orders','cashier_update_orders'),
  ('orders','kitchen_update_orders'),
  ('orders','public_create_orders'),
  ('orders','staff_read_orders'),
  ('products','Allow public read products'),
  ('products','CEO can delete'),
  ('products','Staff can update stock'),
  ('products','ceo_manage_products'),
  ('products','kitchen_update_stock'),
  ('products','public_read_active_products'),
  ('products','staff_read_all_products'),
  ('stock_movements','ceo_insert_stock_movements'),
  ('stock_movements','staff_read_stock_movements'),
  ('user_profiles','Service role has full access'),
  ('user_profiles','Users can insert their own profile'),
  ('user_profiles','Users can update their own profile'),
  ('user_profiles','Users can view their own profile'),
  ('user_push_tokens','Users can insert own push tokens'),
  ('user_push_tokens','Users can view own push tokens')),
live_policies as (
  select tablename as t, policyname as n from pg_policies where schemaname = 'public'),
checks(check_name, ok, detail) as (
  select 'server_version', current_setting('server_version_num')::int >= 150000,
         current_setting('server_version')
  union all
  select 'phase1c_not_yet_applied (U9)', to_regclass('public.staff_roles') is null
     and to_regclass('public.security_audit_log') is null,
         'staff_roles=' || coalesce(to_regclass('public.staff_roles')::text, 'absent')
  union all
  select 'public_table_set_matches_evidence',
         (select count(*) from pg_tables where schemaname = 'public') = 24,
         (select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'public')
  union all
  select 'public_policy_set_matches_evidence',
         not exists (select * from expected_policies except select * from live_policies)
     and not exists (select * from live_policies except select * from expected_policies),
         coalesce((select 'missing: ' || string_agg(t || '.' || n, '; ')
                     from (select * from expected_policies except select * from live_policies) x), '')
      || coalesce((select ' unexpected: ' || string_agg(t || '.' || n, '; ')
                     from (select * from live_policies except select * from expected_policies) y), '')
  union all
  select 'public_policy_expressions_unchanged',
         md5(coalesce((select string_agg(tablename || '|' || policyname || '|' || cmd || '|' ||
                 array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                 E'\n' order by tablename collate "C", policyname collate "C")
            from pg_policies where schemaname = 'public'), '')) = 'd2cb0f4d853918df06ca1d68a52b6096',
         'md5 of all public policy definitions; expected value computed from the 2026-10-15 evidence JSON'
  union all
  select 'drivers_status_values_known',
         not exists (select 1 from public.drivers
                      where status is null or status not in ('online','offline','pending','rejected')),
         (select string_agg(coalesce(status, '<null>') || '=' || n, ', ')
            from (select status, count(*) n from public.drivers group by 1) s)
  union all
  select 'exactly_one_legitimate_admin_profile',
         (select count(*) from public.user_profiles where role = 'admin' and is_admin and user_id is not null) = 1,
         (select string_agg(role || '/' || is_admin || '=' || n, ', ')
            from (select role, is_admin, count(*) n from public.user_profiles group by 1, 2) s)
  union all
  select 'create_order_transaction_signature',
         not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                       and p.proname = 'create_order_transaction'
                       and pg_get_function_identity_arguments(p.oid) <>
                           'p_order_number text, p_kiosk_id uuid, p_items jsonb, p_total numeric, p_language text, p_tracking_token text'),
         (select string_agg(p.oid::regprocedure::text, '; ') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order_transaction')
  union all
  select 'migration_role_is_postgres_non_superuser',
         current_user = 'postgres' and not (select rolsuper from pg_roles where rolname = current_user),
         current_user
  -- ---- information only (ok = true by definition; read the detail) ----
  union all
  select 'info: event triggers (U4)', true,
         coalesce((select string_agg(evtname || ':' || evtevent || ':' || evtenabled::text || ':' || evtfoid::regproc::text, '; ')
                     from pg_event_trigger), 'none')
  union all
  select 'info: authenticator config (U5)', true,
         coalesce((select array_to_string(rolconfig, '; ') from pg_roles where rolname = 'authenticator'), 'none')
  union all
  select 'info: public schema ACL (U6)', true,
         (select coalesce(nspacl::text, 'default') from pg_namespace where nspname = 'public')
  union all
  select 'info: custom staff roles (U3)', true,
         coalesce((select string_agg(rolname, ',') from pg_roles where rolname in ('ceo','kitchen','cashier')), 'none')
  union all
  select 'info: realtime publication', true,
         coalesce((select string_agg(schemaname || '.' || tablename, ',') from pg_publication_tables
                    where pubname = 'supabase_realtime'), 'none')
  union all
  select 'info: orders by origin / payment method (U8)', true,
         (select string_agg(k || '=' || n, ', ') from (
            select (case when kiosk_id is not null then 'kiosk' when user_id is not null then 'app' else 'other' end)
                   || ':' || coalesce(payment_method, '<null>') || ':' || coalesce(status, '<null>') as k, count(*) n
              from public.orders group by 1 order by 1) s)
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'all_required_checks_ok', (select bool_and(ok) from checks where check_name not like 'info:%'),
  'checks', (select jsonb_agg(jsonb_build_object('check', check_name, 'ok', ok, 'detail', detail)) from checks)
)) as phase1c_preflight;
