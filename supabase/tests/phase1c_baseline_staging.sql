-- =====================================================================
-- TEST FIXTURE ONLY — never run against staging or production.
-- Reconstructs the staging objects that the Phase 1C migration touches,
-- as captured in the catalog export of 2026-10-15 (PostgreSQL 17.6):
-- columns, RLS flags, policies (verbatim, role "public"), table grants,
-- default privileges and the two functions. Tables not touched by the
-- migration, and columns irrelevant to the tests, are omitted.
-- Supabase-managed pieces (auth schema, roles) are minimal stand-ins.
-- =====================================================================
\set ON_ERROR_STOP 1

-- Supabase-like roles and auth helpers (read request.jwt.claims like GoTrue/PostgREST)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select auth.jwt()->>'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Default privileges exactly as observed for owner postgres in public
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------- tables
create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id),
  gender text, goal text, height numeric, weight numeric, age int,
  activity_level text, program text,
  created_at timestamp default now(), updated_at timestamp default now(),
  is_admin boolean default false, phone text, full_name text,
  role text default 'customer');

create table public.drivers (
  id uuid primary key references auth.users(id),
  email text not null, first_name text, last_name text, phone text, national_id text,
  status text default 'offline',
  current_latitude numeric, current_longitude numeric, last_location_update timestamp,
  created_at timestamp default now(), updated_at timestamp default now(),
  commission_rate numeric default 0.15, total_earned numeric default 0,
  weekly_earnings jsonb default '[]'::jsonb);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  items jsonb, total numeric not null,
  status text default 'new',
  created_at timestamptz default now(), updated_at timestamptz default now(),
  driver_id uuid references public.drivers(id),
  delivery_fee numeric default 10,
  delivery_address text, payment_method text, subtotal numeric,
  platform_service_fee numeric default 0,
  financial_status text default 'pending',
  driver_commission numeric default 0,
  driver_commission_paid boolean default false,
  user_id uuid references auth.users(id),
  constraint orders_status_check check (status = any (array['new','confirmed','waiting_payment',
    'in_preparation','prepared','ready_to_serve','served','paid'])));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  meal_id uuid, meal_name text not null, quantity int not null default 1,
  price numeric not null, notes text, created_at timestamp default now());

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  name text not null, price numeric not null, calories int not null, protein int not null,
  available boolean default true, created_at timestamp default now(), updated_at timestamp default now());

create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date, starting_capital numeric not null default 0,
  total_sales numeric default 0, total_profit numeric default 0,
  ending_stock_value numeric default 0, notes text, created_at timestamptz default now());

create table public.order_status_updates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  status text not null, message text, created_at timestamptz default now());

create table public.collaborators (
  id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id),
  branch_name text not null, status text default 'pending');
create table public.collaborator_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  collaborator_id uuid references public.collaborators(id) on delete cascade,
  preparation_status text default 'pending', order_total numeric not null default 0);
create table public.collaborator_payouts (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid references public.collaborators(id) on delete cascade,
  period_start date not null default current_date, period_end date not null default current_date);
create table public.collaborator_analytics (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid references public.collaborators(id) on delete cascade,
  date date not null default current_date);

-- RLS enabled on every table (as observed), none forced
alter table public.user_profiles        enable row level security;
alter table public.drivers              enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.meals                enable row level security;
alter table public.daily_closings       enable row level security;
alter table public.order_status_updates enable row level security;
alter table public.collaborators        enable row level security;
alter table public.collaborator_orders  enable row level security;
alter table public.collaborator_payouts enable row level security;
alter table public.collaborator_analytics enable row level security;

-- ------------------------------------------------- policies (verbatim)
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
create policy "cashier_update_orders" on public.orders for update using ((auth.jwt() ->> 'role') = any (array['cashier','ceo'])) with check (status = any (array['ready_to_serve','paid']));
create policy "kitchen_update_orders" on public.orders for update using ((auth.jwt() ->> 'role') = any (array['kitchen','ceo'])) with check (status = any (array['confirmed','in_preparation','prepared']));
create policy "public_create_orders" on public.orders for insert with check (true);
create policy "staff_read_orders" on public.orders for select using ((auth.jwt() ->> 'role') = any (array['kitchen','cashier','ceo']));

create policy "Admins full access order_items" on public.order_items for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Service role full access order_items" on public.order_items for all using (auth.role() = 'service_role');
create policy "Users can insert their own order items" on public.order_items for insert with check (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));
create policy "Users can view their own order items" on public.order_items for select using (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));

