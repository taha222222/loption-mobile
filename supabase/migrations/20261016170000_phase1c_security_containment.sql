-- =====================================================================
-- L'OPTION V1 — Phase 1C (amended): database security containment
--
-- STATUS: FOR CTO REVIEW. Not applied to any remote database.
-- TARGET: staging project teppcfnpkoxkudajnvad ONLY, after approval.
--         Never production.
-- SCHEMA BASIS: supabase/evidence/catalog_2026-10-15.json, reproduced by
--   supabase/baseline/staging_schema_2026-10-15.sql (round-trip verified
--   in the dimensions the evidence captured; see supabase/evidence/README.md).
-- MODEL: internal kitchens + one server-managed staff-role table
--   (admin, support, cashier, kitchen_staff, driver). No partner model.
--
-- Closes: C1 (role/is_admin self-grant), C2 (open order inserts),
--         C3 (open order updates), C4 (open daily_closings),
--         H2 (open order_status_updates), H3 (driver self-provisioning,
--         self-approval and money fields; approval/availability split),
--         H4 (client-executable create_order_transaction), M2 (default
--         privileges). Also retires the inert kiosk JWT-claim policies and
--         the partner write policy, keeps user_profiles private (no admin
--         read), and aborts on platform drift (U3-U6) before any change.
--         Revision 5 (self-review remediation): owner-supplied initial
--         admin (M1), self-contained transaction + commit gate (M1), role
--         check (L6), reviewed-definition monitoring (M2), no client
--         TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (L1), at least one active
--         admin for every writer (L2), revoked/deleted driver approval =>
--         offline (L3), drivers.status NOT NULL.
--         Storage (meal-images) is closed by 20261016171000; containment
--         is complete only when containment_violations() returns 0 rows.
--
-- Data: no row is deleted; no order, payment, card order, kiosk, product,
--   stock or closing record is modified. The ONLY row changes are:
--   * drivers.status of non-approved drivers set to 'offline' (the legacy
--     value, including NULL, is recorded in security_audit_log first;
--     see section 9);
--   * new rows in the new tables kitchens, staff_roles, security_audit_log.
--
-- DEPLOYMENT PREREQUISITE (blocks deployment until met): the initial
--   administrator is NOT derived from user_profiles.role / is_admin. The
--   owner must supply the auth.users id of the one authorized initial
--   administrator, and it must be written into section 0b below in a
--   reviewed commit. While the placeholder is in place the migration
--   refuses to run (tested). See docs/v1/PHASE1C_DATABASE_SECURITY_PLAN.md,
--   "Deployment prerequisite: initial administrator".
--
-- Transaction: this file contains its own BEGIN ... COMMIT. Supported
--   procedure: `supabase db push` (verified locally with Supabase CLI
--   2.122.0; see the plan, "Supported migration procedure"). Every guard
--   raises inside that transaction, and a deferred gate (section 0a) makes
--   COMMIT itself fail unless the preflight AND the postcondition both
--   completed, so a runner that continues after an error inside the
--   transaction (e.g. psql ON_ERROR_ROLLBACK) still cannot commit a
--   partial migration (tested). Do not split this file or strip its
--   BEGIN/COMMIT. The Dashboard SQL editor is NOT a supported runner.
-- Role: must run as role postgres (checked first; aborts otherwise).
-- Re-runnable: yes. All DDL is IF [NOT] EXISTS / drop-then-create, seeds
--   and the driver normalisation are idempotent (tested).
-- =====================================================================

begin;

set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 0a. Execution guards (before anything else).
--     * wrong role -> abort before any change;
--     * commit gate: phase1c_gate rows reference phase1c_gate_ok through a
--       DEFERRED foreign key. The preflight and the postcondition each add
--       their phase1c_gate_ok row only when they pass, so COMMIT fails
--       (and the transaction rolls back) if either did not complete.
--       Both tables are temporary and dropped at commit.
-- ---------------------------------------------------------------------
do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'Phase 1C: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table phase1c_gate_ok (step text primary key) on commit drop;
create temp table phase1c_gate (
  step text constraint phase1c_guard_did_not_pass references phase1c_gate_ok deferrable initially deferred
) on commit drop;
insert into phase1c_gate values ('core preflight'), ('core postcondition');

-- ---------------------------------------------------------------------
-- 0b. DEPLOYMENT PREREQUISITE — the owner-authorized initial administrator
--     (auth.users id). Replace ONLY the quoted value on the marked line,
--     in a reviewed commit, with the id the owner confirmed in writing.
--     Never guess it and never take it from user_profiles. Until it is
--     replaced, the preflight refuses to run. Used once: when staff_roles
--     holds no admin row yet. Transaction-local (set_config(..., true)).
-- ---------------------------------------------------------------------
do $admin$ begin perform set_config('phase1c.initial_admin_user_id',
  'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID
  true); end $admin$;

-- Verification of the supplied initial admin (temporary helper, dropped at
-- session end; used by the preflight AND, independently, by the seed).
-- Returns NULL when acceptable, otherwise the reason it is refused.
create function pg_temp.phase1c_initial_admin_problem(p_value text)
returns text language plpgsql as $f$
declare
  u jsonb;
  v_uid uuid;
begin
  if p_value is null or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'initial administrator not supplied: section 0b still holds the placeholder (deployment prerequisite; see the plan)';
  end if;
  v_uid := p_value::uuid;
  select to_jsonb(x) into u from auth.users x where x.id = v_uid;
  if u is null then
    return format('initial administrator %s does not exist in auth.users', v_uid);
  end if;
  -- optional columns are read through jsonb: they differ between Auth versions
  if coalesce(u ->> 'email_confirmed_at', u ->> 'confirmed_at') is null then
    return format('initial administrator %s has not confirmed its e-mail', v_uid);
  end if;
  if (u ->> 'deleted_at') is not null then
    return format('initial administrator %s is deleted', v_uid);
  end if;
  if (u ->> 'banned_until') is not null and (u ->> 'banned_until')::timestamptz > now() then
    return format('initial administrator %s is banned', v_uid);
  end if;
  if coalesce((u ->> 'is_anonymous')::boolean, false) then
    return format('initial administrator %s is an anonymous account', v_uid);
  end if;
  -- Refusal only (never a source of authority): the owner-confirmed
  -- illegitimate pattern role='customer' AND is_admin=true is never seeded.
  if exists (select 1 from public.user_profiles p
              where p.user_id = v_uid and p.role = 'customer' and p.is_admin is true) then
    return format('initial administrator %s has the illegitimate profile pattern role=customer, is_admin=true', v_uid);
  end if;
  return null;
end
$f$;

