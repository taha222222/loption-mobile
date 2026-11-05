-- =====================================================================
-- V1 order workflow tests. DISPOSABLE DATABASE ONLY
-- (run_v1_order_workflow.sh). Runs after every V1 migration including
-- 20261105120000_v1_order_workflow.sql. Acts like PostgREST
-- (SET ROLE + request.jwt.claims).
--
-- Fixture users (auth.users rows created by the runner as supabase_admin):
--   ...00c1, ...00c2  customers          ...00a1  admin (initial admin)
--   ...e0c1  cashier, kitchen A          ...e0c2  cashier, kitchen B
--   ...e0b1  kitchen staff, kitchen A    ...e0b2  kitchen staff, kitchen B
--   ...00d1  driver, kitchen A           ...00d2  driver, no kitchen (all)
--   ...00d3  driver, kitchen B
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists otests;
create table if not exists otests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate otests.results;

create or replace function otests.act(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;
create or replace function otests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Runs p_sql as p_role/p_sub; returns the scalar result or 'err:<state>:<message>'.
create or replace function otests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
declare v text; n int;
begin
  perform otests.act(p_role, p_sub);
  begin
    if p_sql ~* '^\s*select' then
      execute p_sql into v;
      v := coalesce(v, '<null>');
    else
      execute p_sql;
      get diagnostics n = row_count;
      v := 'ok:' || n;
    end if;
  exception when others then
    v := 'err:' || sqlstate || ':' || sqlerrm;
  end;
  perform otests.reset();
  return v;
end $$;
create or replace function otests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into otests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
grant usage on schema otests to anon, authenticated, service_role;
grant execute on all functions in schema otests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
create or replace function otests.k(p text) returns uuid language sql stable as $$
  select case p when 'A' then (select id from public.kitchens where code = 'A') else '00000000-0000-0000-0000-0000000000b2'::uuid end
$$;
create or replace function otests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid
$$;

insert into public.staff_roles (user_id, role, kitchen_id) values
  (otests.u('e0c1'), 'cashier', otests.k('A')),
  (otests.u('e0c2'), 'cashier', otests.k('B')),
  (otests.u('e0b1'), 'kitchen_staff', otests.k('A')),
  (otests.u('e0b2'), 'kitchen_staff', otests.k('B')),
  (otests.u('d1'), 'driver', otests.k('A')),
  (otests.u('d2'), 'driver', null),
  (otests.u('d3'), 'driver', otests.k('B'));

-- A workflow order as the (future) trusted order service would create it.
create or replace function otests.new_order(p_customer uuid, p_kitchen text, p_number text) returns uuid language plpgsql as $$
declare oid uuid := gen_random_uuid();
begin
  perform set_config('loption.order_service', 'on', true);
  insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id,
                             workflow_version, kitchen_id, payment_status, delivery_address)
  values (oid, p_number, 60, 60, 0, 'pending', 'cash', p_customer, 1, otests.k(p_kitchen), 'pending', 'Rue test 1');
  insert into public.order_items (order_id, meal_id, meal_name, quantity, price)
  values (oid, '00000000-0000-0000-0000-00000000aa02', 'Sans info', 1, 60);
  perform set_config('loption.order_service', 'off', true);
  return oid;
end $$;

create table otests.o (name text primary key, id uuid);
insert into otests.o values
  ('main',   otests.new_order(otests.u('c1'), 'A', 'W-1')),
  ('other',  otests.new_order(otests.u('c2'), 'A', 'W-2')),
  ('kb',     otests.new_order(otests.u('c2'), 'B', 'W-3')),
  ('cancel', otests.new_order(otests.u('c1'), 'A', 'W-4')),
  ('staffcancel', otests.new_order(otests.u('c1'), 'A', 'W-5')),
  ('race',   otests.new_order(otests.u('c1'), 'A', 'W-6'));
