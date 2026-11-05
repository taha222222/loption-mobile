-- =====================================================================
-- V1 create_order tests. DISPOSABLE DATABASE ONLY (run_v1_create_order.sh).
-- Runs after every V1 migration including 20261106120000_v1_create_order.sql.
-- Acts like PostgREST (SET ROLE + request.jwt.claims).
--
-- The pricing rows below are TEST FIXTURES (10 / 5 / 40 MAD), not approved
-- prices: no real fee exists until the owner approves pricing.
-- Users: ...0f04 (orders), ...0f03 customers without order history; ...e0c1 cashier A; ...e0c2 cashier B; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ctests;
create table if not exists ctests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ctests.results;

create or replace function ctests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function ctests.k(p text) returns uuid language sql stable as $$
  select case p when 'A' then (select id from public.kitchens where code = 'A') else '00000000-0000-0000-0000-0000000000b2'::uuid end $$;
create or replace function ctests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
declare v text; n int;
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
  begin
    if p_sql ~* '^\s*select' then execute p_sql into v; v := coalesce(v, '<null>');
    else execute p_sql; get diagnostics n = row_count; v := 'ok:' || n; end if;
  exception when others then v := 'err:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;
create or replace function ctests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into ctests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;
-- create_order call as text: (customer, request id, items json, kitchen)
create or replace function ctests.order_sql(p_req text, p_items text, p_kitchen uuid default null) returns text language sql stable as $$
  select format('select public.create_order(%L, %L::jsonb, %L)', coalesce(p_kitchen, ctests.k('A')), p_items, p_req) $$;
create or replace function ctests.orders_of(p uuid) returns bigint language sql stable as $$ select count(*) from public.orders where user_id = p $$;
grant usage on schema ctests to anon, authenticated, service_role;
grant execute on all functions in schema ctests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
insert into public.kitchens (code, name, is_active) values ('Z', 'Closed kitchen (test)', false) on conflict do nothing;
insert into public.staff_roles (user_id, role, kitchen_id) values
  (ctests.u('e0c1'), 'cashier', ctests.k('A')), (ctests.u('e0c2'), 'cashier', ctests.k('B'))
on conflict do nothing;
insert into public.meals (id, name, price, calories, protein, available) values
  ('00000000-0000-0000-0000-00000000aa03', 'Bol poulet', 35, 500, 30, true),
  ('00000000-0000-0000-0000-00000000aa04', 'Plat retiré', 40, 500, 30, false)
on conflict (id) do nothing;
update public.meals set available = true where id = '00000000-0000-0000-0000-00000000aa02';  -- 'Sans info', 50 MAD
update public.user_profiles set delivery_address = '12 Rue Test, Casablanca' where user_id = ctests.u('f04');
update public.user_profiles set delivery_address = null where user_id = ctests.u('f03');
update public.promotions set is_active = true where code = 'FIRST_ORDER_FREE_DELIVERY';

