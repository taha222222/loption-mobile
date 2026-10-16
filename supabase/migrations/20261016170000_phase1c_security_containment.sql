-- =====================================================================
-- L'OPTION V1 — Phase 1C (amended): database security containment
--
-- STATUS: FOR CTO REVIEW. Not applied to any remote database.
-- TARGET: staging project teppcfnpkoxkudajnvad ONLY, after approval.
--         Never production.
-- SCHEMA BASIS: supabase/evidence/catalog_2026-10-15.json, reproduced by
--   20261015194030_baseline_staging_schema.sql (round-trip verified).
-- MODEL: internal kitchens + one server-managed staff-role table
--   (admin, support, cashier, kitchen_staff, driver). No partner model.
--
-- Closes: C1 (role/is_admin self-grant), C2 (open order inserts),
--         C3 (open order updates), C4 (open daily_closings),
--         H2 (open order_status_updates), H3 (driver self-provisioning,
--         self-approval and money fields; approval/availability split),
--         H4 (client-executable create_order_transaction), M2 (default
--         privileges). Also retires the inert kiosk JWT-claim policies.
--
-- Data: no row is deleted; no order, payment, card order, kiosk, product,
--   stock or closing record is modified. The ONLY row changes are:
--   * drivers.status of non-approved drivers set to 'offline' (the legacy
--     value is recorded in security_audit_log first; see section 9);
--   * new rows in the new tables kitchens, staff_roles, security_audit_log.
--
-- Transaction: run as ONE transaction (supabase db push does this per
--   migration; with psql use --single-transaction). Every guard raises,
--   so a failed guard rolls back everything.
-- Re-runnable: yes. All DDL is IF [NOT] EXISTS / drop-then-create, seeds
--   and the driver normalisation are idempotent (tested).
-- =====================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 0. PREFLIGHT — abort unless the database matches the reviewed evidence.
-- ---------------------------------------------------------------------
do $preflight$
declare
  problems text[] := '{}';
  missing  text;
  n        int;
  has_admin boolean := false;
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
    'orders.staff_admin_all_orders',
    'user_profiles.staff_admin_read_profiles'
  ];
begin
  if current_setting('server_version_num')::int < 150000 then
    problems := problems || 'PostgreSQL 15+ required (UNIQUE NULLS NOT DISTINCT)';
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

  -- drivers.status may only hold the values the app writes. Anything else
  -- would need a human decision before normalisation (section 9).
  select string_agg(distinct coalesce(status, '<null>'), ', ') into missing
    from public.drivers
   where status is null or status not in ('online','offline','pending','rejected');
  if missing is not null then problems := problems || ('unexpected drivers.status values: ' || missing); end if;

  -- Admin seed guard (section 3): on first application exactly one
  -- legacy profile with role='admin' AND is_admin=true must exist. The
  -- owner-confirmed illegitimate account (role='customer', is_admin=true)
  -- is excluded by construction and never seeded.
  if to_regclass('public.staff_roles') is not null then
    execute $q$select exists (select 1 from public.staff_roles where role = 'admin' and is_active)$q$
      into has_admin;
  end if;
  if not has_admin then
    select count(*) into n from public.user_profiles
     where role = 'admin' and is_admin = true and user_id is not null;
    if n <> 1 then
      problems := problems || format('admin seed guard: expected exactly 1 profile with role=admin and is_admin=true, found %s', n);
    end if;
  end if;

  if cardinality(problems) > 0 then
    raise exception 'Phase 1C preflight failed; nothing was changed: %', array_to_string(problems, ' | ')
      using errcode = 'P0001';
  end if;
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

create or replace function public.assign_staff_role(p_user uuid, p_role text, p_kitchen uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
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

  -- A driver who is no longer approved cannot stay online.
  if p_role = 'driver' and not exists (select 1 from public.staff_roles
                                        where user_id = p_user and role = 'driver' and is_active) then
    update public.drivers set status = 'offline', updated_at = now()
     where id = p_user and status <> 'offline';
  end if;

  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), 'staff_role.revoke', p_user,
          jsonb_build_object('role', p_role, 'kitchen_id', p_kitchen));