-- ---------------------------------------------------------------------
-- 00. public.containment_violations() — read-only verification and
--     monitoring query. Returns one row per detected problem.
--       category 'drift'       unsafe/unexplained platform state (U3-U6):
--                              roles, memberships, event triggers,
--                              authenticator, schema CREATE, Auth-hook
--                              functions (explicit grant or effective
--                              EXECUTE on a jsonb->jsonb function),
--                              relation owners and grantees, RLS off
--       category 'containment' the C1-C4/H2-H4/M2 rules of this package:
--                              every public policy matches its reviewed
--                              definition exactly; no client-accessible
--                              view / materialized view / foreign table;
--                              no unreviewed client-executable SECURITY
--                              DEFINER function; migration functions
--                              unchanged (fingerprints); grants RLS does
--                              not govern; guard triggers; at least one
--                              active admin; no unapproved online driver
--       category 'storage'     every storage policy (incl. SELECT/listing)
--                              matches its reviewed definition; bucket
--                              limits (closed by the storage migration)
--     The migration calls it BEFORE changing anything (aborts on 'drift')
--     and AFTER (aborts on 'drift' or 'containment'). It stays installed
--     as the post-deployment verification / monitoring query:
--       select * from public.containment_violations();
--     It reads catalogs only, runs as the caller (SECURITY INVOKER), and
--     is not executable by client roles.
--     ZERO ROWS MEANS ONLY THAT NONE OF THE CHECKS ABOVE FOUND A PROBLEM.
--     It is not a complete proof of safety; known limits are listed in
--     docs/v1/PHASE1C_DATABASE_SECURITY_PLAN.md ("Monitoring: what
--     containment_violations() checks and does not check"), e.g. it
--     cannot see hosted Auth/PostgREST configuration, the bodies of
--     functions it does not fingerprint, or data-level mistakes.
--     Allowlists below are the Supabase platform defaults observed in
--     supabase/postgres:17.6.1.178 plus documented hosted-only roles.
--     Extend them only through a reviewed commit.
-- ---------------------------------------------------------------------
create or replace function public.containment_violations()
returns table (category text, object text, problem text)
language plpgsql stable set search_path = ''
as $cv$
declare
  -- Supabase platform roles (image) + documented hosted-only roles.
  -- cli_login_postgres is created by the Supabase CLI itself (link/db push).
  allowed_roles text[] := array[
    'anon','authenticated','authenticator','dashboard_user','pgbouncer','postgres',
    'service_role','supabase_admin','supabase_auth_admin','supabase_etl_admin',
    'supabase_privileged_role','supabase_read_only_user','supabase_replication_admin',
    'supabase_storage_admin','supabase_functions_admin','supabase_realtime_admin',
    'cli_login_postgres','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker'];
  allowed_superusers text[] := array['supabase_admin'];
  allowed_bypassrls  text[] := array['postgres','service_role','supabase_admin',
    'supabase_etl_admin','supabase_read_only_user'];
  -- (group, member) pairs observed in the image, plus the CLI login role.
  allowed_members text[] := array[
    'anon<-authenticator','anon<-postgres','authenticated<-authenticator',
    'authenticated<-postgres','authenticator<-postgres','authenticator<-supabase_storage_admin',
    'service_role<-authenticator','service_role<-postgres',
    'supabase_privileged_role<-postgres','supabase_privileged_role<-supabase_etl_admin',
    'postgres<-cli_login_postgres'];
  privileged_groups text[] := array['anon','authenticated','service_role','authenticator',
    'postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin',
    'supabase_privileged_role','supabase_functions_admin','supabase_realtime_admin'];
  -- Event-trigger functions shipped by Supabase, plus the staging RLS
  -- auto-enable helper (it only runs ALTER TABLE ... ENABLE ROW LEVEL SECURITY).
  allowed_evt_functions text[] := array[
    'extensions.grant_pg_cron_access()','extensions.grant_pg_graphql_access()',
    'extensions.grant_pg_net_access()','extensions.set_graphql_placeholder()',
    'extensions.pgrst_ddl_watch()','extensions.pgrst_drop_watch()','public.rls_auto_enable()'];
  -- Schemas that hold Supabase platform objects (their grants are the
  -- platform's). Any OTHER schema a client role can use, and every view,
  -- materialized view or foreign table in the API schemas, is reported.
  platform_schemas text[] := array['auth','storage','extensions','graphql','realtime','vault',
    'pgsodium','pgsodium_masks','net','cron','supabase_functions','supabase_migrations',
    'pgbouncer','information_schema'];
  api_schemas text[] := array['public','graphql_public'];
  -- REVIEWED POLICY DEFINITIONS. Every policy in schema public (and, for
  -- the storage category, in schema storage) must match one entry exactly:
  --   table|name|PERMISSIVE or RESTRICTIVE|roles|command|USING|WITH CHECK
  -- (expressions as PostgreSQL 17 prints them in pg_policies, whitespace
  -- collapsed; '-' = none). A changed expression, command, role list or
  -- mode is reported even when the policy name is unchanged. Extend only
  -- through a reviewed commit.
  reviewed_public_policies text[] := array[
    'collaborator_analytics|staff_admin_all_collaborator_analytics|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborator_orders|collaborators_view_own_orders|PERMISSIVE|{public}|SELECT|(collaborator_id IN ( SELECT collaborators.id FROM public.collaborators WHERE (collaborators.user_id = auth.uid())))|-',
    'collaborator_orders|staff_admin_all_collaborator_orders|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborator_payouts|staff_admin_all_collaborator_payouts|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborators|collaborators_view_own|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'collaborators|staff_admin_all_collaborators|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'driver_push_tokens|Drivers can insert own push tokens|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'driver_push_tokens|Drivers can view own push tokens|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'drivers|Users can view own driver record|PERMISSIVE|{public}|SELECT|(auth.uid() = id)|-',
    'drivers|drivers_self_update_profile_location|PERMISSIVE|{authenticated}|UPDATE|(id = ( SELECT auth.uid() AS uid))|(id = ( SELECT auth.uid() AS uid))',
    'drivers|staff_admin_all_drivers|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'kitchens|kitchens_read_authenticated|PERMISSIVE|{authenticated}|SELECT|true|-',
    'meals|Anyone can view meals|PERMISSIVE|{public}|SELECT|true|-',
    'meals|Enable read access for all users|PERMISSIVE|{public}|SELECT|true|-',
    'meals|staff_admin_write_meals|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'order_items|Service role full access order_items|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'order_items|Users can view their own order items|PERMISSIVE|{public}|SELECT|(EXISTS ( SELECT 1 FROM public.orders WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid()))))|-',
    'order_items|staff_admin_all_order_items|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'order_status_updates|order_owner_read_status|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE ((o.id = order_status_updates.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)))))|-',
    'order_status_updates|staff_admin_read_status|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'orders|Drivers can view assigned orders|PERMISSIVE|{public}|SELECT|(driver_id = auth.uid())|-',
    'orders|Service role full access|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'orders|Users can view their own orders|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'orders|staff_admin_all_orders|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'security_audit_log|security_audit_log_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'staff_roles|staff_roles_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'staff_roles|staff_roles_self_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'user_profiles|Service role has full access|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'user_profiles|Users can insert their own profile|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'user_profiles|Users can update their own profile|PERMISSIVE|{public}|UPDATE|(auth.uid() = user_id)|-',
    'user_profiles|Users can view their own profile|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'user_push_tokens|Users can insert own push tokens|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'user_push_tokens|Users can view own push tokens|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-'];
  reviewed_storage_policies text[] := array[
    'objects|staff_admin_delete_meal_images|PERMISSIVE|{authenticated}|DELETE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_insert_meal_images|PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))',
    'objects|staff_admin_select_meal_images|PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_update_meal_images|PERMISSIVE|{authenticated}|UPDATE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))'];
  -- SECURITY DEFINER functions a client role may execute (authenticated only).
  client_definer_functions text[] := array[
    'public.has_staff_role(text)','public.assign_staff_role(uuid,text,uuid)',
    'public.revoke_staff_role(uuid,text,uuid)','public.set_driver_availability(boolean)'];
  -- Functions created by the Phase 1C migrations, fingerprinted as
  --   signature|security definer|configuration|md5(body)
  -- so a CREATE OR REPLACE that weakens one is reported.
  reviewed_functions text[] := array[
    'public.assign_staff_role(uuid,text,uuid)|true|search_path=""|1c9c7f3bc700bd76d4cee1c8033842ab',
    'public.enforce_driver_availability()|true|search_path=""|da0e53b932e051e9a371cb9fb2e64ce0',
    'public.enforce_profile_privilege_guard()|false|search_path=""|777cbb1b279b251dbb5380675638c1eb',
    'public.has_staff_role(text)|true|search_path=""|f44b74472038a40e54a5875a1ad1a835',
    'public.revoke_staff_role(uuid,text,uuid)|true|search_path=""|20e241df950caf65393fc30e1107a726',
    'public.security_audit_log_append_only()|false|search_path=""|9283a0cd3cd689131cb43161db1f0c1e',
    'public.set_driver_availability(boolean)|true|search_path=""|387497cf2e12e33c2a3e528dfec585b7',
    'public.staff_roles_driver_offline()|true|search_path=""|6c92d893f56587ae443a911badcfd922',
    'public.staff_roles_no_truncate()|false|search_path=""|5b001f4e82a1558a7fb36fb7f42d64e5',
    'public.staff_roles_require_admin()|false|search_path=""|fd3d27a94d54238193182cf3d8467de8'];
