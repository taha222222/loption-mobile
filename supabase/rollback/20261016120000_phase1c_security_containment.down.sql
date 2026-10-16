-- =====================================================================
-- ROLLBACK for 20261016120000_phase1c_security_containment.sql
--
-- !!! DANGER: RUNNING THIS RE-OPENS CRITICAL VULNERABILITIES C1-C4 !!!
-- It restores, verbatim, the policies observed on staging on 2026-10-15:
--   - anyone (including anonymous callers) can create and edit orders
--     with any price, payment method and status;
--   - any customer can grant themselves admin through user_profiles;
--   - anonymous callers can read, change and delete daily_closings;
--   - anonymous callers can execute create_order_transaction.
--
-- Do NOT use this as a routine undo. Preferred recovery (see the plan):
--   1. Identify the specific broken behaviour.
--   2. Ship a small FORWARD migration that adds the missing, narrowly
--      scoped permission (e.g. one SELECT policy) for that behaviour.
--   3. Only if staging is unusable and the CTO approves, run this file,
--      then re-apply the containment migration as soon as possible.
--
-- Data: this script changes NO rows in existing tables. It DROPS the new
-- public.staff_roles table; export it first if role assignments matter:
--   select * from public.staff_roles;   -- save the result
-- =====================================================================

begin;

-- 10. restore the observed client table grants
grant all on public.daily_closings, public.order_status_updates, public.orders, public.order_items,
             public.meals, public.collaborators, public.collaborator_orders, public.collaborator_payouts,
             public.collaborator_analytics, public.user_profiles, public.drivers
  to anon, authenticated;

-- 9. default privileges back to the observed Supabase defaults
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges grant execute on functions to public;

-- 8. functions: restore execute grants and the unset search_path
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='create_order_transaction') then
    execute 'alter function public.create_order_transaction(text, uuid, jsonb, numeric, text, text) reset search_path';
    execute 'grant execute on function public.create_order_transaction(text, uuid, jsonb, numeric, text, text) to public, anon, authenticated';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='calculate_driver_weekly_earnings') then
    execute 'grant execute on function public.calculate_driver_weekly_earnings() to public, anon, authenticated';
  end if;
end$$;

-- 7. drivers
grant update on public.drivers to anon, authenticated;
drop policy if exists "Users can insert own driver record" on public.drivers;
create policy "Users can insert own driver record" on public.drivers for insert with check (auth.uid() = id);

-- 6. order_status_updates
drop policy if exists "public_read_status" on public.order_status_updates;
drop policy if exists "staff_insert_status" on public.order_status_updates;
create policy "public_read_status" on public.order_status_updates for select using (true);
create policy "staff_insert_status" on public.order_status_updates for insert with check (true);

-- 5. daily_closings
drop policy if exists "Allow all on daily_closings" on public.daily_closings;
drop policy if exists "ceo_all_closings" on public.daily_closings;
create policy "Allow all on daily_closings" on public.daily_closings for all using (true);
create policy "ceo_all_closings" on public.daily_closings for all using ((auth.jwt() ->> 'role') = 'ceo');

-- 3-4. orders insert/update policies
drop policy if exists "Allow public insert orders" on public.orders;
drop policy if exists "public_create_orders" on public.orders;
drop policy if exists "Users can insert orders" on public.orders;
drop policy if exists "Users can insert their own orders" on public.orders;
drop policy if exists "Allow public update orders" on public.orders;
drop policy if exists "Users can update their own orders" on public.orders;
drop policy if exists "Staff can update order status" on public.orders;
drop policy if exists "cashier_update_orders" on public.orders;
drop policy if exists "kitchen_update_orders" on public.orders;
drop policy if exists "staff_read_orders" on public.orders;
create policy "Allow public insert orders" on public.orders for insert with check (true);
create policy "public_create_orders" on public.orders for insert with check (true);
create policy "Users can insert orders" on public.orders for insert with check (auth.uid() = user_id);
create policy "Users can insert their own orders" on public.orders for insert with check (auth.uid() = user_id);
create policy "Allow public update orders" on public.orders for update using (true);
create policy "Users can update their own orders" on public.orders for update using (auth.uid() = user_id);
create policy "Staff can update order status" on public.orders for update using (auth.role() = any (array['kitchen','cashier','ceo']));
create policy "cashier_update_orders" on public.orders for update using ((auth.jwt() ->> 'role') = any (array['cashier','ceo'])) with check (status = any (array['ready_to_serve','paid']));
create policy "kitchen_update_orders" on public.orders for update using ((auth.jwt() ->> 'role') = any (array['kitchen','ceo'])) with check (status = any (array['confirmed','in_preparation','prepared']));
create policy "staff_read_orders" on public.orders for select using ((auth.jwt() ->> 'role') = any (array['kitchen','cashier','ceo']));

drop policy if exists "Users can insert their own order items" on public.order_items;
create policy "Users can insert their own order items" on public.order_items for insert with check (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));

-- 2. admin policies back to is_admin
drop policy if exists "Admins manage all orders" on public.orders;
drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders" on public.orders for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));

drop policy if exists "Admins manage order_items" on public.order_items;
drop policy if exists "Admins full access order_items" on public.order_items;
create policy "Admins full access order_items" on public.order_items for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));

drop policy if exists "Admins manage meals" on public.meals;
drop policy if exists "Enable delete for admins" on public.meals;
drop policy if exists "Enable insert for admins" on public.meals;
drop policy if exists "Enable update for admins" on public.meals;
create policy "Enable delete for admins" on public.meals for delete using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Enable insert for admins" on public.meals for insert with check (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Enable update for admins" on public.meals for update using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));

drop policy if exists "Admins manage collaborators" on public.collaborators;
drop policy if exists "admin_full_access_collaborators" on public.collaborators;
create policy "admin_full_access_collaborators" on public.collaborators for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
drop policy if exists "Admins manage collaborator_orders" on public.collaborator_orders;
drop policy if exists "admin_full_access_collaborator_orders" on public.collaborator_orders;
create policy "admin_full_access_collaborator_orders" on public.collaborator_orders for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
drop policy if exists "Admins manage collaborator_payouts" on public.collaborator_payouts;
drop policy if exists "admin_full_access_collaborator_payouts" on public.collaborator_payouts;
create policy "admin_full_access_collaborator_payouts" on public.collaborator_payouts for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
drop policy if exists "Admins manage collaborator_analytics" on public.collaborator_analytics;
drop policy if exists "admin_full_access_collaborator_analytics" on public.collaborator_analytics;
create policy "admin_full_access_collaborator_analytics" on public.collaborator_analytics for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));

-- user_profiles: restore table-level UPDATE and remove the guard trigger
grant update on public.user_profiles to anon, authenticated;
drop trigger if exists trg_enforce_profile_privilege_guard on public.user_profiles;
drop function if exists public.enforce_profile_privilege_guard();

-- 0-1. staff-role model (drops role assignments: export first, see header)
drop function if exists public.assign_staff_role(uuid, text, uuid);
drop function if exists public.revoke_staff_role(uuid, text, uuid);
drop table if exists public.staff_roles;           -- policies on it go with it
drop function if exists public.has_staff_role(text);

commit;
