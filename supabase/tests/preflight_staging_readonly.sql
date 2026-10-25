-- =====================================================================
-- Phase 1C — READ-ONLY staging preflight. Safe to run in the Supabase
-- Dashboard SQL Editor of the STAGING project. It only reads catalogs
-- and aggregate counts (no personal data) and changes nothing.
--
-- Purpose: prove (or disprove) that live staging still matches the
-- 2026-10-15 evidence the migration was built and tested against, and
-- fail on unsafe or unexplained platform states (U3-U6, U9). Every
-- required row must say ok = true before the migration may be applied. Share the
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
cfg as (
  select
    array['anon','authenticated','authenticator','dashboard_user','pgbouncer','postgres',
          'service_role','supabase_admin','supabase_auth_admin','supabase_etl_admin',
          'supabase_privileged_role','supabase_read_only_user','supabase_replication_admin',
          'supabase_storage_admin','supabase_functions_admin','supabase_realtime_admin',
          'cli_login_postgres','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker']::text[] as allowed_roles,
    array['supabase_admin']::text[] as allowed_superusers,
    array['postgres','service_role','supabase_admin','supabase_etl_admin','supabase_read_only_user']::text[] as allowed_bypassrls,
    array['anon<-authenticator','anon<-postgres','authenticated<-authenticator',
          'authenticated<-postgres','authenticator<-postgres','authenticator<-supabase_storage_admin',
          'service_role<-authenticator','service_role<-postgres',
          'supabase_privileged_role<-postgres','supabase_privileged_role<-supabase_etl_admin',
          'postgres<-cli_login_postgres']::text[] as allowed_members,
    array['anon','authenticated','service_role','authenticator','postgres','supabase_admin',
          'supabase_auth_admin','supabase_storage_admin','supabase_privileged_role',
          'supabase_functions_admin','supabase_realtime_admin']::text[] as privileged_groups,
    array['extensions.grant_pg_cron_access()','extensions.grant_pg_graphql_access()',
          'extensions.grant_pg_net_access()','extensions.set_graphql_placeholder()',
          'extensions.pgrst_ddl_watch()','extensions.pgrst_drop_watch()','public.rls_auto_enable()']::text[] as allowed_evt_functions),
memberships as (
  select g.rolname::text as grp, m.rolname::text as member
    from pg_auth_members a join pg_roles g on g.oid = a.roleid join pg_roles m on m.oid = a.member),
auth_hook_candidates as (   -- explicit grant to supabase_auth_admin, or hook-shaped (jsonb -> jsonb) and effectively executable
  select p.oid::regprocedure::text as fn
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where to_regrole('supabase_auth_admin') is not null and p.proacl is not null
     and a.privilege_type = 'EXECUTE' and a.grantee = to_regrole('supabase_auth_admin')
     and p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema')
  union
  select p.oid::regprocedure::text
    from pg_proc p
   where to_regrole('supabase_auth_admin') is not null
     and p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema')
     and p.pronargs = 1 and p.proargtypes[0] = 'jsonb'::regtype and p.prorettype = 'jsonb'::regtype
     and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')),
schema_create as (
  select n.nspname::text as nsp, x.grantee
    from pg_namespace n
    cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
                          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                         where a.privilege_type = 'CREATE') x
   where n.nspname in ('public','extensions','graphql_public','auth','storage','realtime','vault')
     and x.grantee in ('PUBLIC','anon','authenticated','authenticator')),
table_grantees as (
  select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relacl is not null),
bucket_list as (
  select b->>'id' || ':' || case when (b->>'public')::boolean then 'public' else 'private' end
         || ':size=' || coalesce(b->>'size', 'null') || ':mime=' || coalesce(b->>'mime', 'null') as x
    from jsonb_array_elements(
           case when to_regclass('storage.buckets') is null then '[]'::jsonb
                else (xpath('/row/j/text()', query_to_xml(
                        'select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''public'', public, ''size'', file_size_limit, ''mime'', array_to_string(allowed_mime_types, ''|''))), ''[]'')::text as j from storage.buckets',
                        false, true, '')))[1]::text::jsonb end) b),   -- tableforest=true: <row><j>..</j></row>