begin
  -- ============================ drift (U3) ============================
  return query select 'drift'::text, r.rolname::text, 'unexpected database role'::text
    from pg_roles r where r.rolname !~ '^pg_' and r.rolname <> all (allowed_roles);
  return query select 'drift', r.rolname::text, 'unexpected SUPERUSER role'
    from pg_roles r where r.rolsuper and r.rolname <> all (allowed_superusers);
  return query select 'drift', r.rolname::text, 'unexpected BYPASSRLS role'
    from pg_roles r where r.rolbypassrls and r.rolname <> all (allowed_bypassrls);
  return query select 'drift', r.rolname::text, 'client role has elevated attributes (superuser/bypassrls/createrole/createdb/login)'
    from pg_roles r where r.rolname in ('anon','authenticated')
     and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolcanlogin);
  return query select 'drift', g.rolname || '<-' || m.rolname, 'unexpected membership in a privileged or client role'
    from pg_auth_members a join pg_roles g on g.oid = a.roleid join pg_roles m on m.oid = a.member
   where (g.rolname = any (privileged_groups) or m.rolname in ('anon','authenticated','service_role'))
     and (g.rolname || '<-' || m.rolname) <> all (allowed_members);
  -- ============================ drift (U4) ============================
  -- schema-qualified name built explicitly (independent of search_path)
  return query select 'drift', e.evtname::text, 'unexpected event trigger function ' || f.fn
    from pg_event_trigger e
    cross join lateral (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = e.evtfoid) as f(fn)
   where f.fn <> all (allowed_evt_functions);
  -- ============================ drift (U5) ============================
  return query select 'drift', 'authenticator', 'authenticator must be NOSUPERUSER, NOBYPASSRLS, NOINHERIT'
    from pg_roles r where r.rolname = 'authenticator' and (r.rolsuper or r.rolbypassrls or r.rolinherit);
  return query select 'drift', 'authenticator', 'authenticator role missing'
   where not exists (select 1 from pg_roles where rolname = 'authenticator');
  -- ============================ drift (U6) ============================
  return query select 'drift', 'schema ' || n.nspname || ' / ' || x.grantee, 'client or PUBLIC can CREATE in schema'
    from pg_namespace n
    cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
                          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                         where a.privilege_type = 'CREATE') x
   where n.nspname in ('public','extensions','graphql_public','auth','storage','realtime','vault')
     and x.grantee in ('PUBLIC','anon','authenticated','authenticator');
  -- Auth hooks: a custom access-token hook could rewrite the JWT role
  -- claim (e.g. to service_role). Hooks are functions the Auth service
  -- (supabase_auth_admin) executes. Reported: (1) any non-auth function
  -- explicitly granted to supabase_auth_admin; (2) any non-auth function
  -- with the hook signature (one jsonb argument, returns jsonb) that
  -- supabase_auth_admin can EFFECTIVELY execute (incl. through PUBLIC).
  -- The hosted Auth hook configuration itself is not visible in SQL.
  if to_regrole('supabase_auth_admin') is not null then
    return query select 'drift', p.oid::regprocedure::text, 'function explicitly executable by supabase_auth_admin (possible Auth hook)'
      from pg_proc p cross join lateral aclexplode(p.proacl) a
     where p.proacl is not null and a.privilege_type = 'EXECUTE'
       and a.grantee = 'supabase_auth_admin'::regrole
       and p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema');
    return query select 'drift', p.oid::regprocedure::text, 'hook-shaped function (jsonb -> jsonb) effectively executable by supabase_auth_admin (possible Auth hook)'
      from pg_proc p
     where p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema')
       and p.pronargs = 1 and p.proargtypes[0] = 'jsonb'::regtype and p.prorettype = 'jsonb'::regtype
       and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
       and not exists (select 1 from aclexplode(coalesce(p.proacl, '{}')) a
                        where a.privilege_type = 'EXECUTE' and a.grantee = 'supabase_auth_admin'::regrole);
  end if;
  -- API-schema relations: owner, RLS, unexpected grantees
  return query select 'drift', n.nspname || '.' || c.relname, 'relation not owned by postgres (owner ' || c.relowner::regrole::text || ')'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
     and c.relowner <> 'postgres'::regrole;
  return query select 'drift', 'public.' || c.relname, 'row level security disabled'
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
     and not c.relrowsecurity;
  return query select distinct 'drift', 'public.' || c.relname || ' / ' || a.grantee::regrole::text, 'unexpected table grantee'
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and c.relacl is not null
     and a.grantee <> 0
     and a.grantee::regrole::text not in ('postgres','anon','authenticated','service_role');
  return query select distinct 'drift', 'public.' || c.relname || ' / PUBLIC', 'table privilege granted to PUBLIC'
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and c.relacl is not null
     and a.grantee = 0;

  -- ========================= containment =========================
  -- Policies: exact reviewed definitions (command, roles, mode, USING,
  -- WITH CHECK), not names.
  return query select 'containment', 'public.' || p.tablename || '.' || p.policyname,
                      'policy not reviewed, or its command/roles/mode/USING/WITH CHECK differ from the reviewed definition'
    from pg_policies p
   where p.schemaname = 'public'
     and (p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::text || '|' || p.cmd || '|'
          || coalesce(regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|'
          || coalesce(regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')) <> all (reviewed_public_policies);
  return query select 'containment', 'public.' || split_part(r, '|', 1) || '.' || split_part(r, '|', 2), 'reviewed policy missing'
    from unnest(reviewed_public_policies) r
   where not exists (select 1 from pg_policies p where p.schemaname = 'public'
                        and p.tablename = split_part(r, '|', 1) and p.policyname = split_part(r, '|', 2));
  return query select 'containment', 'public.' || c.relname || ' / anon ' || v.p, 'anon privilege other than SELECT on meals'
    from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('anon', c.oid, v.p)
     and not (c.relname = 'meals' and v.p = 'SELECT');
  return query select 'containment', 'public.' || c.relname || ' / authenticated ' || v.p, 'authenticated holds a privilege that RLS does not govern'
    from pg_class c cross join (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('authenticated', c.oid, v.p);
  return query select 'containment', 'public.' || t || ' / ' || r || ' TRUNCATE', 'TRUNCATE on an authority or append-only table'
    from unnest(array['staff_roles','security_audit_log','kitchens']) t cross join unnest(array['service_role','anon','authenticated']) r
   where to_regclass('public.' || t) is not null and has_table_privilege(r, ('public.' || t)::regclass, 'TRUNCATE');
  -- Views run with their owner's rights (postgres bypasses RLS) unless
  -- security_invoker is set; none is reviewed for client access.
  return query select 'containment', n.nspname || '.' || c.relname,
                      'view / materialized view / foreign table accessible to a client role (not reviewed; may bypass RLS of its base tables)'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any (api_schemas) and c.relkind in ('v','m','f')
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'));
  return query select 'containment', n.nspname || '.' || c.relname, 'client-accessible relation in a schema that is not reviewed'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r','p','v','m','f')
     and n.nspname <> all (api_schemas) and n.nspname <> all (platform_schemas) and n.nspname !~ '^pg_'
     and (has_schema_privilege('anon', n.oid, 'USAGE') or has_schema_privilege('authenticated', n.oid, 'USAGE'))
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'));
  return query select 'containment', x.col, 'authenticated may UPDATE a privileged column'
    from (values ('user_profiles','role'),('user_profiles','is_admin'),('user_profiles','user_id'),
                 ('drivers','status'),('drivers','commission_rate'),('drivers','total_earned'),
                 ('drivers','weekly_earnings'),('drivers','email'),('drivers','national_id'),('drivers','id')) v(t, c)
    cross join lateral (select v.t || '.' || v.c as col) x
   where to_regclass('public.' || v.t) is not null
     and has_column_privilege('authenticated', ('public.' || v.t)::regclass, v.c, 'UPDATE');
  return query select 'containment', 'public.' || t, 'authenticated has access to a retired or service-only table'
    from unnest(array['daily_closings','kiosks','products','stock_movements','admins','bank_accounts',
                      'admin_logs','financial_transactions','platform_settings']) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'));
  return query select 'containment', 'public.' || t, 'authenticated can write a server-managed table'
    from unnest(array['staff_roles','security_audit_log','kitchens','order_status_updates']) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'));
  -- Functions
  return query select 'containment', p.oid::regprocedure::text, 'unsafe function executable by a client role'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_order_transaction','calculate_driver_weekly_earnings','containment_violations')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  return query select 'containment', p.oid::regprocedure::text, 'public function executable by anon'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype);
  return query select 'containment', p.oid::regprocedure::text, 'SECURITY DEFINER function executable by a client role is not reviewed'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or replace(p.oid::regprocedure::text, ' ', '') <> all (client_definer_functions));
  return query select 'containment', p.oid::regprocedure::text, 'SECURITY DEFINER function without a fixed search_path'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%');
  return query select 'containment', split_part(r, '|', 1), 'reviewed function changed (body, SECURITY DEFINER or configuration differ)'
    from unnest(reviewed_functions) r
    join pg_proc p on replace(p.oid::regprocedure::text, ' ', '') = split_part(r, '|', 1)
   where (replace(p.oid::regprocedure::text, ' ', '') || '|' || p.prosecdef::text || '|'
          || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || md5(p.prosrc)) <> r;
  -- Guard triggers and constraints
  return query select 'containment', 'trigger ' || x.t || '.' || x.g, 'required guard trigger missing or disabled'
    from (values ('user_profiles','trg_enforce_profile_privilege_guard'),
                 ('drivers','trg_enforce_driver_availability'),
                 ('security_audit_log','security_audit_log_append_only'),
                 ('security_audit_log','security_audit_log_no_truncate'),
                 ('staff_roles','trg_staff_roles_require_admin'),
                 ('staff_roles','trg_staff_roles_driver_offline'),
                 ('staff_roles','trg_staff_roles_no_truncate')) x(t, g)
   where not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = to_regclass('public.' || x.t) and tg.tgname = x.g and tg.tgenabled <> 'D');
  return query select 'containment', 'public.drivers', 'availability check constraint missing'
   where not exists (select 1 from pg_constraint
                      where conrelid = to_regclass('public.drivers') and conname = 'drivers_status_availability_check');
  return query select 'containment', 'public.drivers.status', 'drivers.status allows NULL'
    from pg_attribute a
   where a.attrelid = to_regclass('public.drivers') and a.attname = 'status' and not a.attnotnull;
  -- State invariants (dynamic SQL: the tables exist only after the migration)
  if to_regclass('public.staff_roles') is not null then
    return query execute
      $q$select 'containment'::text, 'public.staff_roles'::text, 'no active admin staff role'::text
          where not exists (select 1 from public.staff_roles where role = 'admin' and is_active)$q$;
    return query execute
      $q$select 'containment'::text, 'public.drivers ' || d.id::text, 'driver online without an active driver approval'::text
           from public.drivers d
          where d.status = 'online'
            and not exists (select 1 from public.staff_roles s
                             where s.user_id = d.id and s.role = 'driver' and s.is_active)$q$;
  end if;
  return query select 'containment', 'default privileges ' || coalesce(d.defaclnamespace::regnamespace::text, '(global)')
                    || ' ' || d.defaclobjtype::text, 'migration role default privileges grant client access'
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'));
  return query select 'containment', 'default privileges (global) f', 'built-in default lets PUBLIC execute new functions'
   where not exists (select 1 from pg_default_acl d
                      where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f');

  -- ============================ storage ============================
  if to_regclass('storage.objects') is null then
    return query select 'storage', 'storage.objects', 'storage schema absent: storage containment not verifiable here';
  else
    -- every policy on every storage table (all commands, incl. SELECT /
    -- listing) must match a reviewed definition exactly
    return query select 'storage', 'storage.' || p.tablename || '.' || p.policyname,
                        'storage policy not reviewed, or its command/roles/mode/USING/WITH CHECK differ from the reviewed definition'
      from pg_policies p
     where p.schemaname = 'storage'
       and (p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::text || '|' || p.cmd || '|'
            || coalesce(regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|'
            || coalesce(regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')) <> all (reviewed_storage_policies);
    return query select 'storage', 'storage.' || split_part(r, '|', 1) || '.' || split_part(r, '|', 2), 'reviewed storage policy missing'
      from unnest(reviewed_storage_policies) r
     where not exists (select 1 from pg_policies p where p.schemaname = 'storage'
                          and p.tablename = split_part(r, '|', 1) and p.policyname = split_part(r, '|', 2));
    return query execute
      $q$select 'storage'::text, 'bucket ' || b.id, 'public bucket other than meal-images'::text
           from storage.buckets b where b.public and b.id <> 'meal-images'$q$;
    -- CTO-approved meal-images limits (5 MiB; jpeg/png/webp only)
    return query execute
      $q$select 'storage'::text, 'bucket meal-images',
                ('size/MIME limits not as approved (file_size_limit=' || coalesce(b.file_size_limit::text, 'NULL')
                 || ', allowed_mime_types=' || coalesce(b.allowed_mime_types::text, 'NULL') || ')')::text
           from storage.buckets b
          where b.id = 'meal-images'
            and (b.file_size_limit is distinct from 5242880
                 or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp']::text[])$q$;
    return query execute
      $q$select 'storage'::text, 'bucket meal-images', 'bucket missing'::text
          where not exists (select 1 from storage.buckets where id = 'meal-images')$q$;
  end if;
end
$cv$;
revoke all on function public.containment_violations() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 0. PREFLIGHT — abort unless the database matches the reviewed evidence.
-- ---------------------------------------------------------------------
do $preflight$
declare
  problems text[] := '{}';
  missing  text;
  admin_rows boolean := false;
  -- Every policy this migration expects to see on the tables it changes:
  -- the staging policies from the 2026-10-15 evidence plus the ones this
  -- migration creates (so a re-run passes). Anything else is unreviewed.
  known_policies text[] := array[
    -- evidence (staging, 2026-10-15)
    'collaborator_analytics.admin_full_access_collaborator_analytics',
    'collaborator_orders.admin_full_access_collaborator_orders',
    'collaborator_orders.collaborators_update_own_orders',
    'collaborator_orders.collaborators_view_own_orders',
    'collaborator_payouts.admin_full_access_collaborator_payouts',
    'collaborators.admin_full_access_collaborators',
    'collaborators.collaborators_view_own',
    'daily_closings.Allow all on daily_closings',
    'daily_closings.ceo_all_closings',
    'drivers.Users can insert own driver record',
    'drivers.Users can update own driver record',
    'drivers.Users can view own driver record',
    'kiosks.ceo_all_kiosks',
    'kiosks.public_read_active_kiosks',
    'meals.Anyone can view meals',
    'meals.Enable delete for admins',
    'meals.Enable insert for admins',
    'meals.Enable read access for all users',
    'meals.Enable update for admins',
    'order_items.Admins full access order_items',
    'order_items.Service role full access order_items',
    'order_items.Users can insert their own order items',
    'order_items.Users can view their own order items',
    'order_status_updates.public_read_status',
    'order_status_updates.staff_insert_status',
    'orders.Admins can view all orders',
    'orders.Allow public insert orders',
    'orders.Allow public update orders',
    'orders.Drivers can view assigned orders',
    'orders.Service role full access',
    'orders.Staff can update order status',
    'orders.Users can insert orders',
    'orders.Users can insert their own orders',
    'orders.Users can update their own orders',
    'orders.Users can view their own orders',
    'orders.cashier_update_orders',
    'orders.kitchen_update_orders',
    'orders.public_create_orders',
    'orders.staff_read_orders',
    'products.Allow public read products',
    'products.CEO can delete',
    'products.Staff can update stock',
    'products.ceo_manage_products',
    'products.kitchen_update_stock',
    'products.public_read_active_products',
    'products.staff_read_all_products',
    'stock_movements.ceo_insert_stock_movements',
    'stock_movements.staff_read_stock_movements',
    'user_profiles.Service role has full access',
    'user_profiles.Users can insert their own profile',
    'user_profiles.Users can update their own profile',
    'user_profiles.Users can view their own profile',
    -- created by this migration
    'collaborator_analytics.staff_admin_all_collaborator_analytics',
    'collaborator_orders.staff_admin_all_collaborator_orders',
    'collaborator_payouts.staff_admin_all_collaborator_payouts',
    'collaborators.staff_admin_all_collaborators',
    'drivers.drivers_self_update_profile_location',
    'drivers.staff_admin_all_drivers',
    'meals.staff_admin_write_meals',
    'order_items.staff_admin_all_order_items',
    'order_status_updates.order_owner_read_status',
    'order_status_updates.staff_admin_read_status',
    'orders.staff_admin_all_orders'
  ];
  v record;
begin
  if current_setting('server_version_num')::int < 170000 then
    problems := problems || 'PostgreSQL 17 required (MAINTAIN privilege; reviewed policy definitions as printed by PostgreSQL 17)'::text;
  end if;

  -- Tables this migration touches must exist.
  select string_agg(t, ', ') into missing
    from unnest(array['user_profiles','drivers','orders','order_items','meals',
      'daily_closings','order_status_updates','products','kiosks','stock_movements',
      'collaborators','collaborator_orders','collaborator_payouts','collaborator_analytics',
      'admins','bank_accounts','admin_logs','financial_transactions','platform_settings']) t
   where to_regclass('public.' || quote_ident(t)) is null;
  if missing is not null then problems := problems || ('missing tables: ' || missing); end if;

  -- Columns referenced by grants, policies, functions and triggers below.
  select string_agg(c, ', ') into missing
    from unnest(array[
      'user_profiles.user_id','user_profiles.role','user_profiles.is_admin',
      'user_profiles.gender','user_profiles.goal','user_profiles.height','user_profiles.weight',
      'user_profiles.age','user_profiles.activity_level','user_profiles.program',
      'user_profiles.phone','user_profiles.full_name','user_profiles.updated_at',
      'drivers.id','drivers.status','drivers.first_name','drivers.last_name','drivers.phone',
      'drivers.current_latitude','drivers.current_longitude','drivers.last_location_update',
      'drivers.updated_at','orders.id','orders.user_id','orders.driver_id',
      'order_items.order_id','order_status_updates.order_id']) c
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public'
                        and ic.table_name = split_part(c, '.', 1)
                        and ic.column_name = split_part(c, '.', 2));
  if missing is not null then problems := problems || ('missing columns: ' || missing); end if;

  -- create_order_transaction: only the reviewed signature may exist.
  select string_agg(p.oid::regprocedure::text, ', ') into missing
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order_transaction'
     and pg_get_function_identity_arguments(p.oid) <>
         'p_order_number text, p_kiosk_id uuid, p_items jsonb, p_total numeric, p_language text, p_tracking_token text';
  if missing is not null then problems := problems || ('unreviewed create_order_transaction variant: ' || missing); end if;

  -- No unreviewed policy on any table this migration secures.
  select string_agg(tablename || '.' || policyname, '; ') into missing
    from pg_policies
   where schemaname = 'public'
     and tablename in ('orders','order_items','user_profiles','drivers','daily_closings',
       'order_status_updates','meals','products','kiosks','stock_movements','collaborators',
       'collaborator_orders','collaborator_payouts','collaborator_analytics')
     and (tablename || '.' || policyname) <> all (known_policies);
  if missing is not null then problems := problems || ('unreviewed policies: ' || missing); end if;

  -- drivers.status may only hold the values the app writes, or NULL (no
  -- value). Anything else needs a human decision before normalisation
  -- (section 9). NULL is normalised to 'offline' like every unapproved
  -- driver, and its previous value (NULL) is audited and restorable.
  select string_agg(distinct status, ', ') into missing
    from public.drivers
   where status is not null and status not in ('online','offline','pending','rejected');
  if missing is not null then problems := problems || ('unexpected drivers.status values: ' || missing); end if;

  -- Initial administrator (section 3): on first application (no admin row
  -- in staff_roles yet) the owner-authorized id in section 0b must be a
  -- verified account. user_profiles.role / is_admin are NOT used to find it.
  if to_regclass('public.staff_roles') is not null then
    execute $q$select exists (select 1 from public.staff_roles where role = 'admin')$q$ into admin_rows;
  end if;
  if not admin_rows then
    missing := pg_temp.phase1c_initial_admin_problem(current_setting('phase1c.initial_admin_user_id', true));
    if missing is not null then problems := problems || missing; end if;
  end if;

  -- Platform drift (U3-U6, owners, grantees, RLS): see containment_violations().
  for v in select * from public.containment_violations() c where c.category = 'drift' loop
    problems := problems || ('drift: ' || v.object || ' - ' || v.problem);
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'Phase 1C preflight failed; aborting the migration transaction (its COMMIT cannot succeed): %',
      array_to_string(problems, ' | ') using errcode = 'P0001';
  end if;
  insert into pg_temp.phase1c_gate_ok values ('core preflight');
end
$preflight$;

-- ---------------------------------------------------------------------
-- 1. M2 — new objects must not inherit client privileges.
--    Applies to objects created later by the migration role (postgres).
--    Objects created by supabase_admin keep platform defaults (postgres
--    cannot change those; see plan §Evidence gaps).
-- ---------------------------------------------------------------------
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PostgreSQL's built-in default lets PUBLIC execute every new function.
-- A per-schema rule cannot remove a global default, so this is global for
-- the migration role: every function it creates needs an explicit GRANT.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 2. Kitchens (scope for staff roles). Kitchen A is the only active one.
--    No limit on the number of kitchens.
-- ---------------------------------------------------------------------
create table if not exists public.kitchens (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9_-]{1,16}$'),
  name       text not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.kitchens enable row level security;
revoke all on public.kitchens from public, anon, authenticated;
grant select on public.kitchens to authenticated;
drop policy if exists kitchens_read_authenticated on public.kitchens;
create policy kitchens_read_authenticated on public.kitchens
  for select to authenticated using (true);

insert into public.kitchens (code, name, is_active)
values ('A', 'Kitchen A (Casablanca)', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Single server-managed staff-role table + append-only audit log.
-- ---------------------------------------------------------------------
create table if not exists public.staff_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','support','cashier','kitchen_staff','driver')),
  kitchen_id  uuid references public.kitchens(id),
  is_active   boolean not null default true,
  granted_by  uuid,
  granted_at  timestamptz not null default now(),
  revoked_by  uuid,
  revoked_at  timestamptz,
  -- cashier and kitchen staff always belong to a kitchen; admin and
  -- support are global; drivers may optionally be kitchen-scoped.
  constraint staff_roles_scope check (
       (role in ('cashier','kitchen_staff') and kitchen_id is not null)
    or (role in ('admin','support') and kitchen_id is null)
    or  role = 'driver'),
  constraint staff_roles_unique unique nulls not distinct (user_id, role, kitchen_id)
);
create index if not exists staff_roles_active_user_idx on public.staff_roles (user_id) where is_active;
alter table public.staff_roles enable row level security;
revoke all on public.staff_roles from public, anon, authenticated;
grant select on public.staff_roles to authenticated;   -- rows limited by RLS below

create table if not exists public.security_audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_id       uuid,          -- auth.uid() of the caller; null = migration/operator
  action         text not null,
  target_user_id uuid,
  details        jsonb not null default '{}'::jsonb
);
alter table public.security_audit_log enable row level security;
revoke all on public.security_audit_log from public, anon, authenticated;
grant select on public.security_audit_log to authenticated;  -- admins only, via RLS

create or replace function public.security_audit_log_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'security_audit_log is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.security_audit_log_append_only() from public, anon, authenticated;
drop trigger if exists security_audit_log_append_only on public.security_audit_log;
create trigger security_audit_log_append_only
  before update or delete on public.security_audit_log
  for each row execute function public.security_audit_log_append_only();
drop trigger if exists security_audit_log_no_truncate on public.security_audit_log;
create trigger security_audit_log_no_truncate
  before truncate on public.security_audit_log
  for each statement execute function public.security_audit_log_append_only();

-- Authorization helper: the ONLY source of staff authority in policies.
create or replace function public.has_staff_role(p_role text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles s
     where s.user_id = (select auth.uid())
       and s.role = p_role
       and s.is_active);
$$;
revoke all on function public.has_staff_role(text) from public, anon, authenticated;
grant execute on function public.has_staff_role(text) to authenticated;

drop policy if exists staff_roles_self_read  on public.staff_roles;
drop policy if exists staff_roles_admin_read on public.staff_roles;
create policy staff_roles_self_read on public.staff_roles
  for select to authenticated using (user_id = (select auth.uid()));
create policy staff_roles_admin_read on public.staff_roles
  for select to authenticated using ((select public.has_staff_role('admin')));
-- No INSERT/UPDATE/DELETE policy or grant: changes only through the two
-- functions below (or by an operator with direct database access).

drop policy if exists security_audit_log_admin_read on public.security_audit_log;
create policy security_audit_log_admin_read on public.security_audit_log
  for select to authenticated using ((select public.has_staff_role('admin')));

-- Invariants on staff_roles that hold for EVERY writer (the functions
-- below, service_role, operators, and ON DELETE CASCADE from auth.users):
--   * at least one active admin remains. Writers that remove an active
--     admin are serialized by a transaction-level advisory lock, and the
--     check runs after the lock in a fresh snapshot, so two concurrent
--     revocations cannot both pass (tested);
--   * a driver whose approval is revoked or deleted is set offline
--     (audited);
--   * the table cannot be truncated (TRUNCATE bypasses row triggers).
create or replace function public.staff_roles_require_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or not new.is_active or new.role <> 'admin' or new.user_id is distinct from old.user_id) then
    perform pg_advisory_xact_lock(hashtextextended('phase1c.staff_roles.admin', 0));
    if not exists (select 1 from public.staff_roles where role = 'admin' and is_active) then
      raise exception 'at least one active admin must remain' using errcode = '42501';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.staff_roles_require_admin() from public, anon, authenticated;
drop trigger if exists trg_staff_roles_require_admin on public.staff_roles;
create trigger trg_staff_roles_require_admin
  after update or delete on public.staff_roles
  for each row execute function public.staff_roles_require_admin();

create or replace function public.staff_roles_driver_offline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'driver' and old.is_active
     and (tg_op = 'DELETE' or not new.is_active or new.role <> 'driver' or new.user_id is distinct from old.user_id)
     and not exists (select 1 from public.staff_roles s
                      where s.user_id = old.user_id and s.role = 'driver' and s.is_active) then
    with forced as (
      update public.drivers d set status = 'offline', updated_at = now()
       where d.id = old.user_id and d.status is distinct from 'offline'
      returning d.id
    )
    insert into public.security_audit_log (actor_id, action, target_user_id, details)
    select (select auth.uid()), 'drivers.status.forced_offline', f.id,
           jsonb_build_object('reason', 'driver approval ' || case when tg_op = 'DELETE' then 'deleted' else 'revoked' end,
                              'staff_role_id', old.id)
      from forced f;
  end if;
  return null;
end;
$$;
revoke all on function public.staff_roles_driver_offline() from public, anon, authenticated;
drop trigger if exists trg_staff_roles_driver_offline on public.staff_roles;
create trigger trg_staff_roles_driver_offline
  after update or delete on public.staff_roles
  for each row execute function public.staff_roles_driver_offline();

create or replace function public.staff_roles_no_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'staff_roles cannot be truncated' using errcode = '42501';
end;
$$;
revoke all on function public.staff_roles_no_truncate() from public, anon, authenticated;
drop trigger if exists trg_staff_roles_no_truncate on public.staff_roles;
create trigger trg_staff_roles_no_truncate
  before truncate on public.staff_roles
  for each statement execute function public.staff_roles_no_truncate();

-- TRUNCATE is not needed by any writer of the authority / audit tables.
revoke truncate on public.staff_roles, public.security_audit_log, public.kitchens from service_role;

create or replace function public.assign_staff_role(p_user uuid, p_role text, p_kitchen uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Serialize all staff-role changes (same lock as revoke_staff_role and
  -- trg_staff_roles_require_admin). The authority check below runs after
  -- the lock, in a fresh snapshot, so a caller whose admin role was just
  -- revoked by a concurrent, committed call is refused.
  perform pg_advisory_xact_lock(hashtextextended('phase1c.staff_roles.admin', 0));
  if not public.has_staff_role('admin') then
    raise exception 'only an admin may assign staff roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin','support','cashier','kitchen_staff','driver') then
    raise exception 'unknown staff role %', p_role using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'user % does not exist', p_user using errcode = '22023';
  end if;
  if p_kitchen is not null and not exists (select 1 from public.kitchens k where k.id = p_kitchen and k.is_active) then
    raise exception 'kitchen % does not exist or is not active', p_kitchen using errcode = '22023';
  end if;
  if p_role = 'driver' and not exists (select 1 from public.drivers d where d.id = p_user) then
    raise exception 'user % has no driver profile; create the drivers row first', p_user using errcode = '22023';
  end if;

  insert into public.staff_roles (user_id, role, kitchen_id, granted_by)
  values (p_user, p_role, p_kitchen, (select auth.uid()))
  on conflict (user_id, role, kitchen_id) do update
     set is_active = true, granted_by = excluded.granted_by, granted_at = now(),
         revoked_by = null, revoked_at = null
  returning id into v_id;

  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), 'staff_role.assign', p_user,
          jsonb_build_object('role', p_role, 'kitchen_id', p_kitchen, 'staff_role_id', v_id));
  return v_id;
end;
$$;
revoke all on function public.assign_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.assign_staff_role(uuid, text, uuid) to authenticated;

create or replace function public.revoke_staff_role(p_user uuid, p_role text, p_kitchen uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  -- Serialize all staff-role changes (same lock as assign_staff_role and
  -- trg_staff_roles_require_admin). The authority check and the last-admin
  -- count run after the lock, in a fresh snapshot, so two concurrent
  -- revocations cannot both pass (tested).
  perform pg_advisory_xact_lock(hashtextextended('phase1c.staff_roles.admin', 0));
  if not public.has_staff_role('admin') then
    raise exception 'only an admin may revoke staff roles' using errcode = '42501';
  end if;
  if p_role = 'admin' and (select count(*) from public.staff_roles
                            where role = 'admin' and is_active and user_id <> p_user) = 0 then
    raise exception 'cannot revoke the last active admin' using errcode = '42501';
  end if;

  update public.staff_roles
     set is_active = false, revoked_by = (select auth.uid()), revoked_at = now()
   where user_id = p_user and role = p_role
     and kitchen_id is not distinct from p_kitchen and is_active;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no active % role for user %', p_role, p_user using errcode = '22023';
  end if;

  -- A driver who is no longer approved is set offline by
  -- trg_staff_roles_driver_offline (for every writer, not only here).

  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), 'staff_role.revoke', p_user,
          jsonb_build_object('role', p_role, 'kitchen_id', p_kitchen));
end;
$$;
revoke all on function public.revoke_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_role(uuid, text, uuid) to authenticated;

-- Seed the initial administrator: ONLY the owner-authorized id from
-- section 0b, verified again here (independently of the preflight), and
-- only when staff_roles holds no admin row at all (first application).
-- user_profiles.role / is_admin are never used as a source of authority:
-- any number of profiles may carry role='admin' or is_admin=true (e.g. a
-- customer who used the C1 hole) and none of them is seeded (tested).
do $seed$
declare
  v_value text := current_setting('phase1c.initial_admin_user_id', true);
  v_problem text;
  n int;
begin
  if exists (select 1 from public.staff_roles where role = 'admin') then
    return;   -- re-run: the initial administrator was seeded before
  end if;
  v_problem := pg_temp.phase1c_initial_admin_problem(v_value);
  if v_problem is not null then
    raise exception 'Phase 1C admin seed refused; aborting the migration transaction: %', v_problem using errcode = 'P0001';
  end if;
  insert into public.staff_roles (user_id, role, granted_by) values (v_value::uuid, 'admin', null);
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Phase 1C admin seed inserted % rows (expected exactly 1); aborting the migration transaction', n;
  end if;
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (null, 'staff_role.seed_initial_admin', v_value::uuid,
          jsonb_build_object('source', 'owner-authorized id in migration 20261016170000 section 0b (reviewed commit)',
                             'migration', '20261016170000'));
end
$seed$;

-- ---------------------------------------------------------------------
-- 4. C1 — clients cannot grant themselves privileges via user_profiles.
--    user_profiles.role / is_admin stay as legacy data (routing only) and
--    no longer grant any database authority (section 5).
-- ---------------------------------------------------------------------
create or replace function public.enforce_profile_privilege_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- SECURITY INVOKER: current_user is the API role of the caller. Trusted
  -- server roles (service_role, operators) are not restricted.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role is distinct from 'customer' or new.is_admin is distinct from false then
      raise exception 'profiles can only be created as customer without admin rights'
        using errcode = '42501';
    end if;
  elsif new.role is distinct from old.role
     or new.is_admin is distinct from old.is_admin
     or new.user_id is distinct from old.user_id then
    raise exception 'role, is_admin and user_id cannot be changed by clients'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_profile_privilege_guard() from public, anon, authenticated;
drop trigger if exists trg_enforce_profile_privilege_guard on public.user_profiles;
create trigger trg_enforce_profile_privilege_guard
  before insert or update on public.user_profiles
  for each row execute function public.enforce_profile_privilege_guard();

-- Column-level UPDATE has no effect while a table-level UPDATE grant
-- exists, so replace it. role, is_admin, user_id, id and created_at are
-- deliberately excluded. (The onboarding/profile screens write only the
-- granted columns.)
revoke update on public.user_profiles from anon, authenticated;
grant update (gender, goal, height, weight, age, activity_level, program,
              phone, full_name, updated_at)
  on public.user_profiles to authenticated;

-- ---------------------------------------------------------------------
-- 5. Admin authority: is_admin policies -> staff_roles (single source).
--    Old policy purposes (all "full access for user_profiles.is_admin"):
-- ---------------------------------------------------------------------
drop policy if exists "Admins can view all orders"            on public.orders;          -- ALL via is_admin
drop policy if exists "Admins full access order_items"        on public.order_items;     -- ALL via is_admin
drop policy if exists "Enable delete for admins"              on public.meals;           -- DELETE via is_admin
drop policy if exists "Enable insert for admins"              on public.meals;           -- INSERT via is_admin
drop policy if exists "Enable update for admins"              on public.meals;           -- UPDATE via is_admin
drop policy if exists admin_full_access_collaborators         on public.collaborators;
drop policy if exists admin_full_access_collaborator_orders   on public.collaborator_orders;
drop policy if exists admin_full_access_collaborator_payouts  on public.collaborator_payouts;
drop policy if exists admin_full_access_collaborator_analytics on public.collaborator_analytics;

drop policy if exists staff_admin_all_orders on public.orders;
create policy staff_admin_all_orders on public.orders for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
drop policy if exists staff_admin_all_order_items on public.order_items;
create policy staff_admin_all_order_items on public.order_items for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
drop policy if exists staff_admin_write_meals on public.meals;
create policy staff_admin_write_meals on public.meals for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
drop policy if exists staff_admin_all_collaborators on public.collaborators;
create policy staff_admin_all_collaborators on public.collaborators for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
drop policy if exists staff_admin_all_collaborator_orders on public.collaborator_orders;
create policy staff_admin_all_collaborator_orders on public.collaborator_orders for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
drop policy if exists staff_admin_all_collaborator_payouts on public.collaborator_payouts;
create policy staff_admin_all_collaborator_payouts on public.collaborator_payouts for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
drop policy if exists staff_admin_all_collaborator_analytics on public.collaborator_analytics;
create policy staff_admin_all_collaborator_analytics on public.collaborator_analytics for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
-- Least privilege: NO blanket admin read of user_profiles (customers'
-- health and contact data). Driver approval uses public.drivers only
-- (staff_admin_all_drivers, section 9). No V1 admin workflow needs other
-- users' profiles; one that does must get a narrow, tested interface.
drop policy if exists staff_admin_read_profiles on public.user_profiles;

-- ---------------------------------------------------------------------
-- 5b. Partner model retired: no partner writes. All collaborator,
--     collaborator_orders and payout rows are preserved; partners keep
--     read access to their own rows (collaborators_view_own,
--     collaborators_view_own_orders). containment_violations() reports
--     any write policy outside its allowlist, so this cannot return
--     unnoticed (checked by the postcondition below and after deploy).
-- ---------------------------------------------------------------------
drop policy if exists collaborators_update_own_orders on public.collaborator_orders;  -- UPDATE own rows, any column incl. shares

-- ---------------------------------------------------------------------
-- 6. C2 + C3 — no client creation or modification of orders/items.
--    Checkout is intentionally unavailable until the trusted server-side
--    order-creation function exists (blocked on the fee decision).
-- ---------------------------------------------------------------------
drop policy if exists "Allow public insert orders"             on public.orders;      -- INSERT for anyone, WITH CHECK true
drop policy if exists public_create_orders                     on public.orders;      -- INSERT for anyone, WITH CHECK true
drop policy if exists "Users can insert orders"                on public.orders;      -- INSERT own, any values
drop policy if exists "Users can insert their own orders"      on public.orders;      -- INSERT own, any values
drop policy if exists "Allow public update orders"             on public.orders;      -- UPDATE any visible row, any values
drop policy if exists "Users can update their own orders"      on public.orders;      -- UPDATE own, any values
drop policy if exists "Users can insert their own order items" on public.order_items; -- INSERT any price into own order
-- Kiosk JWT-claim policies (kiosk switched off; reversible retirement).
drop policy if exists "Staff can update order status"          on public.orders;      -- auth.role() in kitchen/cashier/ceo
drop policy if exists cashier_update_orders                    on public.orders;      -- jwt role cashier/ceo
drop policy if exists kitchen_update_orders                    on public.orders;      -- jwt role kitchen/ceo
drop policy if exists staff_read_orders                        on public.orders;      -- jwt role kitchen/cashier/ceo
-- Remaining on orders: owner SELECT, assigned-driver SELECT, service_role
-- ALL, staff admin ALL. On order_items: owner SELECT, service_role ALL,
-- staff admin ALL.

-- ---------------------------------------------------------------------
-- 7. C4 — daily_closings: service_role only. Rows preserved.
-- ---------------------------------------------------------------------
drop policy if exists "Allow all on daily_closings" on public.daily_closings;  -- ALL for anyone
drop policy if exists ceo_all_closings              on public.daily_closings;  -- jwt role ceo
revoke all on public.daily_closings from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. H2 — order_status_updates: no forged writes, no cross-customer reads.
-- ---------------------------------------------------------------------
drop policy if exists public_read_status  on public.order_status_updates;  -- SELECT for anyone
drop policy if exists staff_insert_status on public.order_status_updates;  -- INSERT for anyone
revoke all on public.order_status_updates from anon, authenticated;
grant select on public.order_status_updates to authenticated;
drop policy if exists order_owner_read_status on public.order_status_updates;
create policy order_owner_read_status on public.order_status_updates for select to authenticated
  using (exists (select 1 from public.orders o
                  where o.id = order_status_updates.order_id
                    and o.user_id = (select auth.uid())));
drop policy if exists staff_admin_read_status on public.order_status_updates;
create policy staff_admin_read_status on public.order_status_updates for select to authenticated
  using ((select public.has_staff_role('admin')));
-- Writes: service_role / trusted server functions only (Phase 2).

-- ---------------------------------------------------------------------
-- 9. H3 — drivers: approval (staff_roles 'driver') separated from
--    availability (drivers.status = 'online' | 'offline').
-- ---------------------------------------------------------------------
drop policy if exists "Users can insert own driver record" on public.drivers;  -- self-provisioning
drop policy if exists "Users can update own driver record" on public.drivers;  -- any column, no WITH CHECK
drop policy if exists drivers_self_update_profile_location on public.drivers;
create policy drivers_self_update_profile_location on public.drivers for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists staff_admin_all_drivers on public.drivers;
create policy staff_admin_all_drivers on public.drivers for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));

