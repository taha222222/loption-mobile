-- L'OPTION Phase 1B — local reproduction of production RLS behaviour.
-- Recreates ONLY the objects needed to test the findings, copied from the
-- catalog evidence generated 2026-10-15T19:40:30Z (PostgreSQL 17.6).
-- Run on a DISPOSABLE local PostgreSQL. Never run against Supabase.
\set ON_ERROR_STOP 0
\pset footer off

-- Supabase-like roles and auth helpers (auth.uid/role/jwt read request.jwt.claims)
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;

-- Tables (columns relevant to the tests; types as in evidence)
create table public.user_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id),
  role text default 'customer', is_admin boolean default false, full_name text);
create table public.drivers (id uuid primary key references auth.users(id), email text not null, status text default 'offline',
  commission_rate numeric default 0.15, total_earned numeric default 0);
create table public.orders (id uuid primary key default gen_random_uuid(), order_number text not null unique, total numeric not null,
  status text default 'new', user_id uuid references auth.users(id), driver_id uuid references public.drivers(id),
  payment_method text, subtotal numeric, delivery_fee numeric default 10, financial_status text default 'pending',
  constraint orders_status_check check (status = any (array['new','confirmed','waiting_payment','in_preparation','prepared','ready_to_serve','served','paid'])));
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id) on delete cascade,
  meal_id uuid, meal_name text not null, quantity int not null default 1, price numeric not null);
create table public.daily_closings (id uuid primary key default gen_random_uuid(), date date not null default current_date,
  starting_capital numeric not null default 0, total_sales numeric default 0);

-- Grants exactly as observed: anon and authenticated hold all table privileges
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
alter table public.user_profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.daily_closings enable row level security;

-- Policies copied verbatim from the evidence (role "public")
create policy "Service role has full access" on public.user_profiles for all using (auth.role() = 'service_role');
create policy "Users can insert their own profile" on public.user_profiles for insert with check (auth.uid() = user_id);
create policy "Users can update their own profile" on public.user_profiles for update using (auth.uid() = user_id);
create policy "Users can view their own profile" on public.user_profiles for select using (auth.uid() = user_id);

create policy "Users can insert own driver record" on public.drivers for insert with check (auth.uid() = id);
create policy "Users can update own driver record" on public.drivers for update using (auth.uid() = id);
create policy "Users can view own driver record" on public.drivers for select using (auth.uid() = id);

create policy "Admins can view all orders" on public.orders for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Allow public insert orders" on public.orders for insert with check (true);
create policy "Allow public update orders" on public.orders for update using (true);
create policy "Drivers can view assigned orders" on public.orders for select using (driver_id = auth.uid());
create policy "Service role full access" on public.orders for all using (auth.role() = 'service_role');
create policy "Staff can update order status" on public.orders for update using (auth.role() = any (array['kitchen','cashier','ceo']));
create policy "Users can insert orders" on public.orders for insert with check (auth.uid() = user_id);
create policy "Users can insert their own orders" on public.orders for insert with check (auth.uid() = user_id);
create policy "Users can update their own orders" on public.orders for update using (auth.uid() = user_id);
create policy "Users can view their own orders" on public.orders for select using (auth.uid() = user_id);
create policy "cashier_update_orders" on public.orders for update using ((auth.jwt()->>'role') = any (array['cashier','ceo'])) with check (status = any (array['ready_to_serve','paid']));
create policy "kitchen_update_orders" on public.orders for update using ((auth.jwt()->>'role') = any (array['kitchen','ceo'])) with check (status = any (array['confirmed','in_preparation','prepared']));
create policy "public_create_orders" on public.orders for insert with check (true);
create policy "staff_read_orders" on public.orders for select using ((auth.jwt()->>'role') = any (array['kitchen','cashier','ceo']));

create policy "Admins full access order_items" on public.order_items for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Service role full access order_items" on public.order_items for all using (auth.role() = 'service_role');
create policy "Users can insert their own order items" on public.order_items for insert with check (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));
create policy "Users can view their own order items" on public.order_items for select using (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));