create or replace function otests.id(p text) returns uuid language sql stable as $$ select id from otests.o where name = p $$;
create or replace function otests.status(p text) returns text language sql stable as $$ select status from public.orders where id = otests.id(p) $$;
create or replace function otests.audit(p text, p_action text) returns bigint language sql stable as $$
  select count(*) from public.security_audit_log where action = p_action and details ->> 'order_id' = otests.id(p)::text $$;
grant usage on schema otests to anon, authenticated, service_role;
grant execute on all functions in schema otests to anon, authenticated, service_role;

-- ------------------------------------------------- direct writes refused
do $$ declare r text; legacy uuid; begin
  r := otests.run('authenticated', otests.u('c1'), format($q$update public.orders set status = 'delivered' where id = %L$q$, otests.id('main')));
  perform otests.rec('O01', 'security', 'a customer cannot change an order status directly (RLS: no row)',
    r = 'ok:0' and otests.status('main') = 'pending', r);
  r := otests.run('authenticated', otests.u('a1'), format($q$update public.orders set status = 'confirmed' where id = %L$q$, otests.id('main')));
  perform otests.rec('O02', 'security', 'even an admin cannot change a workflow order directly (guard)',
    r like 'err:42501:a workflow order changes only through%' and otests.status('main') = 'pending', r);
  r := otests.run('authenticated', otests.u('a1'), format($q$update public.orders set payment_status = 'paid', total = 1 where id = %L$q$, otests.id('main')));
  perform otests.rec('O03', 'security', 'payment status and amounts of a workflow order cannot be written directly',
    r like 'err:42501%', r);
  r := otests.run('service_role', null, format($q$update public.orders set status = 'delivered' where id = %L$q$, otests.id('main')));
  perform otests.rec('O04', 'security', 'service_role cannot bypass the state machine either', r like 'err:42501%', r);
  r := otests.run('authenticated', otests.u('a1'), $q$insert into public.orders (order_number, total, status, workflow_version, kitchen_id, payment_status)
       values ('X-1', 1, 'delivered', 1, (select id from public.kitchens where code = 'A'), 'paid')$q$);
  perform otests.rec('O05', 'security', 'nobody inserts a workflow order directly (only the order service)', r like 'err:42501:workflow orders are created%', r);
  select id into legacy from public.orders where workflow_version is null order by order_number limit 1;
  r := otests.run('authenticated', otests.u('a1'), format($q$update public.orders set status = 'served' where id = %L$q$, legacy));
  perform otests.rec('O06', 'security', 'historical orders are frozen: status cannot change', r like 'err:42501:historical orders are frozen%', r);
  r := otests.run('authenticated', otests.u('a1'), format($q$update public.orders set delivery_address = 'Adresse corrigée' where id = %L$q$, legacy));
  perform otests.rec('O07', 'compat', 'an admin can still correct non-state fields of a historical order', r = 'ok:1', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_apply_transition(%L, 'confirmed', 'cashier')$q$, otests.id('main')));
  perform otests.rec('O08', 'security', 'the internal transition function is not callable by clients', r like 'err:42501%', r);
end $$;

-- ------------------------------------------------- confirm (cashier)
do $$ declare r text; r2 text; begin
  r := otests.run('authenticated', otests.u('e0c2'), format('select public.order_confirm(%L)', otests.id('main')));
  perform otests.rec('O10', 'scope', 'a cashier of another kitchen cannot confirm (and learns nothing)', r = 'err:42501:order not found or not allowed', r);
  r := otests.run('authenticated', otests.u('e0b1'), format('select public.order_confirm(%L)', otests.id('main')));
  perform otests.rec('O11', 'roles', 'kitchen staff cannot confirm an order', r like 'err:42501%', r);
  r := otests.run('authenticated', otests.u('c1'), format('select public.order_confirm(%L)', otests.id('main')));
  perform otests.rec('O12', 'roles', 'the customer cannot confirm their own order', r like 'err:42501%', r);
  r := otests.run('authenticated', otests.u('e0c1'), format('select public.order_confirm(%L)', otests.id('main')));
  r2 := otests.run('authenticated', otests.u('e0c1'), format('select public.order_confirm(%L)', otests.id('main')));
  perform otests.rec('O13', 'transitions', 'the cashier confirms pending -> confirmed; payment stays pending (cash on delivery)',
    r = 'changed' and otests.status('main') = 'confirmed'
    and (select payment_status = 'pending' and confirmed_at is not null from public.orders where id = otests.id('main')), r);
  perform otests.rec('O14', 'idempotency', 'repeating the confirmation changes nothing (one history row, one audit row)',
    r2 = 'unchanged' and otests.audit('main', 'order_confirmed') = 1
    and (select count(*) from public.order_status_updates where order_id = otests.id('main') and status = 'confirmed') = 1, r2);
