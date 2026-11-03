-- =====================================================================
-- V1 rollout — READ-ONLY fingerprint of everything the V1 migrations
-- create in schema public: function bodies and settings, policies,
-- columns of the new tables and of user_profiles, table and column
-- privileges, triggers. Run on the target after applying and on a local
-- reference database built from the same files: the values must match,
-- so a migration sent as text (e.g. through the Supabase connector) is
-- proven identical to the reviewed files. Changes nothing.
-- =====================================================================
with
fns(n) as (select unnest(array[
  'activity_daily_capture_target','activity_daily_prepare','activity_daily_summary','activity_energy_estimate',
  'activity_max_speed','activity_met','activity_workouts','apply_first_order_offer','assign_staff_role',
  'containment_violations','deactivate_push_token','enforce_driver_availability','enforce_profile_privilege_guard',
  'estimate_energy','first_order_offer_on_order_change','first_order_offer_on_promotion_change',
  'first_order_offer_on_redemption_change','first_order_offer_profile_guard','first_order_offer_profile_insert',
  'first_order_offer_refresh','first_order_offer_status_for','has_staff_role','in_quiet_hours','is_valid_time_zone',
  'notification_preferences_guard','nutrition_capture_target','nutrition_claim_deliveries','nutrition_daily_summary',
  'nutrition_is_milestone','nutrition_log_entry_capture_target','nutrition_log_entry_guard','nutrition_log_entry_prepare',
  'nutrition_next_milestone','nutrition_notification_text','nutrition_pending_receipts','nutrition_plan_notifications',
  'nutrition_profile_target_refresh','nutrition_record_delivery','nutrition_record_receipts','nutrition_streak',
  'nutrition_streak_for','nutrition_target_from_tdee','order_received','register_push_token','revoke_staff_role',
  'security_audit_log_append_only','set_driver_availability','staff_roles_driver_offline','staff_roles_no_truncate',
  'staff_roles_require_admin','staff_roles_serialize','user_profiles_time_zone_guard','user_profiles_v1_derive',
  'workout_session_prepare','activity_gym_met','workout_gym_prepare','save_gym_log','activity_stride_m',
  'activity_walk_kcal'])),
tbls(n) as (select unnest(array[
  'activity_daily_totals','kitchens','notification_deliveries','notification_delivery_tickets','notification_preferences',
  'notification_settings','nutrition_daily_targets','nutrition_log_entries','promotion_redemptions','promotions',
  'security_audit_log','staff_roles','workout_sessions','user_profiles','orders','order_items','drivers','meals',
  'workout_exercises','workout_sets'])),
f as (
  select string_agg(p.oid::regprocedure::text || '|' || md5(p.prosrc) || '|' || p.prosecdef || '|' ||
                    coalesce(array_to_string(p.proconfig, ','), '') || '|' || coalesce(array_to_string(p.proacl, ','), ''),
                    E'\n' order by p.oid::regprocedure::text) as s
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select n from fns)),
pol as (
  select string_agg(tablename || '|' || policyname || '|' || permissive || '|' || array_to_string(roles, ',') || '|' || cmd
                    || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n'
                    order by tablename collate "C", policyname collate "C") as s
    from pg_policies where schemaname = 'public'),
col as (
  select string_agg(c.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull
                    || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|' || coalesce(array_to_string(a.attacl, ','), ''),
                    E'\n' order by c.relname, a.attnum) as s
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tbls)),
acl as (
  select string_agg(c.relname || '|' || c.relrowsecurity || '|' || coalesce(array_to_string(c.relacl, ','), ''), E'\n' order by c.relname) as s
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tbls)),
trg as (
  select string_agg(c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|' || p.proname, E'\n' order by c.relname, t.tgname) as s
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and c.relnamespace = 'public'::regnamespace)
select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select n from fns)) as functions,
       md5((select s from f)) as functions_md5,
       md5((select s from pol)) as policies_md5,
       md5((select s from col)) as columns_md5,
       md5((select s from acl)) as table_acl_md5,
       md5((select s from trg)) as triggers_md5;