-- Clients may update only profile and location columns. status,
-- commission_rate, total_earned, weekly_earnings, email, national_id and
-- id are excluded; availability goes through set_driver_availability().
revoke update on public.drivers from anon, authenticated;
grant update (first_name, last_name, phone, current_latitude, current_longitude,
              last_location_update, updated_at)
  on public.drivers to authenticated;

-- Normalise legacy values. The old app used status for BOTH approval
-- ('pending'/'rejected') and availability ('online'/'offline'); its
-- "approve" action wrote 'offline', which is also the insert default, so
-- no legacy value proves admin approval. Therefore every driver starts
-- unapproved (no staff_roles 'driver' row) and must be approved by an
-- admin with assign_staff_role(user, 'driver'). Any driver without an
-- active driver role is set offline; the previous value is logged first.
with changed as (
  select d.id, d.status as old_status
    from public.drivers d
   where d.status is distinct from 'offline'
     and not exists (select 1 from public.staff_roles s
                      where s.user_id = d.id and s.role = 'driver' and s.is_active)
), logged as (
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  select null, 'drivers.status.normalised', c.id,
         jsonb_build_object('old_status', c.old_status, 'new_status', 'offline',
                            'reason', 'approval moved to staff_roles; driver not approved',
                            'migration', '20261016170000')
    from changed c
  returning target_user_id
)
update public.drivers d
   set status = 'offline'
  from logged l
 where d.id = l.target_user_id;