end $$;

-- ------------------------------------------------- kitchen
do $$ declare r text; r2 text; r3 text; begin
  r := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_kitchen_update(%L, 'preparing')$q$, otests.id('other')));
  perform otests.rec('O20', 'transitions', 'pending -> preparing is invalid (the cashier must confirm first)', r like 'err:22023:invalid order transition pending -> preparing%', r);
  r := otests.run('authenticated', otests.u('e0b2'), format($q$select public.order_kitchen_update(%L, 'preparing')$q$, otests.id('main')));
  perform otests.rec('O21', 'scope', 'kitchen staff of another kitchen cannot touch the order', r = 'err:42501:order not found or not allowed', r);
  r := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_kitchen_update(%L, 'picked_up')$q$, otests.id('main')));
  perform otests.rec('O22', 'roles', 'the kitchen can only set preparing or ready', r like 'err:22023:the kitchen can only%', r);
  r := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_kitchen_update(%L, 'ready')$q$, otests.id('main')));
  perform otests.rec('O23', 'transitions', 'confirmed -> ready is invalid (preparing first)', r like 'err:22023:invalid order transition confirmed -> ready%', r);
  r := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_kitchen_update(%L, 'preparing')$q$, otests.id('main')));
  r2 := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_kitchen_update(%L, 'ready')$q$, otests.id('main')));
  perform otests.rec('O24', 'transitions', 'the kitchen moves confirmed -> preparing -> ready, audited',
    r = 'changed' and r2 = 'changed' and otests.status('main') = 'ready'
    and otests.audit('main', 'kitchen_preparing') = 1 and otests.audit('main', 'order_ready') = 1, r || ' ' || r2);
  r3 := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('main')));
  perform otests.rec('O25', 'roles', 'the kitchen cannot touch payments', r3 like 'err:42501%', r3);
  r3 := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('d1')));
  perform otests.rec('O26', 'roles', 'the kitchen cannot assign drivers', r3 like 'err:42501%', r3);
end $$;

-- ------------------------------------------------- driver assignment
do $$ declare r text; begin
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('other'), otests.u('d1')));
  perform otests.rec('O30', 'transitions', 'a driver cannot be assigned to a pending order', r like 'err:22023:a driver can be assigned only%', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('c2')));
  perform otests.rec('O31', 'roles', 'only an active driver can be assigned', r like 'err:22023:this person is not an active driver%', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('d3')));
  perform otests.rec('O32', 'scope', 'a driver of another kitchen cannot be assigned', r like 'err:22023:this person is not an active driver%', r);
  r := otests.run('authenticated', otests.u('c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('d1')));
  perform otests.rec('O33', 'roles', 'a customer cannot assign a driver', r like 'err:42501%', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('d2')));
  perform otests.rec('O34', 'transitions', 'the cashier assigns a driver (a driver without kitchen serves every kitchen), audited',
    r = 'changed' and (select driver_id from public.orders where id = otests.id('main')) = otests.u('d2') and otests.audit('main', 'driver_assigned') = 1, r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('d1')));
  perform otests.rec('O35', 'transitions', 'reassignment before pickup is allowed and audited', r = 'changed' and otests.audit('main', 'driver_reassigned') = 1, r);
  r := otests.run('authenticated', otests.u('d2'), format($q$select public.order_driver_update(%L, 'picked_up')$q$, otests.id('main')));
  perform otests.rec('O36', 'scope', 'the previous driver can no longer act on the order', r = 'err:42501:order not found or not allowed', r);
  r := otests.run('authenticated', otests.u('d2'), format('select count(*) from public.orders where id = %L', otests.id('main')));
  perform otests.rec('O37', 'scope', 'a driver does not see orders not assigned to them', r = '0', r);
  r := otests.run('authenticated', otests.u('d1'), 'select count(*) from public.orders');
  perform otests.rec('O38', 'scope', 'the assigned driver sees exactly their assigned orders (incl. a historical one)',
    r = (select count(*)::text from public.orders where driver_id = otests.u('d1')), r);