create policy "Allow all on daily_closings" on public.daily_closings for all using (true);
create policy "ceo_all_closings" on public.daily_closings for all using ((auth.jwt()->>'role') = 'ceo');

-- Fixture data (as table owner, RLS not applied)
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000d');
insert into public.user_profiles (user_id, role, is_admin) values
  ('00000000-0000-0000-0000-00000000000a', 'customer', false), ('00000000-0000-0000-0000-00000000000b', 'customer', false);
insert into public.drivers (id, email, status) values ('00000000-0000-0000-0000-00000000000d', 'd@x.ma', 'offline');
insert into public.orders (order_number, total, status, user_id, payment_method, subtotal) values
  ('A-1', 135, 'confirmed', '00000000-0000-0000-0000-00000000000a', 'cash', 120),
  ('B-1', 99, 'confirmed', '00000000-0000-0000-0000-00000000000b', 'cash', 84);
insert into public.daily_closings (starting_capital, total_sales) values (1000, 5000);

\echo '=== T1 anon (no login) inserts an order: card, total 0, status paid (expected under current policies: SUCCEEDS)'
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
insert into public.orders (order_number, total, status, payment_method) values ('ANON-1', 0, 'paid', 'card');
reset role;
select order_number, total, status, payment_method from public.orders where order_number = 'ANON-1';

\echo '=== T2 customer A inserts an order attributed to customer B (expected: SUCCEEDS)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
insert into public.orders (order_number, total, status, user_id, payment_method) values ('FORGED-B', 1, 'confirmed', '00000000-0000-0000-0000-00000000000b', 'card');
reset role; select order_number, user_id, payment_method from public.orders where order_number = 'FORGED-B';

\echo '=== T3 customer A marks own order paid, total 0, card (expected: SUCCEEDS)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
update public.orders set status = 'paid', total = 0, payment_method = 'card', financial_status = 'settled' where order_number = 'A-1';
reset role; select order_number, status, total, payment_method, financial_status from public.orders where order_number = 'A-1';

\echo '=== T4 customer A updates customer B order by id (expected: 0 rows, blocked only by SELECT visibility)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
update public.orders set total = 0 where order_number = 'B-1';
reset role; select order_number, total from public.orders where order_number = 'B-1';

\echo '=== T5 customer A inserts an item with an arbitrary price into own order (expected: SUCCEEDS)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
insert into public.order_items (order_id, meal_name, quantity, price) select id, 'Chicken Bowl', 10, 0.01 from public.orders where order_number = 'A-1';
reset role; select meal_name, quantity, price from public.order_items;

\echo '=== T6 customer A promotes self to admin (expected: SUCCEEDS)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
update public.user_profiles set is_admin = true, role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000a';
\echo '--- T6b ...and can now read and rewrite every order, including B''s (expected: SUCCEEDS)'
update public.orders set total = 0, status = 'paid' where order_number = 'B-1';
select order_number, total, status from public.orders order by order_number;
reset role;

\echo '=== T7 customer B registers self as an online driver with 100% commission (expected: SUCCEEDS)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000b"}', false);
insert into public.drivers (id, email, status, commission_rate) values ('00000000-0000-0000-0000-00000000000b', 'b@x.ma', 'online', 1.0);
reset role; select id, status, commission_rate from public.drivers order by id;

\echo '=== T8 approved driver D tries to list unassigned orders (expected: 0 rows, so the claim flow cannot work)'
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000d"}', false);
select count(*) as visible_unassigned_orders from public.orders where driver_id is null;
reset role;

\echo '=== T9 app delivery statuses vs orders_status_check (expected: accepted/picked_up/on_the_way/delivered/cancelled REJECTED)'
update public.orders set status = 'accepted' where order_number = 'A-1';
update public.orders set status = 'delivered' where order_number = 'A-1';
update public.orders set status = 'cancelled' where order_number = 'A-1';

\echo '=== T10 anon reads and deletes daily_closings (expected: SUCCEEDS)'
set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select count(*) as closings_visible_to_anon from public.daily_closings;
delete from public.daily_closings;
reset role; select count(*) as closings_remaining from public.daily_closings;