checks(check_name, ok, detail) as (
  select 'server_version_17', current_setting('server_version_num')::int >= 170000,
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
                      where status is not null and status not in ('online','offline','pending','rejected')),
         (select string_agg(coalesce(status, '<null>') || '=' || n, ', ')
            from (select status, count(*) n from public.drivers group by 1) s)
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
  -- =================== platform drift (U3-U6): REQUIRED ===================
  -- Same allowlists as public.containment_violations() in the migration.
  union all
  select 'U3_no_unexpected_roles',
         not exists (select 1 from pg_roles r, cfg where r.rolname !~ '^pg_' and r.rolname <> all (cfg.allowed_roles)),
         coalesce((select string_agg(r.rolname, ', ') from pg_roles r, cfg
                    where r.rolname !~ '^pg_' and r.rolname <> all (cfg.allowed_roles)), 'none')
  union all
  select 'U3_no_unexpected_superuser_or_bypassrls',
         not exists (select 1 from pg_roles r, cfg
                      where (r.rolsuper and r.rolname <> all (cfg.allowed_superusers))
                         or (r.rolbypassrls and r.rolname <> all (cfg.allowed_bypassrls))),
         coalesce((select string_agg(r.rolname || case when r.rolsuper then ' SUPERUSER' else '' end
                                     || case when r.rolbypassrls then ' BYPASSRLS' else '' end, ', ')
                     from pg_roles r, cfg
                    where (r.rolsuper and r.rolname <> all (cfg.allowed_superusers))
                       or (r.rolbypassrls and r.rolname <> all (cfg.allowed_bypassrls))), 'none')
  union all
  select 'U3_client_roles_have_no_elevated_attributes',
         not exists (select 1 from pg_roles r where r.rolname in ('anon','authenticated')
                       and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolcanlogin)),
         (select string_agg(rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin, '; ')
            from pg_roles where rolname in ('anon','authenticated'))
  union all
  select 'U3_no_unexpected_role_memberships',
         not exists (select 1 from memberships m, cfg
                      where (m.grp = any (cfg.privileged_groups) or m.member in ('anon','authenticated','service_role'))
                        and (m.grp || '<-' || m.member) <> all (cfg.allowed_members)),
         coalesce((select string_agg(m.grp || '<-' || m.member, ', ') from memberships m, cfg
                    where (m.grp = any (cfg.privileged_groups) or m.member in ('anon','authenticated','service_role'))
                      and (m.grp || '<-' || m.member) <> all (cfg.allowed_members)), 'none')
  union all
  select 'U3_no_auth_hook_functions',
         not exists (select 1 from auth_hook_candidates),
         coalesce((select string_agg(fn, ', ') from auth_hook_candidates), 'none')
         || ' (also confirm in Dashboard: Authentication > Hooks shows no enabled hook)'
  union all
  select 'U4_no_unexpected_event_triggers',
         not exists (select 1 from pg_event_trigger e, cfg
                      where (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = e.evtfoid) <> all (cfg.allowed_evt_functions)),
         coalesce((select string_agg(e.evtname || ':' || e.evtevent || ':' || e.evtenabled::text || ':'
                                     || (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = e.evtfoid), '; ') from pg_event_trigger e), 'none')
  union all
  select 'U5_authenticator_nosuperuser_nobypassrls_noinherit',
         exists (select 1 from pg_roles where rolname = 'authenticator'
                  and not rolsuper and not rolbypassrls and not rolinherit),
         coalesce((select 'super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' inherit=' || rolinherit
                     from pg_roles where rolname = 'authenticator'), 'authenticator missing')
  union all
  select 'U5_authenticator_preloads_safeupdate',
         coalesce((select array_to_string(rolconfig, ';') from pg_roles where rolname = 'authenticator'), '')
           ~ 'session_preload_libraries=[^;]*safeupdate',
         coalesce((select array_to_string(rolconfig, '; ') from pg_roles where rolname = 'authenticator'), 'none')
  union all
  select 'U6_no_client_or_public_create_on_schemas',
         not exists (select 1 from schema_create),
         coalesce((select string_agg(nsp || ':' || grantee, ', ') from schema_create), 'none')
         || ' | public ACL: ' || (select coalesce(nspacl::text, 'default') from pg_namespace where nspname = 'public')
  -- =================== public tables: REQUIRED ===================
  union all
  select 'public_tables_owned_by_postgres',
         not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace
                       and c.relkind in ('r','p') and c.relowner <> 'postgres'::regrole),
         coalesce((select string_agg(c.relname || '=' || c.relowner::regrole::text, ', ') from pg_class c
                    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
                      and c.relowner <> 'postgres'::regrole), 'all postgres')
  union all
  select 'public_tables_rls_enabled',
         not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace
                       and c.relkind in ('r','p') and not c.relrowsecurity),
         coalesce((select string_agg(c.relname, ', ') from pg_class c where c.relnamespace = 'public'::regnamespace
                     and c.relkind in ('r','p') and not c.relrowsecurity), 'all enabled')
  union all
  select 'public_table_grantees_expected',
         not exists (select 1 from table_grantees where grantee not in ('postgres','anon','authenticated','service_role')),
         coalesce((select string_agg(distinct grantee, ', ') from table_grantees), 'none')
  union all
  select 'public_no_column_level_grants',
         not exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
                      where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and a.attacl is not null),
         coalesce((select string_agg(c.relname || '.' || a.attname, ', ') from pg_attribute a join pg_class c on c.oid = a.attrelid
                    where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and a.attacl is not null), 'none')
  -- =================== storage: REQUIRED ===================
  union all
  select 'storage_objects_policies_match_evidence',
         to_regclass('storage.objects') is not null
         and md5(coalesce((select string_agg(tablename || '|' || policyname || '|' || cmd || '|' ||
                 array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                 E'\n' order by tablename collate "C", policyname collate "C")
            from pg_policies where schemaname = 'storage'), '')) = '8aa1ab5db6b161453a493c3c5274dd84',
         coalesce((select string_agg(tablename || '.' || policyname || ':' || cmd, '; ')
                     from pg_policies where schemaname = 'storage'), 'none')
  union all
  select 'storage_buckets_match_evidence',
         to_regclass('storage.buckets') is not null
         and (select coalesce(string_agg(x, ',' order by x), '') from bucket_list) = 'meal-images:public:size=null:mime=null,src:private:size=null:mime=null',
         coalesce((select string_agg(x, ',' order by x) from bucket_list), 'storage.buckets missing')
  union all
  select 'storage_policies_manageable_by_migration_role',
         to_regclass('storage.objects') is not null
         and (pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('storage.objects')), 'USAGE')
              or coalesce(current_setting('supautils.policy_grants', true), '') ~ 'storage\.objects'),
         'owner=' || coalesce((select relowner::regrole::text from pg_class where oid = to_regclass('storage.objects')), 'n/a')
         || ' supautils.policy_grants covers storage.objects='
         || (coalesce(current_setting('supautils.policy_grants', true), '') ~ 'storage\.objects')::text
  -- ---- information only (ok = true by definition; read the detail) ----
  union all
  -- The migration does NOT use these legacy flags to choose the initial
  -- administrator (owner-supplied id; see verify_initial_admin_readonly.sql).
  select 'info: legacy user_profiles role / is_admin counts (not a source of authority)', true,
         (select string_agg(coalesce(role, '<null>') || '/' || coalesce(is_admin::text, '<null>') || '=' || n, ', ' order by 1)
            from (select role, is_admin, count(*) n from public.user_profiles group by 1, 2) s)
  union all
  -- Existing objects are NOT re-validated by the new bucket limits; this
  -- inventory (counts only) shows what is already being served.
  select 'info: existing meal-images objects by declared mimetype / over 5 MiB', true,
         case when to_regclass('storage.objects') is null then 'storage.objects absent'
              else (xpath('/row/j/text()', query_to_xml(
                      'select coalesce(string_agg(m || ''='' || n, '', '' order by m), ''none'') as j from ('
                   || 'select coalesce(metadata->>''mimetype'', ''<none>'') || case when coalesce((metadata->>''size'')::bigint, 0) > 5242880 then '' (over 5 MiB)'' else '''' end as m, count(*) n '
                   || 'from storage.objects where bucket_id = ''meal-images'' group by 1) s',
                      false, true, '')))[1]::text end
  union all
  select 'info: realtime publication', true,
         coalesce((select string_agg(schemaname || '.' || tablename, ',') from pg_publication_tables
                    where pubname = 'supabase_realtime'), 'none')
  union all
  select 'info: orders by origin / payment method / status (U8)', true,
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