end $$;

-- ------------------------------------------------- driver and location
do $$ declare r text; r2 text; r3 text; t timestamptz := now(); begin
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.driver_report_location(%L, 33.5, -7.6, 5, now())$q$, otests.id('main')));
  perform otests.rec('O40', 'location', 'no location sharing before pickup', r like 'err:22023:location is shared only%', r);
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.order_driver_update(%L, 'on_the_way')$q$, otests.id('main')));
  perform otests.rec('O41', 'transitions', 'ready -> on_the_way is invalid (pickup first)', r like 'err:22023:invalid order transition ready -> on_the_way%', r);
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.order_driver_update(%L, 'picked_up')$q$, otests.id('main')));
  r2 := otests.run('authenticated', otests.u('d1'), format($q$select public.order_driver_update(%L, 'on_the_way')$q$, otests.id('main')));
  perform otests.rec('O42', 'transitions', 'the assigned driver moves ready -> picked_up -> on_the_way',
    r = 'changed' and r2 = 'changed' and otests.status('main') = 'on_the_way'
    and (select picked_up_at is not null and on_the_way_at is not null from public.orders where id = otests.id('main')), r || ' ' || r2);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_assign_driver(%L, %L)$q$, otests.id('main'), otests.u('d2')));
  perform otests.rec('O43', 'transitions', 'no reassignment after pickup', r like 'err:22023:a driver can be assigned only%', r);
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.driver_report_location(%L, 33.51, -7.61, 6.5, %L)$q$, otests.id('main'), t));
  r2 := otests.run('authenticated', otests.u('d1'), format($q$select public.driver_report_location(%L, 33.51, -7.61, 6.5, %L)$q$, otests.id('main'), t));
  perform otests.rec('O44', 'location', 'the driver shares the position on the way; a repeated point is stored once',
    r = 'true' and r2 = 'false' and (select count(*) from public.driver_location_points where order_id = otests.id('main')) = 1, r || ' ' || r2);
  r := otests.run('authenticated', otests.u('c1'), format('select driver_latitude::text from public.orders where id = %L', otests.id('main')));
  perform otests.rec('O45', 'location', 'the customer sees the driver position on their own active delivery', r = '33.51', r);
  r := otests.run('authenticated', otests.u('c2'), format('select count(*) from public.orders where id = %L', otests.id('main')));
  perform otests.rec('O46', 'scope', 'another customer cannot see the order or the position', r = '0', r);
  r := otests.run('authenticated', otests.u('d2'), format($q$select public.driver_report_location(%L, 33.5, -7.6, 5, now())$q$, otests.id('main')));
  r2 := otests.run('authenticated', otests.u('d1'), format($q$select public.driver_report_location(%L, 91, -7.6, 5, now())$q$, otests.id('main')));
  r3 := otests.run('authenticated', otests.u('d1'), format($q$select public.driver_report_location(%L, 33.5, -7.6, 5, now() - interval '1 hour')$q$, otests.id('main')));
  perform otests.rec('O47', 'location', 'refused: another driver, an impossible coordinate, a stale timestamp',
    r like 'err:42501%' and r2 like 'err:22023:invalid position%' and r3 like 'err:22023:position time%', r || ' | ' || r2 || ' | ' || r3);
  r := otests.run('authenticated', otests.u('c1'), 'select count(*) from public.driver_location_points');
  r2 := otests.run('authenticated', otests.u('d1'), 'select count(*) from public.driver_location_points');
  r3 := otests.run('authenticated', otests.u('a1'), 'select count(*) from public.driver_location_points');
  perform otests.rec('O48', 'location', 'the location history is readable by admins only', r = '0' and r2 = '0' and r3 = '1', r || '/' || r2 || '/' || r3);
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.order_driver_update(%L, 'delivered')$q$, otests.id('main')));
  perform otests.rec('O49', 'transitions', 'on_the_way -> delivered by the driver; the live position is cleared, the history kept',
    r = 'changed' and otests.status('main') = 'delivered' and otests.audit('main', 'order_delivered') = 1
    and (select driver_latitude is null and delivered_at is not null from public.orders where id = otests.id('main'))
    and (select count(*) from public.driver_location_points where order_id = otests.id('main')) = 1, r);
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.driver_report_location(%L, 33.5, -7.6, 5, now())$q$, otests.id('main')));
  r2 := otests.run('authenticated', otests.u('d1'), format($q$select public.order_driver_update(%L, 'on_the_way')$q$, otests.id('main')));
  perform otests.rec('O50', 'transitions', 'after delivery: no location, no going back (delivered -> on_the_way invalid)',
    r like 'err:22023:location is shared only%' and r2 like 'err:22023:invalid order transition delivered -> on_the_way%', r || ' | ' || r2);
  r := otests.run('postgres', null, 'delete from public.driver_location_points');
  perform otests.rec('O51', 'audit', 'the location history is append-only, even for the database owner', r like 'err:42501:driver_location_points is append-only%', r);
