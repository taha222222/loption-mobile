-- =====================================================================
-- Phase 1C — READ-ONLY post-deployment verification (review 2026-10-26 L4).
-- Run after both migrations are applied (staging: in the SQL Editor of the
-- STAGING project, or psql as postgres). It reads catalogs and aggregate
-- counts only and changes nothing. Share the one JSON cell with reviewers.
--
-- Why a separate file: containment_violations() cannot vouch for itself. A
-- CREATE OR REPLACE that weakens it would still return 0 rows. This file
-- checks the monitor's own definition from pg_proc first (body fingerprint,
-- SECURITY INVOKER, fixed search_path, owner, no client EXECUTE) and only
-- then runs it.
--
-- PHASE1C_MONITOR_MD5 below is md5(prosrc) of the reviewed monitor. It is
-- repeated in preflight_staging_readonly.sql and the plan (section 10).
-- run_phase1c.sh fails if any copy differs from a clean application of the
-- migration. Changing the monitor therefore needs, in ONE reviewed commit:
-- the migration change, the new value in both files and the plan, and a
-- harness run that shows the new value; a reviewer compares the monitor
-- diff with the fingerprint change. Never update the value from a live
-- database.
-- =====================================================================
with
expected(monitor_md5) as (values ('PHASE1C_MONITOR_MD5:86b0dca96f9664cccf571684bb03562c')),
mon as (
  select p.oid, md5(p.prosrc) as body_md5, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner,
         has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_exec
    from pg_proc p
   where p.oid = to_regprocedure('public.containment_violations()')
),
checks(check_name, ok, detail) as (
  select 'monitor_fingerprint_matches_review',
         coalesce((select m.body_md5 = split_part(e.monitor_md5, ':', 2) from mon m, expected e), false),
         coalesce((select 'md5(prosrc)=' || body_md5 from mon), 'public.containment_violations() is missing')
  union all
  select 'monitor_invoker_fixed_search_path_owner_postgres_no_client_execute',
         coalesce((select not prosecdef and proconfig = array['search_path=""'] and owner = 'postgres' and not client_exec from mon), false),
         coalesce((select format('definer=%s config=%s owner=%s client_execute=%s', prosecdef, proconfig, owner, client_exec) from mon), 'missing')
  union all
  select 'phase1c_migrations_recorded',
         coalesce(case when to_regclass('supabase_migrations.schema_migrations') is not null
                       then (xpath('/row/n/text()', query_to_xml(
                               'select count(*) = 2 as n from supabase_migrations.schema_migrations where version in (''20261016170000'', ''20261016171000'')',
                               false, true, '')))[1]::text = 'true' end, false),
         'supabase_migrations.schema_migrations holds 20261016170000 and 20261016171000'
  union all
  -- only evaluated when the monitor itself is the reviewed one
  select 'containment_violations_zero_rows',
         r.n = '0', 'rows=' || r.n
    from (select case when coalesce((select m.body_md5 = split_part(e.monitor_md5, ':', 2) from mon m, expected e), false)
                      then (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.containment_violations()', false, true, '')))[1]::text
                      else 'not run (monitor not verified)' end as n) r
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'all_required_checks_ok', coalesce((select bool_and(coalesce(ok, false)) from checks), false),
  'checks', (select jsonb_agg(jsonb_build_object('check', check_name, 'ok', coalesce(ok, false), 'detail', detail)) from checks)
)) as phase1c_postdeploy;
