-- =====================================================================
-- Phase 1C security tests. DISPOSABLE DATABASE ONLY (run_phase1c.sh).
-- Runs against: baseline (staging schema from evidence) + fixtures, and
-- optionally the containment migration. Each test acts the way PostgREST
-- does (SET ROLE anon|authenticated|service_role + request.jwt.claims),
-- attempts an action, then checks the resulting state as the table owner.
-- PASS = the secure / required behaviour holds.
-- Before the migration many tests are EXPECTED to FAIL: that run
-- documents the vulnerabilities on the reproduced staging schema.
-- These are local PostgreSQL results, not tests of the hosted API.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists tests;
create table if not exists tests.results (
  id text primary key, area text, expectation text, passed boolean, detail text);
truncate tests.results;

create or replace function tests.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function tests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Runs one statement as the current role; returns 'ok:<rows>' or 'err:<sqlstate>'.
create or replace function tests.attempt(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;

-- Counts rows visible to the current role; -1 when access is denied.
create or replace function tests.visible(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || p_sql || ') x' into n;
  return n;
exception when others then
  return -1;
end $$;

create or replace function tests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into tests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Fixture ids
--   a1 legitimate admin   e1 illegitimate is_admin customer   c1/c2 customers
--   c3 signed up, no profile   d1..d4 drivers   f1 future cashier

-- ======================= C2: order creation ==========================
do $$ declare r text; begin
  perform tests.act('anon');
  r := tests.attempt($q$insert into public.orders (order_number, total, status, payment_method) values ('X-ANON', 0, 'paid', 'card')$q$);
  perform tests.reset();
  perform tests.rec('T01', 'C2', 'anon cannot create an order',
    not exists (select 1 from public.orders where order_number = 'X-ANON'), r);
end $$;

do $$ declare r1 text; r2 text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r1 := tests.attempt($q$insert into public.orders (order_number, total, subtotal, status, payment_method, user_id)
                         values ('X-C1', 1, 1, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c1')$q$);
  r2 := tests.attempt($q$insert into public.orders (order_number, total, status, payment_method, user_id)
                         values ('X-C1-FORGED', 0, 'paid', 'card', '00000000-0000-0000-0000-0000000000c2')$q$);
  perform tests.reset();
  perform tests.rec('T02', 'C2', 'customer cannot insert an order directly (own, or forged for another user)',
    not exists (select 1 from public.orders where order_number in ('X-C1', 'X-C1-FORGED')), r1 || ' / ' || r2);
end $$;

do $$ declare r text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r := tests.attempt($q$insert into public.order_items (order_id, meal_id, meal_name, quantity, price)
                        values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000aa01', 'Test bowl', 10, 0)$q$);
  perform tests.reset();
  perform tests.rec('T02b', 'C2', 'customer cannot add items with arbitrary price to own order',
    (select count(*) from public.order_items where order_id = '00000000-0000-0000-0000-00000000a001') = 1, r);
end $$;

-- ======================= C1: privileges ==============================
do $$ declare r text; v_role text; v_admin boolean; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r := tests.attempt($q$update public.user_profiles set is_admin = true, role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000c1'$q$);
  perform tests.reset();
  select role, is_admin into v_role, v_admin from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform tests.rec('T03a', 'C1', 'customer cannot set own role / is_admin',
    v_role = 'customer' and v_admin = false, r || ' role=' || v_role || ' is_admin=' || v_admin);
end $$;

do $$ declare r text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c3');
  r := tests.attempt($q$insert into public.user_profiles (user_id, role, is_admin, full_name) values ('00000000-0000-0000-0000-0000000000c3', 'admin', true, 'C3')$q$);
  perform tests.reset();
  perform tests.rec('T03b', 'C1', 'a new profile cannot be created as admin',
    not exists (select 1 from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c3'
                  and (role <> 'customer' or is_admin)), r);
end $$;

do $$ declare r text; begin
  -- the app's sign-up insert (role customer, is_admin false) must keep working
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c3');
  r := tests.attempt($q$insert into public.user_profiles (user_id, full_name, phone, role, is_admin, created_at, updated_at)
                        values ('00000000-0000-0000-0000-0000000000c3', 'C3', null, 'customer', false, now(), now())
                        on conflict do nothing$q$);
  perform tests.reset();
  perform tests.rec('T03c', 'positive', 'sign-up profile insert (customer, not admin) still works',
    exists (select 1 from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c3'
              and role = 'customer' and not is_admin), r);
end $$;

do $$ declare r1 text; r2 text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r1 := tests.attempt($q$insert into public.staff_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'admin')$q$);
  r2 := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000c1', 'admin')$q$);
  perform tests.reset();
  perform tests.rec('T03d', 'C1', 'customer cannot write staff_roles or call assign_staff_role',
    to_regclass('public.staff_roles') is not null
    and r1 like 'err:%' and r2 like 'err:%'
    and tests.visible($q$select 1 from public.staff_roles where user_id = '00000000-0000-0000-0000-0000000000c1'$q$) = 0,
    r1 || ' / ' || r2);
end $$;

do $$ declare n_orders int; r_meal text; v_price numeric; r_assign text; begin
  -- owner-confirmed illegitimate account: role=customer, is_admin=true
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000e1');
  n_orders := tests.visible('select 1 from public.orders');
  r_meal := tests.attempt($q$update public.meals set price = 1 where id = '00000000-0000-0000-0000-00000000aa01'$q$);
  r_assign := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000e1', 'admin')$q$);
  perform tests.reset();
  select price into v_price from public.meals where id = '00000000-0000-0000-0000-00000000aa01';
  perform tests.rec('T03e', 'C1', 'stale is_admin flag (illegitimate account) grants no access',
    n_orders = 0 and v_price = 60 and r_assign like 'err:%'
    and tests.visible($q$select 1 from public.staff_roles where user_id = '00000000-0000-0000-0000-0000000000e1'$q$) = 0,
    'orders_visible=' || n_orders || ' meal ' || r_meal || ' price=' || v_price || ' assign ' || r_assign);
end $$;

do $$ declare r text; v_role text; v_admin boolean; begin
  -- the flagged profile row itself is preserved for investigation
  select role, is_admin into v_role, v_admin from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000e1';
  perform tests.rec('T03f', 'C1', 'flagged account preserved unchanged (role=customer, is_admin=true)',
    v_role = 'customer' and v_admin, 'role=' || v_role || ' is_admin=' || v_admin);
end $$;

-- ======================= C3: order updates ===========================
do $$ declare r text; v numeric; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r := tests.attempt($q$update public.orders set total = 0 where order_number = 'B-1'$q$);
  perform tests.reset();
  select total into v from public.orders where order_number = 'B-1';
  perform tests.rec('T04', 'C3', 'customer cannot edit another customer''s order', v = 99, r);
end $$;

do $$ declare r text; o record; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r := tests.attempt($q$update public.orders set total = 0, subtotal = 0, payment_method = 'card', status = 'paid',
                        financial_status = 'settled', user_id = '00000000-0000-0000-0000-0000000000c2' where order_number = 'A-1'$q$);
  perform tests.reset();
  select * into o from public.orders where order_number = 'A-1';
  perform tests.rec('T05', 'C3', 'customer cannot alter own order price, total, payment, status or owner',
    o.total = 75 and o.payment_method = 'cash' and o.status = 'confirmed'
    and o.user_id = '00000000-0000-0000-0000-0000000000c1' and o.financial_status = 'pending', r);
end $$;

do $$ declare r text; o record; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r := tests.attempt($q$update public.orders set total = 0, driver_commission = 999, driver_commission_paid = true, status = 'paid'
                        where order_number = 'D-1'$q$);
  perform tests.reset();
  select * into o from public.orders where order_number = 'D-1';
  perform tests.rec('T06d', 'C3', 'assigned driver cannot edit order financial fields or status',
    o.total = 50 and o.driver_commission = 0 and not o.driver_commission_paid and o.status = 'confirmed', r);
end $$;

-- ======================= H3: drivers =================================
do $$ declare r text; d record; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r := tests.attempt($q$update public.drivers set commission_rate = 1, total_earned = 9999 where id = '00000000-0000-0000-0000-0000000000d1'$q$);
  perform tests.reset();
  select * into d from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.rec('T06a', 'H3', 'driver cannot set own commission or earnings',
    d.commission_rate = 0.15 and d.total_earned = 0, r);
end $$;

do $$ declare r text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c2');
  r := tests.attempt($q$insert into public.drivers (id, email, status) values ('00000000-0000-0000-0000-0000000000c2', 'x@test.invalid', 'online')$q$);
  perform tests.reset();
  perform tests.rec('T06b', 'H3', 'a user cannot self-register as a driver',
    not exists (select 1 from public.drivers where id = '00000000-0000-0000-0000-0000000000c2'), r);
end $$;

do $$ declare r1 text; r2 text; v text; begin
  -- d2 has a drivers row but no approval (no active staff_roles 'driver')
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d2');
  r1 := tests.attempt($q$update public.drivers set status = 'online' where id = '00000000-0000-0000-0000-0000000000d2'$q$);
  r2 := tests.attempt($q$select public.set_driver_availability(true)$q$);
  perform tests.reset();
  select status into v from public.drivers where id = '00000000-0000-0000-0000-0000000000d2';
  perform tests.rec('T06c', 'H3', 'unapproved driver cannot go online (direct update or function)',
    v = 'offline' and r2 like 'err:%', 'direct ' || r1 || ' / fn ' || r2 || ' status=' || v);
end $$;

do $$ declare n_bad int; n_logged int; has_check boolean; begin
  select count(*) into n_bad from public.drivers d
   where d.status <> 'offline'
     and not exists (select 1 from information_schema.tables where table_name = 'staff_roles' and table_schema = 'public');
  if to_regclass('public.staff_roles') is not null then
    execute $q$select count(*) from public.drivers d where d.status <> 'offline'
               and not exists (select 1 from public.staff_roles s where s.user_id = d.id and s.role = 'driver' and s.is_active)$q$ into n_bad;
    execute $q$select count(*) from public.security_audit_log where action = 'drivers.status.normalised'$q$ into n_logged;
  else
    n_logged := 0;
  end if;
  select exists (select 1 from pg_constraint where conname = 'drivers_status_availability_check') into has_check;
  perform tests.rec('T06g', 'H3', 'legacy driver statuses normalised: none online/pending/rejected without approval; old values audited; status is availability-only',
    n_bad = 0 and n_logged = 3 and has_check, 'unapproved_not_offline=' || n_bad || ' audited=' || n_logged || ' check=' || has_check);
end $$;

do $$ declare r_admin text; r_on text; r_direct text; r_off text; v_on text; v_off text; begin
  -- admin approves d1, d1 goes online and offline through the function
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_admin := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000d1', 'driver')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r_on := tests.attempt($q$select public.set_driver_availability(true)$q$);
  perform tests.reset();
  select status into v_on from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r_direct := tests.attempt($q$update public.drivers set status = 'offline' where id = '00000000-0000-0000-0000-0000000000d1'$q$);
  r_off := tests.attempt($q$select public.set_driver_availability(false)$q$);
  perform tests.reset();
  select status into v_off from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.rec('T06e', 'positive', 'approved driver can go online/offline via set_driver_availability; direct status write denied',
    r_admin like 'ok:%' and r_on like 'ok:%' and v_on = 'online' and r_direct like 'err:%' and r_off like 'ok:%' and v_off = 'offline',
    'approve ' || r_admin || ' on ' || r_on || '=' || coalesce(v_on, '?') || ' direct ' || r_direct || ' off ' || r_off || '=' || coalesce(v_off, '?'));
end $$;

do $$ declare r text; v numeric; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r := tests.attempt($q$update public.drivers set current_latitude = 33.57, current_longitude = -7.59, last_location_update = now()
                        where id = '00000000-0000-0000-0000-0000000000d1'$q$);
  perform tests.reset();
  select current_latitude into v from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.rec('T10e', 'positive', 'driver can still update own location', r = 'ok:1' and v = 33.57, r);
end $$;

-- ======================= H2: order_status_updates ====================
do $$ declare r1 text; r2 text; r3 text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r1 := tests.attempt($q$insert into public.order_status_updates (order_id, status, message) values ('00000000-0000-0000-0000-00000000d001', 'delivered', 'forged')$q$);
  perform tests.reset();
  perform tests.act('anon');
  r2 := tests.attempt($q$insert into public.order_status_updates (order_id, status, message) values ('00000000-0000-0000-0000-00000000a001', 'delivered', 'forged')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r3 := tests.attempt($q$insert into public.order_status_updates (order_id, status, message) values ('00000000-0000-0000-0000-00000000a001', 'delivered', 'forged')$q$);
  perform tests.reset();
  perform tests.rec('T07', 'H2', 'driver, anon and customer cannot write order status updates',
    not exists (select 1 from public.order_status_updates where message = 'forged'), r1 || ' / ' || r2 || ' / ' || r3);
end $$;

do $$ declare own int; other int; anon_n int; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  own := tests.visible($q$select 1 from public.order_status_updates where order_id = '00000000-0000-0000-0000-00000000a001'$q$);
  other := tests.visible($q$select 1 from public.order_status_updates where order_id = '00000000-0000-0000-0000-00000000b001'$q$);
  perform tests.reset();
  perform tests.act('anon');
  anon_n := tests.visible('select 1 from public.order_status_updates');
  perform tests.reset();
  perform tests.rec('T07b', 'H2', 'customer reads own status history only; anon reads none',
    own = 1 and other = 0 and anon_n <= 0, 'own=' || own || ' other=' || other || ' anon=' || anon_n);
end $$;

-- ======================= C4: daily_closings ==========================
do $$ declare n_anon int; n_cust int; r_upd text; r_del text; r_ins text; v numeric; n int; begin
  perform tests.act('anon');
  n_anon := tests.visible('select 1 from public.daily_closings');
  r_upd := tests.attempt($q$update public.daily_closings set total_sales = 0$q$);
  r_del := tests.attempt($q$delete from public.daily_closings$q$);
  r_ins := tests.attempt($q$insert into public.daily_closings (date, starting_capital) values ('2026-10-02', 0)$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  n_cust := tests.visible('select 1 from public.daily_closings');
  perform tests.reset();
  select count(*), max(total_sales) into n, v from public.daily_closings;
  perform tests.rec('T08', 'C4', 'anon and customers cannot read, insert, change or delete daily_closings; rows intact',
    n_anon <= 0 and n_cust <= 0 and n = 1 and v = 30,
    'anon_visible=' || n_anon || ' cust_visible=' || n_cust || ' upd ' || r_upd || ' del ' || r_del || ' ins ' || r_ins || ' rows=' || n);
end $$;

-- ======================= H4: functions ===============================
do $$ declare a1 boolean; a2 boolean; a3 boolean; a4 boolean; begin
  a1 := has_function_privilege('anon', 'public.create_order_transaction(text, uuid, jsonb, numeric, text, text)', 'EXECUTE');
  a2 := has_function_privilege('authenticated', 'public.create_order_transaction(text, uuid, jsonb, numeric, text, text)', 'EXECUTE');
  a3 := has_function_privilege('anon', 'public.calculate_driver_weekly_earnings()', 'EXECUTE');
  a4 := has_function_privilege('authenticated', 'public.calculate_driver_weekly_earnings()', 'EXECUTE');
  perform tests.rec('T09', 'H4', 'anon/authenticated cannot execute create_order_transaction or calculate_driver_weekly_earnings',
    not (a1 or a2 or a3 or a4), format('cot anon=%s auth=%s | cdwe anon=%s auth=%s', a1, a2, a3, a4));
end $$;

do $$ declare cfg text[]; begin
  select proconfig into cfg from pg_proc where oid = 'public.create_order_transaction(text, uuid, jsonb, numeric, text, text)'::regprocedure;
  perform tests.rec('T09b', 'H4', 'create_order_transaction has a fixed empty search_path (not reactivated)',
    cfg = array['search_path=""'], coalesce(array_to_string(cfg, ','), '(none)'));
end $$;

-- ======================= positives ===================================
do $$ declare n int; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  n := tests.visible('select 1 from public.orders');
  perform tests.reset();
  perform tests.rec('T10a', 'positive', 'legitimate admin can read all orders', n = (select count(*) from public.orders), 'visible=' || n);
end $$;

do $$ declare r text; v numeric; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r := tests.attempt($q$update public.meals set price = 65 where id = '00000000-0000-0000-0000-00000000aa01'$q$);
  perform tests.reset();
  select price into v from public.meals where id = '00000000-0000-0000-0000-00000000aa01';
  perform tests.rec('T10b', 'positive', 'legitimate admin can update a menu price', v = 65, r || ' price=' || v);
  update public.meals set price = 60 where id = '00000000-0000-0000-0000-00000000aa01';
end $$;

do $$ declare r_ok text; r_noscope text; r_bad text; k uuid; begin
  if to_regclass('public.kitchens') is not null then
    execute $q$select id from public.kitchens where code = 'A'$q$ into k;
  end if;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_ok := tests.attempt(format($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000f1', 'cashier', %L)$q$, k));
  r_noscope := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000f1', 'kitchen_staff')$q$);
  r_bad := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000f1', 'ceo')$q$);
  perform tests.reset();
  perform tests.rec('T10c', 'positive', 'admin assigns a Kitchen A cashier; unscoped kitchen staff and unknown roles are rejected',
    k is not null and r_ok like 'ok:%' and r_noscope like 'err:%' and r_bad like 'err:%',
    'cashier ' || r_ok || ' / kitchen_staff no kitchen ' || r_noscope || ' / ceo ' || r_bad);
end $$;

do $$ declare own int; other int; items int; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  own := tests.visible($q$select 1 from public.orders where user_id = '00000000-0000-0000-0000-0000000000c1'$q$);
  other := tests.visible($q$select 1 from public.orders where user_id <> '00000000-0000-0000-0000-0000000000c1' or user_id is null$q$);
  items := tests.visible('select 1 from public.order_items');
  perform tests.reset();
  perform tests.rec('T10d', 'positive', 'customer reads own orders and items, not others''',
    own = 2 and other = 0 and items = 1, 'own=' || own || ' other=' || other || ' items=' || items);
end $$;

do $$ declare r text; v numeric; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r := tests.attempt($q$update public.user_profiles set weight = 80, goal = 'lose', activity_level = 'moderate', updated_at = now()
                        where user_id = '00000000-0000-0000-0000-0000000000c1'$q$);
  perform tests.reset();
  select weight into v from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform tests.rec('T10f', 'positive', 'customer can still update own nutrition profile', r = 'ok:1' and v = 80, r);
end $$;

do $$ declare n int; begin
  perform tests.act('anon');
  n := tests.visible('select 1 from public.meals');
  perform tests.reset();
  perform tests.rec('T10g', 'positive', 'menu remains publicly readable', n = 1, 'visible=' || n);
end $$;

do $$ declare r text; begin
  perform tests.act('service_role');
  r := tests.attempt($q$insert into public.orders (order_number, total, status, payment_method, user_id)
                        values ('S-1', 75, 'new', 'cash', '00000000-0000-0000-0000-0000000000c1')$q$);
  perform tests.reset();
  perform tests.rec('T10h', 'positive', 'trusted server (service_role) can still create orders',
    exists (select 1 from public.orders where order_number = 'S-1'), r);
  delete from public.orders where order_number = 'S-1';
end $$;

do $$ declare r text; s numeric; begin
  -- trigger functions keep firing after their EXECUTE grants are revoked
  insert into public.collaborators (id, branch_name, branch_address, branch_email, revenue_share_percent)
  values ('00000000-0000-0000-0000-0000000c0001', 'Legacy', 'x', 'legacy@test.invalid', 50) on conflict do nothing;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r := tests.attempt($q$insert into public.collaborator_orders (order_id, collaborator_id, order_total, collaborator_share, loption_share)
                        values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000c0001', 100, 0, 0)$q$);
  perform tests.reset();
  select collaborator_share into s from public.collaborator_orders where collaborator_id = '00000000-0000-0000-0000-0000000c0001';
  perform tests.rec('T10i', 'positive', 'existing triggers still fire (revenue split computed on admin insert)', s = 50, r || ' share=' || coalesce(s::text, 'none'));
  delete from public.collaborator_orders where collaborator_id = '00000000-0000-0000-0000-0000000c0001';
  delete from public.collaborator_analytics where collaborator_id = '00000000-0000-0000-0000-0000000c0001';
  delete from public.collaborators where id = '00000000-0000-0000-0000-0000000c0001';
end $$;

-- ======================= history =====================================
do $$ declare o record; own int; adm int; begin
  select * into o from public.orders where order_number = 'A-2';
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  own := tests.visible($q$select 1 from public.orders where order_number = 'A-2'$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  adm := tests.visible($q$select 1 from public.orders where order_number = 'A-2'$q$);
  perform tests.reset();
  perform tests.rec('T11', 'history', 'historical card order intact and readable by owner and admin',
    o.total = 200 and o.status = 'paid' and o.payment_method = 'card' and own = 1 and adm = 1,
    format('total=%s status=%s method=%s owner=%s admin=%s', o.total, o.status, o.payment_method, own, adm));
end $$;

do $$ declare n_k int; n_p int; n_s int; n_o int; vis_p int; vis_k int; begin
  select count(*) into n_k from public.kiosks;
  select count(*) into n_p from public.products;
  select count(*) into n_s from public.stock_movements;
  select count(*) into n_o from public.orders where kiosk_id is not null;
  perform tests.act('anon');
  vis_p := tests.visible('select 1 from public.products');
  vis_k := tests.visible('select 1 from public.kiosks');
  perform tests.reset();
  perform tests.rec('T15', 'kiosk', 'kiosk records preserved; retired kiosk tables not readable by clients',
    n_k = 1 and n_p = 1 and n_s = 1 and n_o = 1 and vis_p <= 0 and vis_k <= 0,
    format('kiosks=%s products=%s stock=%s kiosk_orders=%s anon_products=%s anon_kiosks=%s', n_k, n_p, n_s, n_o, vis_p, vis_k));
end $$;

-- ======================= M2: default privileges ======================
do $$ declare t_anon boolean; t_auth boolean; f_anon boolean; f_auth boolean; begin
  create table public.p1c_probe_table (id int);
  create function public.p1c_probe_fn() returns int language sql as 'select 1';
  t_anon := has_table_privilege('anon', 'public.p1c_probe_table', 'SELECT');
  t_auth := has_table_privilege('authenticated', 'public.p1c_probe_table', 'INSERT');
  f_anon := has_function_privilege('anon', 'public.p1c_probe_fn()', 'EXECUTE');
  f_auth := has_function_privilege('authenticated', 'public.p1c_probe_fn()', 'EXECUTE');
  drop function public.p1c_probe_fn();
  drop table public.p1c_probe_table;
  perform tests.rec('T12', 'M2', 'new tables and functions created by the migration role do not auto-grant client access',
    not (t_anon or t_auth or f_anon or f_auth), format('table anon=%s auth=%s | fn anon=%s auth=%s', t_anon, t_auth, f_anon, f_auth));
end $$;

-- ======================= stale state / role changes ==================
do $$ declare r_grant text; before_n int; r_revoke text; after_n int; r_last text; begin
  -- grant f1 admin, then revoke; the SAME JWT loses access immediately
  -- (authority is read from staff_roles on every query, not from the JWT).
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_grant := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000f1', 'admin')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000f1');
  before_n := tests.visible('select 1 from public.orders');
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_revoke := tests.attempt($q$select public.revoke_staff_role('00000000-0000-0000-0000-0000000000f1', 'admin')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000f1');
  after_n := tests.visible('select 1 from public.orders');
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_last := tests.attempt($q$select public.revoke_staff_role('00000000-0000-0000-0000-0000000000a1', 'admin')$q$);
  perform tests.reset();
  perform tests.rec('T13a', 'stale', 'revoked admin loses access on the same session/JWT; last admin cannot be revoked',
    r_grant like 'ok:%' and before_n > 0 and r_revoke like 'ok:%' and after_n = 0 and r_last like 'err:%',
    format('grant %s before=%s revoke %s after=%s last-admin %s', r_grant, before_n, r_revoke, after_n, r_last));
end $$;

do $$ declare r_on text; r_rev text; r_again text; v text; begin
  -- d1 approved in T06e: go online, then admin revokes -> forced offline and cannot return
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r_on := tests.attempt($q$select public.set_driver_availability(true)$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_rev := tests.attempt($q$select public.revoke_staff_role('00000000-0000-0000-0000-0000000000d1', 'driver')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r_again := tests.attempt($q$select public.set_driver_availability(true)$q$);
  perform tests.reset();
  select status into v from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.rec('T13b', 'stale', 'revoking a driver forces offline and blocks going online again',
    r_on like 'ok:%' and r_rev like 'ok:%' and r_again like 'err:%' and v = 'offline',
    format('online %s revoke %s again %s status=%s', r_on, r_rev, r_again, v));
end $$;

-- ======================= partner model retired =======================
do $$ declare r1 text; r2 text; co record; begin
  -- b1 is linked to collaborators row c0b01 (legacy partner)
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000b1');
  r1 := tests.attempt($q$update public.collaborator_orders set collaborator_share = 75, loption_share = 0, preparation_status = 'ready'
                         where id = '00000000-0000-0000-0000-0000000c0b02'$q$);
  r2 := tests.attempt($q$delete from public.collaborator_orders where id = '00000000-0000-0000-0000-0000000c0b02'$q$);
  perform tests.reset();
  select * into co from public.collaborator_orders where id = '00000000-0000-0000-0000-0000000c0b02';
  perform tests.rec('T18a', 'partner', 'retired partner cannot rewrite or delete own partner order (shares, status); row preserved',
    co.id is not null and co.collaborator_share = 37.5 and co.loption_share = 37.5 and co.preparation_status = 'pending'
    and not exists (select 1 from pg_policies where tablename = 'collaborator_orders' and policyname = 'collaborators_update_own_orders'),
    format('update %s delete %s share=%s/%s status=%s', r1, r2, co.collaborator_share, co.loption_share, co.preparation_status));
end $$;

do $$ declare n int; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000b1');
  n := tests.visible($q$select 1 from public.collaborator_orders where id = '00000000-0000-0000-0000-0000000c0b02'$q$);
  perform tests.reset();
  perform tests.rec('T18b', 'positive', 'partner history stays readable by its partner (read policy kept)', n = 1, 'visible=' || n);
end $$;

do $$ declare r text; n int := -9; begin
  -- a partner write policy re-added later must be caught by the containment check
  create policy p1c_probe_partner_write on public.collaborator_orders for update to authenticated using (true);
  if to_regprocedure('public.containment_violations()') is not null then
    execute $q$select count(*) from public.containment_violations()
               where object = 'public.collaborator_orders.p1c_probe_partner_write'$q$ into n;
  end if;
  drop policy p1c_probe_partner_write on public.collaborator_orders;
  perform tests.rec('T18c', 'partner', 'a re-added partner write policy is reported by containment_violations()',
    n = 1, 'violations for probe=' || n);
end $$;

-- ======================= profile privacy =============================
do $$ declare adm int; flag int; drv int; own int; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  adm := tests.visible($q$select 1 from public.user_profiles where user_id <> '00000000-0000-0000-0000-0000000000a1'$q$);
  own := tests.visible($q$select 1 from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000a1'$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000e1');
  flag := tests.visible($q$select 1 from public.user_profiles where user_id <> '00000000-0000-0000-0000-0000000000e1'$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  drv := tests.visible($q$select 1 from public.user_profiles where user_id <> '00000000-0000-0000-0000-0000000000d1'$q$);
  perform tests.reset();
  perform tests.rec('T19', 'privacy', 'no blanket profile read: admin, flagged account and driver see only their own profile',
    adm = 0 and flag = 0 and drv = 0 and own = 1
    and not exists (select 1 from pg_policies where tablename = 'user_profiles' and policyname = 'staff_admin_read_profiles'),
    format('admin_others=%s admin_own=%s flagged_others=%s driver_others=%s', adm, own, flag, drv));
end $$;

do $$ declare n int; r text; begin
  -- driver approval works from public.drivers alone
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  n := tests.visible('select id, email, phone, status from public.drivers');
  r := tests.attempt($q$insert into public.drivers (id, email, status) values ('00000000-0000-0000-0000-0000000000f1', 'f1@test.invalid', 'offline')$q$);
  perform tests.reset();
  perform tests.rec('T10j', 'positive', 'admin reads all driver rows and provisions a driver row (approval needs no profile access)',
    n = 4 and r = 'ok:1', 'drivers_visible=' || n || ' provision ' || r);
  delete from public.drivers where id = '00000000-0000-0000-0000-0000000000f1';
end $$;

do $$ declare n int := -1; a boolean; begin
  if to_regprocedure('public.containment_violations()') is null then
    perform tests.rec('T20', 'verify', 'containment_violations() reports no drift/containment problem; clients cannot execute it',
      false, 'function absent (pre-migration)');
    return;
  end if;
  execute $q$select count(*) from public.containment_violations() where category in ('drift','containment')$q$ into n;
  a := has_function_privilege('authenticated', 'public.containment_violations()', 'EXECUTE')
    or has_function_privilege('anon', 'public.containment_violations()', 'EXECUTE');
  perform tests.rec('T20', 'verify', 'containment_violations() reports no drift/containment problem; clients cannot execute it',
    n = 0 and not a, 'violations=' || n || ' client_exec=' || a);
end $$;

-- ======================= audit, grants ===============================
do $$ declare n_assign int := 0; n_revoke int := 0; r_upd text; r_del text; r_owner text; begin
  if to_regclass('public.security_audit_log') is not null then
    execute $q$select count(*) from public.security_audit_log where action = 'staff_role.assign'$q$ into n_assign;
    execute $q$select count(*) from public.security_audit_log where action = 'staff_role.revoke'$q$ into n_revoke;
  end if;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r_upd := tests.attempt($q$update public.security_audit_log set action = 'x'$q$);
  r_del := tests.attempt($q$delete from public.security_audit_log$q$);
  perform tests.reset();
  r_owner := tests.attempt($q$delete from public.security_audit_log$q$);  -- even the owner
  perform tests.rec('T16', 'audit', 'role grants/revokes are audited; the audit log is append-only (clients and owner)',
    n_assign = 3 and n_revoke = 2 and r_upd like 'err:%' and r_del like 'err:%' and r_owner like 'err:%',
    format('assign=%s revoke=%s client upd %s del %s owner del %s', n_assign, n_revoke, r_upd, r_del, r_owner));
end $$;

do $$ declare bad text; begin
  select string_agg(c.relname || ':' || p, ',') into bad
    from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, p)
     and not (c.relname = 'meals' and p = 'SELECT');
  perform tests.rec('T14', 'grants', 'anon holds no table privilege except SELECT on meals',
    bad is null, coalesce(bad, 'none'));
end $$;

do $$ declare a boolean; begin
  a := has_function_privilege('anon', 'public.has_staff_role(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.assign_staff_role(uuid, text, uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_driver_availability(boolean)', 'EXECUTE');
  perform tests.rec('T17', 'grants', 'anon cannot execute any staff / driver function', not a, 'anon_exec=' || a);
exception when undefined_function then
  perform tests.rec('T17', 'grants', 'anon cannot execute any staff / driver function', false, 'functions absent (pre-migration)');
end $$;

-- ======================= L1: privileges RLS does not govern ===========
do $$ declare r text; n int; bad text; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r := tests.attempt('truncate public.meals cascade');
  perform tests.reset();
  select count(*) into n from public.meals;
  select string_agg(c.relname || ':' || v.p, ',') into bad
    from pg_class c cross join (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and (has_table_privilege('authenticated', c.oid, v.p) or has_table_privilege('anon', c.oid, v.p));
  perform tests.rec('T21', 'L1', 'clients cannot TRUNCATE (RLS does not apply) and hold no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN',
    r like 'err:%' and n = 1 and bad is null, format('truncate %s meals=%s extra_privileges=%s', r, n, coalesce(bad, 'none')));
end $$;

-- ======================= L2: at least one active admin, every writer ===
do $$ declare r_upd text; r_del text; r_trunc text; n int := -1; begin
  -- a1 is the only active admin here; service_role and the owner bypass
  -- the revoke function, so the invariant must hold in the table itself.
  perform tests.act('service_role');
  r_upd := tests.attempt($q$update public.staff_roles set is_active = false where role = 'admin'$q$);
  r_del := tests.attempt($q$delete from public.staff_roles where role = 'admin'$q$);
  perform tests.reset();
  r_trunc := tests.attempt('truncate public.staff_roles');   -- even the owner
  if to_regclass('public.staff_roles') is not null then
    execute $q$select count(*) from public.staff_roles where role = 'admin' and is_active$q$ into n;
  end if;
  perform tests.rec('T22', 'L2', 'the last active admin cannot be removed by any writer (service_role update/delete, owner TRUNCATE)',
    r_upd like 'err:%' and r_del like 'err:%' and r_trunc like 'err:%' and n >= 1,
    format('update %s delete %s truncate %s active_admins=%s', r_upd, r_del, r_trunc, n));
end $$;

-- ======================= L3: revoked/deleted approval => offline =======
do $$ declare r1 text; r2 text; r3 text; r4 text; s1 text; s2 text; n_audit int := 0; n_before int := 0; begin
  if to_regclass('public.security_audit_log') is not null then
    execute $q$select count(*) from public.security_audit_log where action = 'drivers.status.forced_offline'$q$ into n_before;
  end if;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r1 := tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000d1', 'driver')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  r2 := tests.attempt($q$select public.set_driver_availability(true)$q$);
  perform tests.reset();
  -- approval revoked directly (not through revoke_staff_role)
  perform tests.act('service_role');
  r3 := tests.attempt($q$update public.staff_roles set is_active = false
                          where user_id = '00000000-0000-0000-0000-0000000000d1' and role = 'driver'$q$);
  perform tests.reset();
  select status into s1 from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  -- approved again, online again, then the approval row is DELETED
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform tests.attempt($q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000d1', 'driver')$q$);
  perform tests.reset();
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  perform tests.attempt($q$select public.set_driver_availability(true)$q$);
  perform tests.reset();
  perform tests.act('service_role');
  r4 := tests.attempt($q$delete from public.staff_roles
                          where user_id = '00000000-0000-0000-0000-0000000000d1' and role = 'driver'$q$);
  perform tests.reset();
  select status into s2 from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  if to_regclass('public.security_audit_log') is not null then
    execute $q$select count(*) from public.security_audit_log
                where action = 'drivers.status.forced_offline'$q$ into n_audit;
    n_audit := n_audit - n_before;
  end if;
  perform tests.rec('T23', 'L3', 'a driver whose approval is revoked or deleted directly is forced offline (audited)',
    r1 like 'ok:%' and r2 like 'ok:%' and r3 = 'ok:1' and s1 = 'offline' and r4 = 'ok:1' and s2 = 'offline' and n_audit = 2,
    format('assign %s online %s revoke-direct %s -> %s | delete %s -> %s | audit=%s', r1, r2, r3, s1, r4, s2, n_audit));
end $$;

-- ======================= drivers.status is never NULL ==================
do $$ declare r text; nn boolean; begin
  perform tests.act('service_role');
  r := tests.attempt($q$update public.drivers set status = null where id = '00000000-0000-0000-0000-0000000000d2'$q$);
  perform tests.reset();
  select attnotnull into nn from pg_attribute where attrelid = 'public.drivers'::regclass and attname = 'status';
  perform tests.rec('T24', 'H3', 'drivers.status is NOT NULL and only online/offline (even for service_role)',
    r like 'err:%' and nn, format('set null %s not_null=%s', r, nn));
end $$;

\pset footer off
select id, area, case when passed then 'PASS' else 'FAIL' end as result, expectation, detail
  from tests.results order by id;