end $$;

-- ------------------------------------------------- payment (cash on delivery)
do $$ declare r text; r2 text; begin
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('other')));
  perform otests.rec('O60', 'payment', 'payment cannot be recorded before delivery', r like 'err:22023:invalid payment change pending -> paid for an order that is pending%', r);
  r := otests.run('authenticated', otests.u('c1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('main')));
  perform otests.rec('O61', 'payment', 'the customer cannot change the payment status', r like 'err:42501%', r);
  r := otests.run('authenticated', otests.u('d1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('main')));
  perform otests.rec('O62', 'payment', 'the driver cannot change the payment status', r like 'err:42501%', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('main')));
  r2 := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('main')));
  perform otests.rec('O63', 'payment', 'the cashier records the cash of a delivered order once (repeat is a no-op), audited',
    r = 'changed' and r2 = 'unchanged' and otests.audit('main', 'payment_confirmed') = 1
    and (select payment_status from public.orders where id = otests.id('main')) = 'paid', r || ' ' || r2);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_set_payment(%L, 'refunded')$q$, otests.id('main')));
  r2 := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_set_payment(%L, 'paid')$q$, otests.id('main')));
  perform otests.rec('O64', 'payment', 'paid -> refunded is allowed and audited; refunded -> paid is not',
    r = 'changed' and otests.audit('main', 'payment_refunded') = 1 and r2 like 'err:22023:invalid payment change refunded -> paid%', r || ' | ' || r2);
end $$;

