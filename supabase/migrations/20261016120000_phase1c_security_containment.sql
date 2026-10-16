-- =====================================================================
-- L'OPTION V1 — Phase 1C: Database Security Containment
-- Target: STAGING ONLY (project teppcfnpkoxkudajnvad). DO NOT run on production.
-- Based on the verified catalog export dated 2026-10-15 (PostgreSQL 17.6).
--
-- Closes: C1 (role/is_admin self-grant), C2 (open order inserts),
--         C3 (open order updates), C4 (open daily_closings),
--         H2 (open order_status_updates), H3 (driver self-privilege),
--         H4 (anon-executable create_order_transaction), M2 (default privs).
--
-- Preserves ALL data: no row is updated or deleted, no table dropped,
-- no order marked paid, no payment history changed, no kiosk table removed.
-- Historical card orders are untouched (COD-only is a client/app rule, not
-- enforced here as a CHECK, so existing card rows remain valid and updatable
-- by service_role).
--
-- Re-runnable: every CREATE is preceded by DROP ... IF EXISTS; seeds use
-- idempotent guards. Safe to apply twice.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0a. M2 — prevent new tables/functions from auto-granting client access.
--     Runs FIRST so the objects this migration creates never inherit client grants.
--    Applies to objects created later by the role running this migration
--    (postgres on Supabase). Objects created by supabase_admin (platform)
--    keep the platform defaults; postgres cannot change those.
-- ---------------------------------------------------------------------
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PostgreSQL's built-in default lets PUBLIC (which includes anon) execute
-- every new function. A per-schema rule cannot remove a global default, so
-- this one is global for the migration role: every new function it creates,
-- in any schema, needs an explicit GRANT EXECUTE (as the helpers above have).
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 0. Single server-managed staff-role table (new authorization source)
--    Section 9. Extensible kitchen scope; kitchens entity is a later phase,
--    so kitchen_id is a nullable uuid with no FK yet (no hardcoded count).
-- ---------------------------------------------------------------------
create table if not exists public.staff_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','support','cashier','kitchen_staff','driver')),
  kitchen_id  uuid,                      -- forward-looking scope (Stage 4 adds kitchens + FK)
  is_active   boolean not null default true,
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz not null default now(),
  constraint staff_roles_unique unique nulls not distinct (user_id, role, kitchen_id)
);

alter table public.staff_roles enable row level security;

-- M2: a newly created table inherits default privileges that grant anon /
-- authenticated full DML. Explicitly strip them so staff_roles is not
-- client-writable regardless of RLS.
revoke all on public.staff_roles from anon, authenticated, public;
grant select on public.staff_roles to authenticated;   -- RLS still restricts rows


-- ---------------------------------------------------------------------
-- 1. Authorization helper (single source of truth for policies)
-- ---------------------------------------------------------------------
create or replace function public.has_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles s
    where s.user_id = (select auth.uid())
      and s.role = p_role
      and s.is_active
  );
$$;
revoke all on function public.has_staff_role(text) from public, anon, authenticated;
-- Policies on publicly readable tables (e.g. meals) call this for anon too,
-- so anon must be able to execute it; it returns false without a login.
grant execute on function public.has_staff_role(text) to anon, authenticated;

-- staff_roles row access (defined after has_staff_role exists).
drop policy if exists staff_roles_self_read  on public.staff_roles;
drop policy if exists staff_roles_admin_read on public.staff_roles;
create policy staff_roles_self_read  on public.staff_roles for select
  using ((select auth.uid()) = user_id);
drop policy if exists staff_roles_admin_read on public.staff_roles;
create policy staff_roles_admin_read on public.staff_roles for select
  using (public.has_staff_role('admin'));
-- No client INSERT/UPDATE/DELETE policy and no DML grant: role changes go
-- only through assign/revoke functions below or service_role.