create policy "Anyone can view meals" on public.meals for select using (true);
create policy "Enable delete for admins" on public.meals for delete using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Enable insert for admins" on public.meals for insert with check (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "Enable read access for all users" on public.meals for select using (true);
create policy "Enable update for admins" on public.meals for update using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));

create policy "Allow all on daily_closings" on public.daily_closings for all using (true);
create policy "ceo_all_closings" on public.daily_closings for all using ((auth.jwt() ->> 'role') = 'ceo');

create policy "public_read_status" on public.order_status_updates for select using (true);
create policy "staff_insert_status" on public.order_status_updates for insert with check (true);

create policy "admin_full_access_collaborators" on public.collaborators for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "collaborators_view_own" on public.collaborators for select using (auth.uid() = user_id);
create policy "admin_full_access_collaborator_orders" on public.collaborator_orders for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "collaborators_update_own_orders" on public.collaborator_orders for update using (collaborator_id in (select collaborators.id from collaborators where collaborators.user_id = auth.uid()));
create policy "collaborators_view_own_orders" on public.collaborator_orders for select using (collaborator_id in (select collaborators.id from collaborators where collaborators.user_id = auth.uid()));
create policy "admin_full_access_collaborator_payouts" on public.collaborator_payouts for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));
create policy "admin_full_access_collaborator_analytics" on public.collaborator_analytics for all using (auth.uid() in (select user_profiles.user_id from user_profiles where user_profiles.is_admin = true));

-- ------------------------------------------------ functions (as observed)
-- create_order_transaction: signature, SECURITY DEFINER, missing search_path and
-- default execute grants match staging. The BODY IS SIMPLIFIED (the real body
-- writes kiosk tables not in this fixture); the tests only exercise who may
-- execute it, not what it does.
create function public.create_order_transaction(p_order_number text, p_kiosk_id uuid, p_items jsonb,
  p_total numeric, p_language text, p_tracking_token text default null::text)
returns jsonb language plpgsql security definer as $function$
declare v_order_id uuid;
begin
  insert into orders (order_number, total, status) values (p_order_number, p_total, 'new')
  returning id into v_order_id;
  return jsonb_build_object('success', true, 'order_id', v_order_id);
end;
$function$;

create function public.calculate_driver_weekly_earnings() returns void language plpgsql as $function$
begin
  perform 1;
end;
$function$;

-- --------------------------------------------------------------- seed data
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1'),  -- legitimate admin
 ('00000000-0000-0000-0000-0000000000e1'),  -- illegitimate: role=customer, is_admin=true
 ('00000000-0000-0000-0000-0000000000c1'),  -- customer A
 ('00000000-0000-0000-0000-0000000000c2'),  -- customer B
 ('00000000-0000-0000-0000-0000000000c3'),  -- customer C (no profile yet)
 ('00000000-0000-0000-0000-0000000000d1');  -- driver D
insert into public.user_profiles (user_id, role, is_admin, full_name) values
 ('00000000-0000-0000-0000-0000000000a1', 'admin',    true,  'Admin'),
 ('00000000-0000-0000-0000-0000000000e1', 'customer', true,  'Suspicious'),
 ('00000000-0000-0000-0000-0000000000c1', 'customer', false, 'Customer A'),
 ('00000000-0000-0000-0000-0000000000c2', 'customer', false, 'Customer B'),
 ('00000000-0000-0000-0000-0000000000d1', 'driver',   false, 'Driver D');
insert into public.drivers (id, email, status) values
 ('00000000-0000-0000-0000-0000000000d1', 'd@test.ma', 'offline');
insert into public.orders (order_number, total, subtotal, delivery_fee, status, payment_method, user_id, driver_id) values
 ('A-1', 135, 120, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c1', null),
 ('B-1',  99,  84, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c2', null),
 ('H-CARD', 200, 185, 15, 'paid', 'card', '00000000-0000-0000-0000-0000000000c1', null),  -- historical card order
 ('D-1',  80,  65, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1');
insert into public.order_items (order_id, meal_name, quantity, price)
 select id, 'Chicken Bowl', 2, 60 from public.orders where order_number = 'A-1';
insert into public.meals (name, price, calories, protein) values ('Chicken Bowl', 60, 450, 35);
insert into public.daily_closings (starting_capital, total_sales) values (1000, 5000);
insert into public.order_status_updates (order_id, status, message)
 select id, 'confirmed', 'Order received' from public.orders where order_number = 'B-1';