-- ------------------------------------------------- cancellation
do $$ declare r text; r2 text; begin
  r := otests.run('authenticated', otests.u('c2'), format($q$select public.order_cancel(%L, null)$q$, otests.id('cancel')));
  perform otests.rec('O70', 'cancel', 'a customer cannot cancel someone else''s order', r = 'err:42501:order not found or not allowed', r);
  r := otests.run('authenticated', otests.u('c1'), format($q$select public.order_cancel(%L, null)$q$, otests.id('cancel')));
  perform otests.rec('O71', 'cancel', 'the customer cancels their own pending order, audited',
    r = 'changed' and otests.status('cancel') = 'cancelled' and otests.audit('cancel', 'order_cancelled') = 1, r);
  r := otests.run('authenticated', otests.u('e0c1'), format('select public.order_confirm(%L)', otests.id('staffcancel')));
  r2 := otests.run('authenticated', otests.u('c1'), format($q$select public.order_cancel(%L, null)$q$, otests.id('staffcancel')));
  perform otests.rec('O72', 'cancel', 'the customer cannot cancel once the order is confirmed', r = 'changed' and r2 like 'err:22023:invalid order transition confirmed -> cancelled%', r2);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_cancel(%L, '  ')$q$, otests.id('staffcancel')));
  perform otests.rec('O73', 'cancel', 'a staff cancellation needs a reason', r like 'err:22023:a cancellation reason is required%', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_cancel(%L, 'Rupture de stock')$q$, otests.id('staffcancel')));
  perform otests.rec('O74', 'cancel', 'the cashier cancels a confirmed order with a reason (shown in the history)',
    r = 'changed' and (select cancel_reason from public.orders where id = otests.id('staffcancel')) = 'Rupture de stock'
    and (select message from public.order_status_updates where order_id = otests.id('staffcancel') and status = 'cancelled') = 'Rupture de stock', r);
  r := otests.run('authenticated', otests.u('e0c1'), format($q$select public.order_cancel(%L, 'Trop tard')$q$, otests.id('main')));
  perform otests.rec('O75', 'cancel', 'nobody cancels after pickup or delivery', r like 'err:22023:invalid order transition delivered -> cancelled%', r);
  r := otests.run('authenticated', otests.u('e0b1'), format($q$select public.order_kitchen_update(%L, 'preparing')$q$, otests.id('cancel')));
  perform otests.rec('O76', 'transitions', 'a cancelled order cannot move again', r like 'err:22023:invalid order transition cancelled -> preparing%', r);
end $$;

-- ------------------------------------------------- visibility
do $$ declare r text; r2 text; r3 text; begin
  r := otests.run('authenticated', otests.u('e0b1'), 'select count(*) from public.orders');
  r2 := otests.run('authenticated', otests.u('e0b1'), format('select count(*) from public.orders where id = %L', otests.id('kb')));
  perform otests.rec('O80', 'scope', 'kitchen staff see the workflow orders of their kitchen only (no historical, no other kitchen)',
    r = (select count(*)::text from public.orders where workflow_version is not null and kitchen_id = otests.k('A')) and r2 = '0', r || '/' || r2);
  r := otests.run('authenticated', otests.u('e0c2'), 'select count(*) from public.orders');
  perform otests.rec('O81', 'scope', 'a cashier sees the workflow orders of their kitchen only', r = '1', r);
  r := otests.run('authenticated', otests.u('e0b1'), format('select count(*) from public.order_items where order_id = %L', otests.id('other')));
  r2 := otests.run('authenticated', otests.u('e0b2'), format('select count(*) from public.order_items where order_id = %L', otests.id('other')));
  perform otests.rec('O82', 'scope', 'order lines are visible exactly to who sees the order', r = '1' and r2 = '0', r || '/' || r2);
  r := otests.run('authenticated', otests.u('c1'), format('select count(*) from public.order_status_updates where order_id = %L', otests.id('main')));
  r2 := otests.run('authenticated', otests.u('c2'), format('select count(*) from public.order_status_updates where order_id = %L', otests.id('main')));
  r3 := otests.run('authenticated', otests.u('c1'), 'select count(*) from public.security_audit_log');
  perform otests.rec('O83', 'scope', 'the customer reads their status history (not another customer); the audit log stays admin-only',
    r = '6' and r2 = '0' and r3 = '0', r || '/' || r2 || '/' || r3);
  r := otests.run('anon', null, 'select count(*) from public.orders');
  perform otests.rec('O84', 'scope', 'anonymous callers see no order', r like 'err:42501%' or r = '0', r);