-- Trusted, explicitly authorized grant / revoke operations (C1).
create or replace function public.assign_staff_role(p_user uuid, p_role text, p_kitchen uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_role('admin') then
    raise exception 'only an admin may assign staff roles' using errcode = '42501';
  end if;
  if p_role not in ('admin','support','cashier','kitchen_staff','driver') then
    raise exception 'unknown staff role %', p_role using errcode = '22023';
  end if;
  insert into public.staff_roles (user_id, role, kitchen_id, granted_by)
  values (p_user, p_role, p_kitchen, (select auth.uid()))
  on conflict (user_id, role, kitchen_id) do update set is_active = true;
end;
$$;
revoke all on function public.assign_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.assign_staff_role(uuid, text, uuid) to authenticated;

create or replace function public.revoke_staff_role(p_user uuid, p_role text, p_kitchen uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_role('admin') then
    raise exception 'only an admin may revoke staff roles' using errcode = '42501';
  end if;
  update public.staff_roles
     set is_active = false
   where user_id = p_user and role = p_role
     and kitchen_id is not distinct from p_kitchen;
end;
$$;
revoke all on function public.revoke_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_role(uuid, text, uuid) to authenticated;

-- Seed ONLY the legitimate admin(s): role='admin' AND is_admin=true.
-- This deliberately EXCLUDES the confirmed-illegitimate account
-- (role='customer', is_admin=true): it is preserved untouched in
-- user_profiles for investigation but gains no authority here.
-- Guard: the catalog evidence shows exactly ONE such row. If the count has
-- changed (e.g. another account set both role='admin' and is_admin=true),
-- abort instead of promoting it; a human must review before re-running.
do $$
declare n int;
begin
  select count(*) into n from public.user_profiles
   where is_admin = true and role = 'admin' and user_id is not null;
  if n <> 1 then
    raise exception 'Phase 1C seed guard: expected exactly 1 legitimate admin (role=admin, is_admin=true), found %. Review user_profiles before applying.', n;
  end if;
end$$;

insert into public.staff_roles (user_id, role, granted_by)
select up.user_id, 'admin', null
from public.user_profiles up
where up.is_admin = true
  and up.role = 'admin'
  and up.user_id is not null
on conflict (user_id, role, kitchen_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. C1 — protect user_profiles.role / is_admin from client control
-- ---------------------------------------------------------------------
create or replace function public.enforce_profile_privilege_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role (trusted server) may set these; clients may not.
  if coalesce((select auth.role()), '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
    new.is_admin := false;
  elsif tg_op = 'UPDATE' then
    new.role := old.role;         -- silently preserve; never client-escalatable
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_profile_privilege_guard() from public, anon, authenticated;

drop trigger if exists trg_enforce_profile_privilege_guard on public.user_profiles;
create trigger trg_enforce_profile_privilege_guard
  before insert or update on public.user_profiles
  for each row execute function public.enforce_profile_privilege_guard();

-- Defense in depth. A column-level REVOKE has no effect while a table-level
-- UPDATE grant exists (Supabase grants one by default), so replace the
-- table-level UPDATE with column-level UPDATE on non-privileged columns only.
-- role, is_admin, user_id and id are deliberately excluded.
revoke update on public.user_profiles from anon, authenticated;
grant update (gender, goal, height, weight, age, activity_level, program,
              phone, full_name, updated_at)
  on public.user_profiles to authenticated;

-- Move admin authority off is_admin onto staff_roles (single source).
drop policy if exists "Admins can view all orders" on public.orders;
drop policy if exists "Admins manage all orders" on public.orders;
create policy "Admins manage all orders" on public.orders for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));

drop policy if exists "Admins full access order_items" on public.order_items;
drop policy if exists "Admins manage order_items" on public.order_items;
create policy "Admins manage order_items" on public.order_items for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));

drop policy if exists "Enable delete for admins" on public.meals;
drop policy if exists "Enable insert for admins" on public.meals;
drop policy if exists "Enable update for admins" on public.meals;
drop policy if exists "Admins manage meals" on public.meals;
create policy "Admins manage meals" on public.meals for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));

drop policy if exists "admin_full_access_collaborators"          on public.collaborators;
drop policy if exists "Admins manage collaborators" on public.collaborators;
create policy "Admins manage collaborators" on public.collaborators for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));
drop policy if exists "admin_full_access_collaborator_orders"    on public.collaborator_orders;
drop policy if exists "Admins manage collaborator_orders" on public.collaborator_orders;
create policy "Admins manage collaborator_orders" on public.collaborator_orders for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));
drop policy if exists "admin_full_access_collaborator_payouts"   on public.collaborator_payouts;
drop policy if exists "Admins manage collaborator_payouts" on public.collaborator_payouts;
create policy "Admins manage collaborator_payouts" on public.collaborator_payouts for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));
drop policy if exists "admin_full_access_collaborator_analytics" on public.collaborator_analytics;
drop policy if exists "Admins manage collaborator_analytics" on public.collaborator_analytics;
create policy "Admins manage collaborator_analytics" on public.collaborator_analytics for all
  using (public.has_staff_role('admin')) with check (public.has_staff_role('admin'));

