-- =====================================================================
-- TEST FIXTURE DATA. DISPOSABLE DATABASE ONLY. Synthetic: no real users.
-- Loaded as the migration role (table owner) AFTER the baseline and
-- BEFORE the migration. Shapes follow the staging evidence and the owner's
-- user_profiles aggregate (1 admin/true, 1 customer/true, customers,
-- 1 driver profile); the values themselves are invented test data.
-- =====================================================================
\set ON_ERROR_STOP 1

-- Users (supabase_admin owns auth.users in the image; run this file as
-- supabase_admin, see run_phase1c.sh).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),  -- legitimate admin
  ('00000000-0000-0000-0000-0000000000e1'),  -- illegitimate: role=customer, is_admin=true
  ('00000000-0000-0000-0000-0000000000c1'),  -- customer A
  ('00000000-0000-0000-0000-0000000000c2'),  -- customer B
  ('00000000-0000-0000-0000-0000000000c3'),  -- signed up, no profile yet
  ('00000000-0000-0000-0000-0000000000d1'),  -- driver, legacy status 'offline' (old "approved")
  ('00000000-0000-0000-0000-0000000000d2'),  -- driver, legacy status 'pending'
  ('00000000-0000-0000-0000-0000000000d3'),  -- driver, legacy status 'online' (self-set)
  ('00000000-0000-0000-0000-0000000000d4'),  -- driver, legacy status 'rejected'
  ('00000000-0000-0000-0000-0000000000f1');  -- future cashier

set role postgres;

insert into public.user_profiles (user_id, role, is_admin, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin',    true,  'Admin'),
  ('00000000-0000-0000-0000-0000000000e1', 'customer', true,  'Flagged'),
  ('00000000-0000-0000-0000-0000000000c1', 'customer', false, 'Customer A'),
  ('00000000-0000-0000-0000-0000000000c2', 'customer', false, 'Customer B'),
  ('00000000-0000-0000-0000-0000000000d1', 'driver',   false, 'Driver 1'),
  ('00000000-0000-0000-0000-0000000000f1', 'customer', false, 'Cashier to be');

insert into public.drivers (id, email, status, commission_rate, total_earned) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.invalid', 'offline',  0.15, 0),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@test.invalid', 'pending',  0.15, 0),
  ('00000000-0000-0000-0000-0000000000d3', 'd3@test.invalid', 'online',   0.15, 0),
  ('00000000-0000-0000-0000-0000000000d4', 'd4@test.invalid', 'rejected', 0.15, 0);

insert into public.meals (id, name, price, calories, protein) values
  ('00000000-0000-0000-0000-00000000aa01', 'Test bowl', 60, 500, 30);

insert into public.kiosks (id, name, status) values
  ('00000000-0000-0000-0000-00000000bb01', 'Kiosk 1', 'inactive');
insert into public.products (id, name_en, name_fr, name_ar, price, category, brand) values
  ('00000000-0000-0000-0000-00000000cc01', 'Taco', 'Taco', 'Taco', 30, 'food', 'ola-amigos');

insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id, driver_id, kiosk_id) values
  ('00000000-0000-0000-0000-00000000a001', 'A-1', 75,  60,  15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c1', null, null),
  ('00000000-0000-0000-0000-00000000a002', 'A-2', 200, 185, 15, 'paid',      'card', '00000000-0000-0000-0000-0000000000c1', null, null),  -- historical card order
  ('00000000-0000-0000-0000-00000000b001', 'B-1', 99,  84,  15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c2', null, null),
  ('00000000-0000-0000-0000-00000000d001', 'D-1', 50,  35,  15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c2',
     '00000000-0000-0000-0000-0000000000d1', null),
  ('00000000-0000-0000-0000-00000000f001', 'K-1', 30,  null, 0, 'served',    'cash', null, null, '00000000-0000-0000-0000-00000000bb01');

insert into public.order_items (order_id, meal_id, meal_name, quantity, price) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000aa01', 'Test bowl', 1, 60),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000aa01', 'Test bowl', 1, 60);

insert into public.order_status_updates (order_id, status, message) values
  ('00000000-0000-0000-0000-00000000a001', 'confirmed', 'A confirmed'),
  ('00000000-0000-0000-0000-00000000b001', 'confirmed', 'B confirmed');

insert into public.stock_movements (product_id, quantity_change, reason, order_id) values
  ('00000000-0000-0000-0000-00000000cc01', -1, 'order', '00000000-0000-0000-0000-00000000f001');
insert into public.daily_closings (date, starting_capital, total_sales) values ('2026-10-01', 100, 30);

reset role;