end $$;

-- ------------------------------------------------- price snapshot, roles, audit, deletion
do $$ declare r text; r2 text; begin
  r := otests.run('authenticated', otests.u('a1'), format('update public.order_items set price = 1 where order_id = %L', otests.id('other')));
  r2 := otests.run('authenticated', otests.u('a1'), format($q$insert into public.order_items (order_id, meal_name, quantity, price) values (%L, 'Ajout', 1, 1)$q$, otests.id('other')));
  perform otests.rec('O90', 'menu', 'order lines keep their price snapshot; nothing is added to a workflow order directly',
    r like 'err:42501:order lines keep their price snapshot%' and r2 like 'err:42501:lines of a workflow order%', r || ' | ' || r2);
  update public.meals set price = 999 where id = '00000000-0000-0000-0000-00000000aa02';
  perform otests.rec('O91', 'menu', 'a menu price change does not change past orders',
    (select price from public.order_items where order_id = otests.id('other')) = 60, null);
  r := otests.run('postgres', null, $q$insert into public.staff_roles (user_id, role, kitchen_id) values ('00000000-0000-0000-0000-0000000000d1', 'cashier', (select id from public.kitchens where code = 'A'))$q$);
  perform otests.rec('O92', 'roles', 'one active staff role per user (a second active role is refused)', r like 'err:23505%', r);
  r := otests.run('postgres', null, 'update public.security_audit_log set action = action');
  perform otests.rec('O93', 'audit', 'the audit log is immutable', r like 'err:42501%', r);
  perform otests.rec('O94', 'audit', 'every workflow step of the main order is audited with its actor role',
    (select count(*) from public.security_audit_log where details ->> 'order_id' = otests.id('main')::text) = 10
    and not exists (select 1 from public.security_audit_log where details ->> 'order_id' = otests.id('main')::text and actor_id is null), null);
  perform otests.rec('O95', 'state machine', 'order_transitions() is exactly the reviewed list (11 rows)',
    (select count(*) from public.order_transitions()) = 11
    and (select string_agg(from_status || '>' || to_status || ':' || actor, ',' order by from_status, to_status, actor) from public.order_transitions())
      = 'confirmed>cancelled:cashier,confirmed>preparing:kitchen_staff,on_the_way>delivered:driver,pending>cancelled:cashier,pending>cancelled:customer,pending>confirmed:cashier,picked_up>on_the_way:driver,preparing>cancelled:cashier,preparing>ready:kitchen_staff,ready>cancelled:cashier,ready>picked_up:driver', null);
end $$;

-- ------------------------------------------------- account deletion keeps working
do $$ declare r text; begin
  r := otests.run('authenticated', otests.u('c1'), $q$select public.delete_my_account('SUPPRIMER')$q$);
  perform otests.rec('O96', 'compat', 'a customer with workflow orders can still delete the account: orders kept, detached, state unchanged',
    r = '' and (select user_id is null and status = 'delivered' from public.orders where id = otests.id('main'))
    and otests.status('cancel') = 'cancelled', r);
end $$;

-- ------------------------------------------------- a revoked role stops working at once
do $$ declare r text; r2 text; begin
  r := otests.run('authenticated', otests.u('a1'), format($q$select public.revoke_staff_role(%L, 'cashier', %L)$q$, otests.u('e0c2'), otests.k('B')));
  r2 := otests.run('authenticated', otests.u('e0c2'), format('select public.order_confirm(%L)', otests.id('kb')));
  perform otests.rec('O97', 'roles', 'a revoked cashier is refused on the same session/JWT (authority read from staff_roles every call)',
    r not like 'err:%' and r2 = 'err:42501:order not found or not allowed' and otests.status('kb') = 'pending', r || ' | ' || r2);
end $$;