-- ---------------------------------------------------------------------
-- 3. C2 — stop unauthorized order creation (disable direct client inserts)
-- ---------------------------------------------------------------------
drop policy if exists "Allow public insert orders"        on public.orders;
drop policy if exists "public_create_orders"              on public.orders;
drop policy if exists "Users can insert orders"           on public.orders;
drop policy if exists "Users can insert their own orders" on public.orders;
-- No client INSERT policy remains: checkout is intentionally disabled in
-- staging until the trusted server-side order-creation endpoint exists.

drop policy if exists "Users can insert their own order items" on public.order_items;

-- ---------------------------------------------------------------------
-- 4. C3 — stop unauthorized order updates
-- ---------------------------------------------------------------------
drop policy if exists "Allow public update orders"        on public.orders;
drop policy if exists "Users can update their own orders" on public.orders;
drop policy if exists "Staff can update order status"     on public.orders;  -- inert kiosk policy
drop policy if exists "cashier_update_orders"             on public.orders;  -- kiosk retirement
drop policy if exists "kitchen_update_orders"             on public.orders;  -- kiosk retirement
drop policy if exists "staff_read_orders"                 on public.orders;  -- kiosk retirement
-- Remaining order policies: owner SELECT, assigned-driver SELECT,
-- admin ALL (staff_roles), service_role ALL. No client UPDATE path.

-- ---------------------------------------------------------------------
-- 5. C4 — secure daily_closings (kiosk; reversible policy retirement)
-- ---------------------------------------------------------------------
drop policy if exists "Allow all on daily_closings" on public.daily_closings;
drop policy if exists "ceo_all_closings"            on public.daily_closings;
-- No client policy remains; RLS stays enabled so only service_role reaches it.
-- Rows preserved. Table NOT dropped.

-- ---------------------------------------------------------------------
-- 6. H2 — order_status_updates: remove public read/write
-- ---------------------------------------------------------------------
drop policy if exists "public_read_status" on public.order_status_updates;
drop policy if exists "staff_insert_status" on public.order_status_updates;
-- Service_role only until per-order read access is redesigned.

-- ---------------------------------------------------------------------
-- 7. H3 — drivers: no self-provision, no self-assigned money
-- ---------------------------------------------------------------------
drop policy if exists "Users can insert own driver record" on public.drivers;
-- Driver rows are provisioned by admin/service only (no client INSERT policy).
-- Self-update policy kept for availability/location only. Replace the
-- table-level UPDATE grant with column-level UPDATE on non-financial columns;
-- commission_rate, total_earned, weekly_earnings, email and id are excluded.
-- NOTE: drivers.status still mixes approval and availability (schema limit);
-- separating them is a later phase. Clients can toggle online/offline only.
revoke update on public.drivers from anon, authenticated;
grant update (status, current_latitude, current_longitude, last_location_update,
              first_name, last_name, phone, updated_at)
  on public.drivers to authenticated;

-- ---------------------------------------------------------------------
-- 8. H4 — create_order_transaction: revoke client execute; harden search_path
--    Do NOT repair or reactivate it.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='create_order_transaction') then
    execute 'revoke all on function public.create_order_transaction(text, uuid, jsonb, numeric, text, text) from public, anon, authenticated';
    execute 'alter function public.create_order_transaction(text, uuid, jsonb, numeric, text, text) set search_path = ''''';
  end if;
  -- Hygiene: this plain function is anon-executable and writes rows.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='calculate_driver_weekly_earnings') then
    execute 'revoke all on function public.calculate_driver_weekly_earnings() from public, anon, authenticated';
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 10. Remove client grants where the schema granted them (defense in depth;
--     RLS above already denies these paths).
-- ---------------------------------------------------------------------
-- Kiosk / unused by the app: service_role only.
revoke all on public.daily_closings       from anon, authenticated;
revoke all on public.order_status_updates from anon, authenticated;
-- Unauthenticated callers never write these tables.
revoke insert, update, delete on public.orders                 from anon;
revoke insert, update, delete on public.order_items            from anon;
revoke insert, update, delete on public.meals                  from anon;
revoke insert, update, delete on public.collaborators          from anon;
revoke insert, update, delete on public.collaborator_orders    from anon;
revoke insert, update, delete on public.collaborator_payouts   from anon;
revoke insert, update, delete on public.collaborator_analytics from anon;
revoke all on public.user_profiles from anon;
revoke all on public.drivers       from anon;
-- authenticated keeps table grants on orders/order_items/meals/collaborator_*
-- so the admin path (staff_roles via RLS) keeps working; RLS has no client
-- INSERT/UPDATE policy for customers or drivers.

commit;