do $c$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.drivers'::regclass and conname = 'drivers_status_availability_check') then
    alter table public.drivers add constraint drivers_status_availability_check
      check (status in ('online', 'offline'));
  end if;
end
$c$;
-- Availability is never unknown: every row is 'online' or 'offline' (the
-- normalisation above already set NULL values to 'offline', audited).
alter table public.drivers alter column status set not null;

-- Invariant for every writer (clients, admins, service_role): only an
-- approved driver can be online.
create or replace function public.enforce_driver_availability()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'online' and not exists (
       select 1 from public.staff_roles s
        where s.user_id = new.id and s.role = 'driver' and s.is_active) then
    raise exception 'driver % is not approved and cannot go online', new.id using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_driver_availability() from public, anon, authenticated;
drop trigger if exists trg_enforce_driver_availability on public.drivers;
create trigger trg_enforce_driver_availability
  before insert or update of status on public.drivers
  for each row execute function public.enforce_driver_availability();

create or replace function public.set_driver_availability(p_online boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text := case when p_online then 'online' else 'offline' end;
begin
  if v_uid is null or p_online is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.drivers d where d.id = v_uid) then
    raise exception 'no driver profile for this account' using errcode = '42501';
  end if;
  -- going online is additionally checked by trg_enforce_driver_availability
  update public.drivers set status = v_status, updated_at = now() where id = v_uid;
  return v_status;