-- ---------------------------------------------------------------- closed until pricing is approved
do $$ declare r text; n0 bigint := (select count(*) from public.orders); a0 bigint := (select count(*) from public.security_audit_log); begin
  r := ctests.run('anon', null, ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ctests.rec('C01', 'security', 'anonymous callers cannot create orders', r like 'err:42501%', r);
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ctests.rec('C02', 'pricing', 'without approved pricing ordering is closed and nothing is written',
    r like 'err:55000:ordering is not open%' and (select count(*) from public.orders) = n0 and (select count(*) from public.security_audit_log) = a0, r);
end $$;

-- ---------------------------------------------------------------- pricing policies
insert into public.pricing_policies (kitchen_id, delivery_fee, service_fee, minimum_subtotal, tva_treatment, approved_by, approval_reference, approved_at)
values (ctests.k('A'), 10, 5, 40, 'included_in_menu_prices', 'Test fixture', 'TEST ONLY - not an approved price', now());
do $$ declare r text; r2 text; pid uuid := (select id from public.pricing_policies where active); begin
  perform ctests.rec('C03', 'pricing', 'an approved pricing row is audited',
    exists (select 1 from public.security_audit_log where action = 'pricing_policy_approved' and details ->> 'policy_id' = pid::text), null);
  r := ctests.run('authenticated', ctests.u('a1'), format($q$insert into public.pricing_policies (kitchen_id, delivery_fee, service_fee, minimum_subtotal, tva_treatment, approved_by, approval_reference, approved_at)
        values (%L, 0, 0, 0, 'included_in_menu_prices', 'x', 'xyz', now())$q$, ctests.k('B')));
  r2 := ctests.run('authenticated', ctests.u('a1'), 'update public.pricing_policies set delivery_fee = 0');
  perform ctests.rec('C04', 'pricing', 'no client (not even an admin) writes pricing; it comes from an approved owner action',
    r like 'err:42501%' and r2 like 'err:42501%', r || ' | ' || r2);
  r := ctests.run('authenticated', ctests.u('f04'), 'select count(*) from public.pricing_policies');
  r2 := ctests.run('anon', null, 'select count(*) from public.pricing_policies');
  perform ctests.rec('C05', 'pricing', 'customers read the active pricing (to show the fees); anonymous callers do not', r = '1' and r2 like 'err:42501%', r || ' | ' || r2);
  r := ctests.run('postgres', null, format('update public.pricing_policies set delivery_fee = 99 where id = %L', pid));
  r2 := ctests.run('postgres', null, format('delete from public.pricing_policies where id = %L', pid));
  perform ctests.rec('C06', 'pricing', 'a pricing row is never edited or deleted, even by the owner role (new row + deactivation)',
    r like 'err:42501:a pricing policy is never edited%' and r2 like 'err:42501:pricing policies are never deleted%', r || ' | ' || r2);
end $$;

-- ---------------------------------------------------------------- who and what may be ordered
do $$ declare r text; n0 bigint; bad text := ''; t text; begin
  r := ctests.run('authenticated', ctests.u('e0c1'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ctests.rec('C10', 'security', 'staff accounts cannot place customer orders', r like 'err:42501:staff accounts%', r);
  r := ctests.run('authenticated', ctests.u('f03'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ctests.rec('C11', 'address', 'a confirmed delivery address is required', r like 'err:22023:a confirmed delivery address%', r);
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]', ctests.k('B')));
  perform ctests.rec('C12', 'pricing', 'a kitchen without approved pricing does not take orders', r like 'err:55000%', r);
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]',
         (select id from public.kitchens where code = 'Z')));
  perform ctests.rec('C13', 'kitchen', 'an inactive kitchen is refused', r like 'err:22023:unknown or inactive kitchen%', r);
  n0 := ctests.orders_of(ctests.u('f04'));
  foreach t in array array[
    '[]', '{}', '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":0}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":21}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02"}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":2.5}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":"3"}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":99999999999}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1},{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]',
    '[{"meal_id":"00000000-0000-0000-0000-0000000000ff","quantity":1}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa04","quantity":2}]',
    '[{"meal_id":"not-a-uuid","quantity":1}]',
    '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1,"notes":{"x":1}}]'] loop
    r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, t));
    if r not like 'err:22023%' then bad := bad || t || ' => ' || r || ' ; '; end if;
  end loop;
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text,
         (select jsonb_agg(jsonb_build_object('meal_id', gen_random_uuid(), 'quantity', 1))::text from generate_series(1, 31))));
  if r not like 'err:22023:an order has 1 to 30 lines%' then bad := bad || '31 lines => ' || r; end if;
  perform ctests.rec('C14', 'validation', 'invalid lines are refused (empty, not a list, quantity 0/21/missing/decimal/text/huge, duplicate, unknown, inactive meal, bad id, bad note, 31 lines); nothing written',
    bad = '' and ctests.orders_of(ctests.u('f04')) = n0, nullif(bad, ''));
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa03","quantity":1}]'));
  perform ctests.rec('C15', 'pricing', 'an order below the approved minimum is refused', r like 'err:22023:the minimum order is 40%', r);
  r := ctests.run('authenticated', ctests.u('f04'), format('select public.create_order(%L, %L::jsonb, null)', ctests.k('A'), '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ctests.rec('C16', 'idempotency', 'a request id is required', r like 'err:22023:a request id is required%', r);
end $$;

-- ---------------------------------------------------------------- a real order
create table ctests.o (name text primary key, id uuid);
do $$ declare r text; r2 text; o record; req text := '11111111-1111-1111-1111-111111111111'; begin
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(req,
         '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":2,"price":1,"notes":"Sans oignon"},{"meal_id":"00000000-0000-0000-0000-00000000aa03","quantity":1}]'));
  insert into ctests.o values ('first', r::uuid);
  select * into o from public.orders where id = r::uuid;
  perform ctests.rec('C20', 'creation', 'the server creates a pending workflow order: cash, payment pending, kitchen, address copied, server order number',
    o.status = 'pending' and o.workflow_version = 1 and o.payment_status = 'pending' and o.payment_method = 'cash'
    and o.kitchen_id = ctests.k('A') and o.delivery_address = '12 Rue Test, Casablanca' and o.order_number like 'LO-______-_____'
    and o.user_id = ctests.u('f04'), r);
  perform ctests.rec('C21', 'pricing', 'prices come from the menu (a client price is ignored); fees from the approved row; total computed by the server',
    o.subtotal = 2 * 50 + 35 and o.platform_service_fee = 5
    and (select string_agg(meal_name || ':' || quantity || 'x' || price::int, ',' order by meal_name) from public.order_items where order_id = o.id)
        = 'Bol poulet:1x35,Sans info:2x50'
    and (select notes from public.order_items where order_id = o.id and meal_name = 'Sans info') = 'Sans oignon', o.subtotal::text);
  perform ctests.rec('C22', 'offer', 'the first order gets free delivery through the existing offer (discount recorded)',
    o.delivery_fee = 0 and o.delivery_discount = 10 and o.total = 135 + 0 + 5
    and exists (select 1 from public.promotion_redemptions where order_id = o.id and status = 'applied'), format('fee=%s discount=%s total=%s', o.delivery_fee, o.delivery_discount, o.total));
  perform ctests.rec('C23', 'audit', 'one timeline row (pending) and one order_created audit row',
    (select count(*) from public.order_status_updates where order_id = o.id) = 1
    and (select status from public.order_status_updates where order_id = o.id) = 'pending'
    and (select count(*) from public.security_audit_log where action = 'order_created' and details ->> 'order_id' = o.id::text) = 1, null);
  r2 := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(req, '[{"meal_id":"00000000-0000-0000-0000-00000000aa03","quantity":5}]'));
  perform ctests.rec('C24', 'idempotency', 'the same request id returns the same order; nothing is created or audited twice',
    r2 = r and ctests.orders_of(ctests.u('f04')) = 1
    and (select count(*) from public.order_items where order_id = o.id) = 2
    and (select count(*) from public.security_audit_log where action = 'order_created' and details ->> 'order_id' = o.id::text) = 1, r2);
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  insert into ctests.o values ('second', r::uuid);
  perform ctests.rec('C25', 'offer', 'the offer applies once per account: the second order pays the delivery fee',
    (select delivery_fee = 10 and coalesce(delivery_discount, 0) = 0 and total = 50 + 10 + 5 from public.orders where id = r::uuid), r);
