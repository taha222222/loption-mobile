-- =====================================================================
-- Phase 1C — READ-ONLY check of the owner-supplied initial administrator.
-- Run in the STAGING SQL Editor (read-only; changes nothing) BEFORE the
-- id is committed into section 0b of
-- supabase/migrations/20261016170000_phase1c_security_containment.sql.
--
-- Replace ONLY the quoted value on the marked line with the auth.users id
-- the owner confirmed in writing. Never guess it; never take it from
-- user_profiles. Every required row must say ok = true. The migration
-- performs the same checks itself (preflight and, independently, the seed).
-- Output: one JSON cell with no e-mail address or name (the e-mail is
-- shown only as its domain, for the owner to recognise the account).
-- =====================================================================
with input as (
  select 'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID'::text as v   -- PHASE1C_INITIAL_ADMIN_USER_ID
),
parsed as (
  select v, case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end as uid from input
),
u as (
  select to_jsonb(x) as j from auth.users x, parsed where x.id = parsed.uid
),
checks(check_name, ok, detail) as (
  select 'id_is_a_uuid', (select uid is not null from parsed), (select v from parsed)
  union all
  select 'user_exists', exists (select 1 from u), ''
  union all
  select 'email_confirmed', coalesce((select coalesce(j ->> 'email_confirmed_at', j ->> 'confirmed_at') is not null from u), false), ''
  union all
  select 'not_deleted', coalesce((select (j ->> 'deleted_at') is null from u), false), ''
  union all
  select 'not_banned', coalesce((select (j ->> 'banned_until') is null or (j ->> 'banned_until')::timestamptz <= now() from u), false), ''
  union all
  select 'not_anonymous', coalesce((select not coalesce((j ->> 'is_anonymous')::boolean, false) from u), false), ''
  union all
  select 'not_the_illegitimate_profile_pattern',
         not exists (select 1 from public.user_profiles p, parsed
                      where p.user_id = parsed.uid and p.role = 'customer' and p.is_admin is true), ''
  union all
  select 'info: e-mail domain (for the owner to recognise the account)', true,
         coalesce((select split_part(j ->> 'email', '@', 2) from u), 'n/a')
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'all_required_checks_ok', coalesce((select bool_and(coalesce(ok, false)) from checks where check_name not like 'info:%'), false),
  'checks', (select jsonb_agg(jsonb_build_object('check', check_name, 'ok', coalesce(ok, false), 'detail', detail)) from checks)
)) as phase1c_initial_admin_check;