end;
$$;
revoke all on function public.set_driver_availability(boolean) from public, anon, authenticated;
grant execute on function public.set_driver_availability(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 10. H4 — privileged / unsafe functions: no client execution.
--     create_order_transaction is NOT repaired or reactivated.
-- ---------------------------------------------------------------------
do $f$
begin
  if to_regprocedure('public.create_order_transaction(text, uuid, jsonb, numeric, text, text)') is not null then
    revoke all on function public.create_order_transaction(text, uuid, jsonb, numeric, text, text) from public, anon, authenticated;
    -- Empty search_path: its unqualified table references now fail even
    -- for a privileged caller, so it cannot be used by accident.
    alter function public.create_order_transaction(text, uuid, jsonb, numeric, text, text) set search_path = '';
  end if;
  if to_regprocedure('public.calculate_driver_weekly_earnings()') is not null then
    revoke all on function public.calculate_driver_weekly_earnings() from public, anon, authenticated;
  end if;
  -- Hygiene: these cannot be called directly (trigger / event-trigger
  -- return types); revoking EXECUTE does not affect trigger firing.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.calculate_collaborator_revenue_split()') is not null then
    revoke all on function public.calculate_collaborator_revenue_split() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.update_collaborator_analytics()') is not null then
    revoke all on function public.update_collaborator_analytics() from public, anon, authenticated;
  end if;
end
$f$;

-- ---------------------------------------------------------------------
-- 11. Kiosk / Ola Amigos retirement (switched off). Policies only; all
--     rows and tables preserved; reversible (see rollback file).
-- ---------------------------------------------------------------------
drop policy if exists "Allow public read products"   on public.products;        -- SELECT for anyone
drop policy if exists public_read_active_products    on public.products;        -- SELECT active for anyone
drop policy if exists staff_read_all_products        on public.products;        -- SELECT any signed-in user
drop policy if exists "CEO can delete"               on public.products;        -- auth.role() = ceo
drop policy if exists "Staff can update stock"       on public.products;        -- auth.role() = ceo
drop policy if exists ceo_manage_products            on public.products;        -- jwt role ceo
drop policy if exists kitchen_update_stock           on public.products;        -- jwt role kitchen/ceo
drop policy if exists ceo_all_kiosks                 on public.kiosks;          -- jwt role ceo
drop policy if exists public_read_active_kiosks      on public.kiosks;          -- SELECT for anyone
drop policy if exists ceo_insert_stock_movements     on public.stock_movements; -- jwt role ceo
drop policy if exists staff_read_stock_movements     on public.stock_movements; -- jwt role kitchen/ceo

-- ---------------------------------------------------------------------
-- 12. Client grants (defense in depth; RLS above already denies these).
-- ---------------------------------------------------------------------
-- Unauthenticated callers may only read the menu.
revoke all on all tables in schema public from anon;
grant select on public.meals to anon;
-- Signed-in clients: no access to retired kiosk tables or to tables that
-- hold financial/administrative data and have no client policy.
revoke all on public.kiosks, public.products, public.stock_movements,
              public.admins, public.bank_accounts, public.admin_logs,
              public.financial_transactions, public.platform_settings
  from authenticated;
-- Privileges that RLS does not govern (TRUNCATE empties a table regardless
-- of policies; REFERENCES, TRIGGER and MAINTAIN are not needed by clients).
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
-- authenticated keeps table grants on orders, order_items, meals,
-- collaborator_* so the staff-admin path works; RLS has no client
-- INSERT/UPDATE policy for customers or drivers on those tables.

-- ---------------------------------------------------------------------
-- 13. POSTCONDITIONS — abort (and roll back) if any drift or containment
--     violation remains. Same function as the post-deployment check.
--     'storage' rows are closed by 20261016171000_phase1c_storage_meal_images.sql,
--     whose own postcondition requires zero rows of every category.
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v
   where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'Phase 1C postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  -- also reported by containment_violations(); stated here explicitly
  if not exists (select 1 from public.staff_roles where role = 'admin' and is_active) then
    raise exception 'Phase 1C postcondition failed: no active admin; aborting the migration transaction';
  end if;
  insert into pg_temp.phase1c_gate_ok values ('core postcondition');
end
$post$;

commit;