end $$;

-- ---------------------------------------------------------------- visibility and the workflow afterwards
do $$ declare r text; r2 text; r3 text; r4 text; first uuid := (select id from ctests.o where name = 'first'); second uuid := (select id from ctests.o where name = 'second'); begin
  r := ctests.run('authenticated', ctests.u('f04'), format('select count(*) from public.order_items where order_id = %L', first));
  r2 := ctests.run('authenticated', ctests.u('f03'), format('select count(*) from public.orders where id = %L', first));
  r3 := ctests.run('authenticated', ctests.u('e0c1'), format('select count(*) from public.orders where id = %L', first));
  r4 := ctests.run('authenticated', ctests.u('e0c2'), format('select count(*) from public.orders where id = %L', first));
  perform ctests.rec('C30', 'scope', 'the customer sees the order and its lines; another customer and another kitchen do not; the kitchen''s cashier does',
    r = '2' and r2 = '0' and r3 = '1' and r4 = '0', r || '/' || r2 || '/' || r3 || '/' || r4);
  r := ctests.run('authenticated', ctests.u('e0c1'), format('select public.order_confirm(%L)', second));
  perform ctests.rec('C31', 'workflow', 'a created order follows the approved workflow (cashier confirms)', r = 'changed', r);
  r := ctests.run('authenticated', ctests.u('f04'), format('select public.order_cancel(%L, null)', first));
  perform ctests.rec('C32', 'offer', 'the customer cancels the pending first order: the free delivery is released for a later order',
    r = 'changed' and exists (select 1 from public.promotion_redemptions where order_id = first and status = 'released'), r);
  r := ctests.run('authenticated', ctests.u('f04'), format($q$update public.orders set total = 1 where id = %L$q$, second));
  r2 := ctests.run('authenticated', ctests.u('f04'), format($q$insert into public.order_items (order_id, meal_name, quantity, price) values (%L, 'x', 1, 0)$q$, second));
  perform ctests.rec('C33', 'security', 'the customer can neither change a created order nor add lines (only create_order writes them)',
    r = 'ok:0' and r2 like 'err:42501%', r || ' | ' || r2);
  update public.meals set price = 999 where id = '00000000-0000-0000-0000-00000000aa03';
  perform ctests.rec('C34', 'menu', 'a later menu price does not change created orders',
    (select price from public.order_items where order_id = first and meal_name = 'Bol poulet') = 35, null);
  update public.meals set price = 35 where id = '00000000-0000-0000-0000-00000000aa03';
end $$;

-- ---------------------------------------------------------------- deactivation closes ordering again
do $$ declare r text; begin
  update public.pricing_policies set active = false where active;
  r := ctests.run('authenticated', ctests.u('f04'), ctests.order_sql(gen_random_uuid()::text, '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ctests.rec('C40', 'pricing', 'deactivating the pricing (audited) closes ordering again',
    r like 'err:55000%' and exists (select 1 from public.security_audit_log where action = 'pricing_policy_deactivated'), r);
end $$;
