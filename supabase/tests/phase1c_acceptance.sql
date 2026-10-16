-- =====================================================================
-- Phase 1C security acceptance tests. DISPOSABLE DATABASE ONLY.
-- Run after phase1c_baseline_staging.sql (and, for the "after" run, the
-- containment migration). Each test switches role the way PostgREST does
-- (SET ROLE + request.jwt.claims), attempts an action, and records PASS/FAIL.
-- A PASS means the secure behaviour holds; the "before" run is expected
-- to show FAILs for the vulnerabilities.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists tests;
create table if not exists tests.results (id text primary key, area text, expectation text, passed boolean, detail text);
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

create or replace function tests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into tests.results values (p_id, p_area, p_exp, p_ok, p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- T01
do $$ declare n_before int; n_after int; err text := 'none'; begin
  select count(*) into n_before from public.orders;
  perform tests.act('anon');
  begin
    insert into public.orders (order_number, total, status, payment_method) values ('X-ANON', 0, 'paid', 'card');
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select count(*) into n_after from public.orders;
  perform tests.rec('T01', 'C2', 'anon cannot create an order', n_after = n_before, 'error=' || err);
end $$;

-- ---------------------------------------------------------------- T02
do $$ declare n_before int; n_after int; err text := 'none'; begin
  select count(*) into n_before from public.orders;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin
    insert into public.orders (order_number, total, subtotal, status, payment_method, user_id)
    values ('X-CUST', 1, 1, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c1');
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select count(*) into n_after from public.orders;
  perform tests.rec('T02', 'C2', 'customer cannot insert an order directly (server path only)', n_after = n_before, 'error=' || err);
end $$;

-- ---------------------------------------------------------------- T03a
do $$ declare r text; a boolean; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin
    update public.user_profiles set is_admin = true, role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000c1';
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select role, is_admin into r, a from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform tests.rec('T03a', 'C1', 'customer cannot set own role/is_admin', r = 'customer' and a = false, 'error=' || err || ' role=' || r || ' is_admin=' || a);
end $$;

-- ---------------------------------------------------------------- T03b
do $$ declare r text; a boolean; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c3');
  begin
    insert into public.user_profiles (user_id, role, is_admin, full_name) values ('00000000-0000-0000-0000-0000000000c3', 'admin', true, 'C');
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select role, is_admin into r, a from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c3';
  perform tests.rec('T03b', 'C1', 'new profile cannot be created as admin', coalesce(r, 'customer') = 'customer' and coalesce(a, false) = false,
    'error=' || err || ' role=' || coalesce(r, 'none') || ' is_admin=' || coalesce(a::text, 'none'));
end $$;

-- ---------------------------------------------------------------- T03c
do $$ declare ok boolean; err text := 'none'; begin
  -- staff_roles exists only after the migration; before it, nothing to grant through.
  if to_regclass('public.staff_roles') is null then
    perform tests.rec('T03c', 'C1', 'customer cannot write staff_roles or call assign_staff_role', false, 'staff_roles table absent (pre-migration)');
    return;
  end if;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin
    execute $q$insert into public.staff_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'admin')$q$;
  exception when others then err := sqlstate; end;
  begin
    execute $q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000c1', 'admin')$q$;
    err := err || '/assign=allowed';
  exception when others then err := err || '/assign=' || sqlstate; end;
  perform tests.reset();
  select not exists (select 1 from public.staff_roles where user_id = '00000000-0000-0000-0000-0000000000c1') into ok;
  perform tests.rec('T03c', 'C1', 'customer cannot write staff_roles or call assign_staff_role', ok, 'error=' || err);
end $$;

-- ---------------------------------------------------------------- T04
do $$ declare t numeric; err text := 'none'; n int := 0; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin
    update public.orders set total = 0 where order_number = 'B-1';
    get diagnostics n = row_count;
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select total into t from public.orders where order_number = 'B-1';
  perform tests.rec('T04', 'C3', 'customer cannot edit another customer''s order', t = 99, 'rows=' || n || ' error=' || err);
end $$;

-- ---------------------------------------------------------------- T05
do $$ declare t numeric; s text; p text; err text := 'none'; n int := 0; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin
    update public.orders set total = 0, status = 'paid', payment_method = 'card', financial_status = 'settled'
     where order_number = 'A-1';
    get diagnostics n = row_count;
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select total, status, payment_method into t, s, p from public.orders where order_number = 'A-1';
  perform tests.rec('T05', 'C3', 'customer cannot alter own order price/total/payment/status',
    t = 135 and s = 'confirmed' and p = 'cash', 'rows=' || n || ' error=' || err);
end $$;

-- ---------------------------------------------------------------- T06a
do $$ declare c numeric; e numeric; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  begin
    update public.drivers set commission_rate = 1.0, total_earned = 99999 where id = '00000000-0000-0000-0000-0000000000d1';
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select commission_rate, total_earned into c, e from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.rec('T06a', 'H3', 'driver cannot set own commission or earnings', c = 0.15 and e = 0, 'error=' || err);
end $$;

-- ---------------------------------------------------------------- T06b
do $$ declare ok boolean; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c2');
  begin
    insert into public.drivers (id, email, status, commission_rate) values ('00000000-0000-0000-0000-0000000000c2', 'b@test.ma', 'online', 1.0);
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select not exists (select 1 from public.drivers where id = '00000000-0000-0000-0000-0000000000c2') into ok;
  perform tests.rec('T06b', 'H3', 'user cannot self-register as an (online) driver', ok, 'error=' || err);
end $$;

-- ---------------------------------------------------------------- T06c
do $$ declare t numeric; d boolean; err text := 'none'; n int := 0; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  begin
    update public.orders set total = 0, driver_commission_paid = true where order_number = 'D-1';
    get diagnostics n = row_count;
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select total, driver_commission_paid into t, d from public.orders where order_number = 'D-1';
  perform tests.rec('T06c', 'C3', 'assigned driver cannot edit order financial fields', t = 80 and d = false, 'rows=' || n || ' error=' || err);
end $$;

-- ---------------------------------------------------------------- T07
do $$ declare n_before int; n_after int; err text := 'none'; begin
  select count(*) into n_before from public.order_status_updates;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  begin
    insert into public.order_status_updates (order_id, status, message)
      select id, 'served', 'forged' from public.orders where order_number = 'D-1';
  exception when others then err := sqlstate; end;
  perform tests.act('anon');
  begin
    insert into public.order_status_updates (order_id, status, message)
      values ((select id from public.orders limit 1), 'served', 'forged');
  exception when others then err := err || '/anon=' || sqlstate; end;
  perform tests.reset();
  select count(*) into n_after from public.order_status_updates;
  perform tests.rec('T07', 'H2', 'driver or anon cannot write order status updates', n_after = n_before, 'error=' || err);
end $$;

-- ---------------------------------------------------------------- T07b
do $$ declare seen int := -1; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin select count(*) into seen from public.order_status_updates; exception when others then err := sqlstate; end;
  perform tests.reset();
  perform tests.rec('T07b', 'H2', 'customer cannot read other customers'' status history', seen <= 0, 'visible=' || seen || ' error=' || err);
end $$;

-- ---------------------------------------------------------------- T08
do $$ declare seen int := -1; n_after int; err text := 'none'; begin
  perform tests.act('anon');
  begin select count(*) into seen from public.daily_closings; exception when others then err := sqlstate; end;
  begin update public.daily_closings set total_sales = 0; exception when others then err := err || '/upd=' || sqlstate; end;
  begin delete from public.daily_closings; exception when others then err := err || '/del=' || sqlstate; end;
  perform tests.reset();
  select count(*) into n_after from public.daily_closings where total_sales = 5000;
  perform tests.rec('T08', 'C4', 'anon cannot read, change or delete daily_closings', seen <= 0 and n_after = 1,
    'visible=' || seen || ' intact_rows=' || n_after || ' error=' || err);
end $$;

-- ---------------------------------------------------------------- T09
do $$ declare err_a text := 'allowed'; err_b text := 'allowed'; begin
  perform tests.act('anon');
  begin perform public.create_order_transaction('X-F1', null, '[]'::jsonb, 0, 'EN'); exception when others then err_a := sqlstate; end;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_order_transaction('X-F2', null, '[]'::jsonb, 0, 'EN'); exception when others then err_b := sqlstate; end;
  perform tests.reset();
  perform tests.rec('T09', 'H4', 'anon/customer cannot execute create_order_transaction',
    err_a = '42501' and err_b = '42501', 'anon=' || err_a || ' customer=' || err_b);
end $$;

-- ---------------------------------------------------------------- T10 (positive)
do $$ declare n int := -1; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  begin select count(*) into n from public.orders; exception when others then err := sqlstate; end;
  perform tests.reset();
  perform tests.rec('T10a', 'positive', 'legitimate admin can read all orders', n = (select count(*) from public.orders), 'visible=' || n || ' error=' || err);
end $$;

do $$ declare p numeric; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  begin update public.meals set price = 65 where name = 'Chicken Bowl'; exception when others then err := sqlstate; end;
  perform tests.reset();
  select price into p from public.meals where name = 'Chicken Bowl';
  perform tests.rec('T10b', 'positive', 'legitimate admin can update a menu price', p = 65, 'price=' || p || ' error=' || err);
  update public.meals set price = 60 where name = 'Chicken Bowl';   -- restore fixture
end $$;

do $$ declare ok boolean := false; err text := 'none'; begin
  if to_regclass('public.staff_roles') is null then
    perform tests.rec('T10c', 'positive', 'admin can grant a staff role through the trusted function', false, 'staff_roles absent (pre-migration)');
    return;
  end if;
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  begin execute $q$select public.assign_staff_role('00000000-0000-0000-0000-0000000000c2', 'cashier')$q$; exception when others then err := sqlstate; end;
  perform tests.reset();
  execute $q$select exists (select 1 from public.staff_roles where user_id = '00000000-0000-0000-0000-0000000000c2' and role = 'cashier' and is_active)$q$ into ok;
  perform tests.rec('T10c', 'positive', 'admin can grant a staff role through the trusted function', ok, 'error=' || err);
  execute $q$delete from public.staff_roles where user_id = '00000000-0000-0000-0000-0000000000c2'$q$;  -- restore
end $$;

do $$ declare own int := -1; other int := -1; items int := -1; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin
    select count(*) into own from public.orders where user_id = '00000000-0000-0000-0000-0000000000c1';
    select count(*) into other from public.orders where order_number = 'B-1';
    select count(*) into items from public.order_items;
  exception when others then err := sqlstate; end;
  perform tests.reset();
  perform tests.rec('T10d', 'positive', 'customer still reads own orders and items, not others''',
    own = 3 and other = 0 and items = 1, 'own=' || own || ' other=' || other || ' items=' || items || ' error=' || err);
end $$;

do $$ declare s text; lat numeric; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000d1');
  begin
    update public.drivers set status = 'online', current_latitude = 33.57, current_longitude = -7.59
     where id = '00000000-0000-0000-0000-0000000000d1';
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select status, current_latitude into s, lat from public.drivers where id = '00000000-0000-0000-0000-0000000000d1';
  perform tests.rec('T10e', 'positive', 'driver can still update own availability and location', s = 'online' and lat = 33.57, 'error=' || err);
  update public.drivers set status = 'offline', current_latitude = null, current_longitude = null
   where id = '00000000-0000-0000-0000-0000000000d1';   -- restore
end $$;

do $$ declare w numeric; err text := 'none'; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  begin update public.user_profiles set weight = 72, goal = 'lose_fat' where user_id = '00000000-0000-0000-0000-0000000000c1';
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select weight into w from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform tests.rec('T10f', 'positive', 'customer can still update own nutrition profile', w = 72, 'error=' || err);
end $$;

do $$ declare n int := -1; err text := 'none'; begin
  perform tests.act('anon');
  begin select count(*) into n from public.meals; exception when others then err := sqlstate; end;
  perform tests.reset();
  perform tests.rec('T10g', 'positive', 'menu remains publicly readable', n = 1, 'visible=' || n || ' error=' || err);
end $$;

do $$ declare ok boolean; err text := 'none'; begin
  perform tests.act('service_role');
  begin
    insert into public.orders (order_number, total, subtotal, status, payment_method, user_id)
    values ('SRV-1', 50, 35, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000000c2');
  exception when others then err := sqlstate; end;
  perform tests.reset();
  select exists (select 1 from public.orders where order_number = 'SRV-1') into ok;
  perform tests.rec('T10h', 'positive', 'trusted server (service_role) can still create orders', ok, 'error=' || err);
  delete from public.orders where order_number = 'SRV-1';   -- restore
end $$;

-- ---------------------------------------------------------------- T11
do $$ declare t numeric; s text; p text; owner_sees int := -1; admin_sees int := -1; begin
  select total, status, payment_method into t, s, p from public.orders where order_number = 'H-CARD';
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  select count(*) into owner_sees from public.orders where order_number = 'H-CARD';
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  select count(*) into admin_sees from public.orders where order_number = 'H-CARD';
  perform tests.reset();
  perform tests.rec('T11', 'history', 'historical card order intact and still readable',
    t = 200 and s = 'paid' and p = 'card' and owner_sees = 1 and admin_sees = 1,
    'total=' || t || ' status=' || s || ' method=' || p || ' owner=' || owner_sees || ' admin=' || admin_sees);
end $$;

-- ---------------------------------------------------------------- T12
do $$ declare sr_ok boolean := true; new_ok boolean; begin
  if to_regclass('public.staff_roles') is not null then
    sr_ok := not has_table_privilege('authenticated', 'public.staff_roles', 'INSERT')
         and not has_table_privilege('authenticated', 'public.staff_roles', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.staff_roles', 'DELETE')
         and not has_table_privilege('anon', 'public.staff_roles', 'SELECT');
  end if;
  create table public.tests_probe_table (id int);
  create function public.tests_probe_fn() returns int language sql as 'select 1';
  new_ok := not has_table_privilege('anon', 'public.tests_probe_table', 'INSERT')
        and not has_table_privilege('authenticated', 'public.tests_probe_table', 'DELETE')
        and not has_function_privilege('anon', 'public.tests_probe_fn()', 'EXECUTE');
  drop table public.tests_probe_table;
  drop function public.tests_probe_fn();
  perform tests.rec('T12', 'M2', 'new tables/functions do not auto-grant client access', sr_ok and new_ok,
    'staff_roles_locked=' || sr_ok || ' new_objects_locked=' || new_ok);
end $$;

-- ---------------------------------------------------------------- T13
do $$ declare others int := -1; meal_err text := 'none'; p numeric; is_staff boolean := false; begin
  perform tests.act('authenticated', '00000000-0000-0000-0000-0000000000e1');
  select count(*) into others from public.orders where user_id <> '00000000-0000-0000-0000-0000000000e1';
  begin update public.meals set price = 1 where name = 'Chicken Bowl'; exception when others then meal_err := sqlstate; end;
  if to_regprocedure('public.has_staff_role(text)') is not null then
    execute $q$select public.has_staff_role('admin')$q$ into is_staff;
  end if;
  perform tests.reset();
  select price into p from public.meals where name = 'Chicken Bowl';
  perform tests.rec('T13', 'C1', 'stale is_admin flag (illegitimate account) grants no access',
    others = 0 and p = 60 and not is_staff,
    'others_orders_visible=' || others || ' meal_price=' || p || ' has_staff_role=' || is_staff || ' error=' || meal_err);
  update public.meals set price = 60 where name = 'Chicken Bowl';   -- restore if changed
end $$;

-- ---------------------------------------------------------------- T14
do $$ declare ok boolean; detail text; begin
  ok := not has_table_privilege('anon', 'public.orders', 'INSERT')
    and not has_table_privilege('anon', 'public.orders', 'UPDATE')
    and not has_table_privilege('anon', 'public.daily_closings', 'SELECT')
    and not has_table_privilege('authenticated', 'public.daily_closings', 'SELECT')
    and not has_table_privilege('authenticated', 'public.order_status_updates', 'INSERT')
    and not has_table_privilege('anon', 'public.user_profiles', 'UPDATE')
    and (to_regprocedure('public.assign_staff_role(uuid,text,uuid)') is null
         or not has_function_privilege('anon', 'public.assign_staff_role(uuid,text,uuid)', 'EXECUTE'));
  detail := 'anon orders insert=' || has_table_privilege('anon', 'public.orders', 'INSERT')
         || ' auth daily_closings select=' || has_table_privilege('authenticated', 'public.daily_closings', 'SELECT');
  perform tests.rec('T14', 'grants', 'client grants removed where the schema granted them (defense in depth)',
    ok and to_regprocedure('public.assign_staff_role(uuid,text,uuid)') is not null, detail);
end $$;

select id, area, case when passed then 'PASS' else 'FAIL' end as result, expectation, detail
from tests.results order by id;