end;
$$;
revoke all on function public.revoke_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_role(uuid, text, uuid) to authenticated;

-- Seed ONLY the legitimate admin (role='admin' AND is_admin=true; the
-- preflight guaranteed exactly one on first run). The owner-confirmed
-- illegitimate account (role='customer', is_admin=true) is NOT seeded and
-- its user_profiles row is preserved unchanged for investigation.
with seeded as (
  insert into public.staff_roles (user_id, role, granted_by)
  select up.user_id, 'admin', null
    from public.user_profiles up
   where up.role = 'admin' and up.is_admin = true and up.user_id is not null
     and not exists (select 1 from public.staff_roles s where s.role = 'admin' and s.is_active)
  on conflict (user_id, role, kitchen_id) do nothing
  returning user_id
)
insert into public.security_audit_log (actor_id, action, target_user_id, details)
select null, 'staff_role.seed_admin_from_legacy_profile', user_id,
       jsonb_build_object('source', 'user_profiles role=admin and is_admin=true', 'migration', '20261016170000')
  from seeded;

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
-- Admins could not see other users' profiles or driver rows before
-- (Phase 1B F5); driver approval needs both. Read-only.
drop policy if exists staff_admin_read_profiles on public.user_profiles;
create policy staff_admin_read_profiles on public.user_profiles for select to authenticated
  using ((select public.has_staff_role('admin')));

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
-- authenticated keeps table grants on orders, order_items, meals,
-- collaborator_* so the staff-admin path works; RLS has no client
-- INSERT/UPDATE policy for customers or drivers on those tables.

-- ---------------------------------------------------------------------
-- 13. POSTCONDITIONS — abort (and roll back) if any hole remains.
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
begin
  select string_agg(tablename || '.' || policyname, '; ') into bad
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ 'is_admin' or coalesce(with_check, '') ~ 'is_admin'
          or coalesce(qual, '') ~ 'jwt\(\) ->> ''role''' or coalesce(with_check, '') ~ 'jwt\(\) ->> ''role'''
          or coalesce(qual, '') ~ 'auth\.role\(\) = ANY'
          or coalesce(qual, '') ~ 'auth\.role\(\) = ''(ceo|kitchen|cashier)''');
  if bad is not null then
    raise exception 'postcondition: legacy authority policies remain: %', bad;
  end if;

  select string_agg(tablename || '.' || policyname, '; ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('orders','order_items','daily_closings','order_status_updates','drivers')
     and cmd in ('INSERT','UPDATE','DELETE','ALL')
     and policyname not in ('Service role full access','Service role full access order_items',
                            'staff_admin_all_orders','staff_admin_all_order_items',
                            'staff_admin_all_drivers','drivers_self_update_profile_location');
  if bad is not null then
    raise exception 'postcondition: unexpected client write policies: %', bad;
  end if;

  if has_table_privilege('anon', 'public.orders', 'INSERT')
     or has_column_privilege('authenticated', 'public.user_profiles', 'is_admin', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE')
     or has_column_privilege('authenticated', 'public.drivers', 'status', 'UPDATE')
     or has_column_privilege('authenticated', 'public.drivers', 'commission_rate', 'UPDATE')
     or has_table_privilege('authenticated', 'public.daily_closings', 'SELECT') then
    raise exception 'postcondition: a client privilege that must be revoked is still granted';
  end if;

  if to_regprocedure('public.create_order_transaction(text, uuid, jsonb, numeric, text, text)') is not null
     and (has_function_privilege('anon', 'public.create_order_transaction(text, uuid, jsonb, numeric, text, text)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.create_order_transaction(text, uuid, jsonb, numeric, text, text)', 'EXECUTE')) then
    raise exception 'postcondition: create_order_transaction is still client-executable';
  end if;
end
$post$;

reset lock_timeout;
