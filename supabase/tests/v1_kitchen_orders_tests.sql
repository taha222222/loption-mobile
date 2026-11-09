-- =====================================================================
-- V1 kitchen order workflow tests (Milestone 3). DISPOSABLE DATABASE ONLY
-- (run_v1_kitchen_orders.sh). Runs after the full V1 chain including
-- 20261110120000_v1_order_lifecycle_hardening.sql. No migration of its own:
-- the kitchen board uses orders_kitchen_staff_read and order_kitchen_update.
--
-- The reads are the app's own queries: the column lists come from
-- src/services/kitchenApi.ts (the harness loads them into
-- ktests_k.app_columns), run as PostgREST would (SET ROLE authenticated +
-- JWT claims).
-- Users: ...0f01/0f02 customers; ...0f05 support; ...e0c1 cashier A;
-- ...e0b1, ...e0b3 kitchen staff A (e0b3 revoked during the test);
-- ...e0b2 kitchen staff B; ...00d1 driver A; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ktests_k;
create table if not exists ktests_k.app_columns (name text primary key, cols text not null);
create table if not exists ktests_k.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ktests_k.results;
do $$ begin
  if (select count(*) from ktests_k.app_columns) <> 2 then raise exception 'the harness must load the app column lists first'; end if;
end $$;

create or replace function ktests_k.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function ktests_k.k(p text) returns uuid language sql stable as $$
  select case p when 'A' then (select id from public.kitchens where code = 'A') else '00000000-0000-0000-0000-0000000000b2'::uuid end $$;
create or replace function ktests_k.cols(p text) returns text language sql stable as $$
  select cols from ktests_k.app_columns where name = p $$;
create or replace function ktests_k.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
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
create or replace function ktests_k.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into ktests_k.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;

-- The app's board query (fetchKitchenBoard): numbers of the visible orders, in the app's order.
create or replace function ktests_k.board_sql() returns text language sql stable as $$
  select format('select coalesce(string_agg(q.order_number, %L order by q.created_at), %L) from (select %s from public.orders
                  where workflow_version is not null and status = any (%L::text[]) order by created_at asc limit 100) q',
                ',', '', ktests_k.cols('order'), array['confirmed', 'preparing', 'ready']) $$;
-- The app's line query for one order.
create or replace function ktests_k.items_sql(p_order uuid) returns text language sql stable as $$
  select format('select coalesce(string_agg(i.meal_name || ''x'' || i.quantity || ''|'' || coalesce(i.notes, ''-'') || ''|'' || i.options::text, '';''), %L)
                   from (select %s from public.order_items where order_id = any (%L::uuid[])) i', '', ktests_k.cols('items'), array[p_order]) $$;

create or replace function ktests_k.new_order(p_number text, p_kitchen text default 'A', p_status text default 'confirmed',
                                              p_customer text default 'f01') returns uuid language plpgsql as $$
declare oid uuid := gen_random_uuid();
begin
  perform set_config('loption.order_service', 'on', true);
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method, user_id,
                             driver_id, subtotal, delivery_fee, platform_service_fee, total, delivery_address, delivery_phone, created_at,
                             confirmed_at, preparing_at, ready_at)
  values (oid, p_number, p_status, 1, ktests_k.k(p_kitchen), 'pending', 'cash', ktests_k.u(p_customer),
          case when p_status in ('picked_up', 'on_the_way', 'delivered') then ktests_k.u('d1') end, 65, 6, 3, 74,
          '12 Rue Test, Casablanca', '+212612345678', clock_timestamp(),
          case when p_status in ('confirmed', 'preparing', 'ready') then clock_timestamp() end,
          case when p_status in ('preparing', 'ready') then clock_timestamp() end,
          case when p_status = 'ready' then clock_timestamp() end);
  insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes, options)
  values (oid, (select id from public.meals order by id limit 1), 'Bol poulet', 2, 30, 'sans oignon',
          '[{"group": "Sauce", "name": "Harissa", "price": 0}]'::jsonb);
  insert into public.order_status_updates (order_id, status) values (oid, p_status);
  perform set_config('loption.order_service', 'off', true);
  return oid;
end $$;
create or replace function ktests_k.o(p text) returns uuid language sql stable as $$ select id from public.orders where order_number = p $$;
create or replace function ktests_k.audits(p_order uuid, p_action text default null) returns bigint language sql stable as $$
  select count(*) from public.security_audit_log where details ->> 'order_id' = p_order::text and (p_action is null or action = p_action) $$;
create or replace function ktests_k.step(p_who text, p_order uuid, p_status text) returns text language sql as $$
  select ktests_k.run('authenticated', ktests_k.u(p_who), format('select public.order_kitchen_update(%L, %L)', p_order, p_status)) $$;
grant usage on schema ktests_k to anon, authenticated, service_role;
grant execute on all functions in schema ktests_k to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
insert into public.staff_roles (user_id, role, kitchen_id) values
  (ktests_k.u('e0c1'), 'cashier', ktests_k.k('A')),
  (ktests_k.u('e0b1'), 'kitchen_staff', ktests_k.k('A')), (ktests_k.u('e0b3'), 'kitchen_staff', ktests_k.k('A')),
  (ktests_k.u('e0b2'), 'kitchen_staff', ktests_k.k('B')), (ktests_k.u('d1'), 'driver', ktests_k.k('A')),
  (ktests_k.u('f05'), 'support', null)
on conflict do nothing;
select ktests_k.new_order('KA-PEND', 'A', 'pending');
select ktests_k.new_order('KA-CONF', 'A', 'confirmed');
select ktests_k.new_order('KA-PREP', 'A', 'preparing');
select ktests_k.new_order('KA-READY', 'A', 'ready');
select ktests_k.new_order('KA-CANC', 'A', 'cancelled');
select ktests_k.new_order('KA-DELIV', 'A', 'delivered');
select ktests_k.new_order('KB-CONF', 'B', 'confirmed', 'f02');
insert into public.orders (order_number, total, subtotal, status, payment_method, user_id)
values ('HIST-K', 40, 40, 'new', 'cash', ktests_k.u('f01'));  -- historical: workflow statuses are refused by orders_workflow_shape

-- ---------------------------------------------------------------- reads
do $$ declare a text; b text; begin
  a := ktests_k.run('authenticated', ktests_k.u('e0b1'), ktests_k.board_sql());
  b := ktests_k.run('authenticated', ktests_k.u('e0b2'), ktests_k.board_sql());
  perform ktests_k.rec('KT01', 'board', 'kitchen A: the board holds the confirmed, preparing and ready workflow orders of kitchen A only (not pending, cancelled, delivered, kitchen B or historical)',
    a = 'KA-CONF,KA-PREP,KA-READY', a);
  perform ktests_k.rec('KT02', 'scope', 'kitchen B sees only kitchen B''s order', b = 'KB-CONF', b);
end $$;

do $$ declare c1 text; c2 text; drv text; sup text; an text; adm text; begin
  c1 := ktests_k.run('authenticated', ktests_k.u('f01'), ktests_k.board_sql());
  c2 := ktests_k.run('authenticated', ktests_k.u('f02'), ktests_k.board_sql());
  drv := ktests_k.run('authenticated', ktests_k.u('d1'), ktests_k.board_sql());
  sup := ktests_k.run('authenticated', ktests_k.u('f05'), ktests_k.board_sql());
  an := ktests_k.run('anon', null, ktests_k.board_sql());
  adm := ktests_k.run('authenticated', ktests_k.u('a1'), ktests_k.board_sql());
  perform ktests_k.rec('KT03', 'isolation', 'the board query gives a customer only their own orders, a driver without assignment / support / anon nothing',
    c1 = 'KA-CONF,KA-PREP,KA-READY' and c2 = 'KB-CONF' and drv = '' and sup = '' and (an = '' or an like 'err:42501%'),
    concat_ws(' | ', 'f01=' || c1, 'f02=' || c2, 'driver=' || drv, 'support=' || sup, 'anon=' || an));
  perform ktests_k.rec('KT04', 'isolation', 'an admin reads every kitchen''s board rows (read only: kitchen steps refused, KT14)',
    adm = 'KA-CONF,KA-PREP,KA-READY,KB-CONF', adm);
end $$;

do $$ declare own text; other text; begin
  own := ktests_k.run('authenticated', ktests_k.u('e0b1'), ktests_k.items_sql(ktests_k.o('KA-CONF')));
  other := ktests_k.run('authenticated', ktests_k.u('e0b1'), ktests_k.items_sql(ktests_k.o('KB-CONF')));
  perform ktests_k.rec('KT05', 'lines', 'kitchen A reads the lines of its orders with choices and notes (what to prepare), not those of kitchen B',
    own = 'Bol pouletx2|sans oignon|[{"name": "Harissa", "group": "Sauce", "price": 0}]' and other = '', 'own=' || own || ' other=' || other);
end $$;

-- ---------------------------------------------------------------- steps
do $$ declare o uuid := ktests_k.o('KA-CONF'); r1 text; r2 text; r3 text; r4 text; x record; begin
  r1 := ktests_k.step('e0b1', o, 'preparing');
  select * into x from public.orders where id = o;
  perform ktests_k.rec('KT10', 'step', 'kitchen A starts preparing: status preparing, server timestamp, one timeline row, one audit row with the cook as actor; payment untouched',
    r1 = 'changed' and x.status = 'preparing' and x.preparing_at is not null and x.payment_status = 'pending'
    and (select count(*) from public.order_status_updates where order_id = o and status = 'preparing') = 1
    and (select count(*) from public.security_audit_log where details ->> 'order_id' = o::text and action = 'kitchen_preparing' and actor_id = ktests_k.u('e0b1')) = 1,
    r1 || ' ' || x.status);
  r2 := ktests_k.step('e0b1', o, 'preparing');
  r3 := ktests_k.step('e0b3', o, 'preparing');
  perform ktests_k.rec('KT11', 'duplicate', 'starting again (double tap, another cook) returns unchanged and writes nothing',
    r2 = 'unchanged' and r3 = 'unchanged' and ktests_k.audits(o, 'kitchen_preparing') = 1
    and (select count(*) from public.order_status_updates where order_id = o and status = 'preparing') = 1, r2 || ',' || r3);
  r4 := ktests_k.step('e0b1', o, 'ready');
  select * into x from public.orders where id = o;
  perform ktests_k.rec('KT12', 'step', 'kitchen A marks it ready: status ready, server timestamp, timeline and audit row (order_ready); payment untouched',
    r4 = 'changed' and x.status = 'ready' and x.ready_at is not null and x.payment_status = 'pending'
    and ktests_k.audits(o, 'order_ready') = 1 and (select count(*) from public.order_status_updates where order_id = o and status = 'ready') = 1,
    r4 || ' ' || x.status);
  r1 := ktests_k.step('e0b1', o, 'preparing');
  perform ktests_k.rec('KT13', 'order', 'no step backwards: a ready order cannot go back to preparing', r1 like 'err:22023:%' and (select status from public.orders where id = o) = 'ready', r1);
end $$;

do $$ declare o uuid := ktests_k.new_order('KA-SKIP', 'A', 'confirmed'); p uuid := ktests_k.o('KA-PEND'); r1 text; r2 text; r3 text; begin
  r1 := ktests_k.step('e0b1', o, 'ready');
  r2 := ktests_k.step('e0b1', p, 'preparing');
  r3 := ktests_k.step('e0b1', o, 'picked_up');
  perform ktests_k.rec('KT15', 'order', 'no skipping: confirmed -> ready refused; a pending (not yet confirmed) order cannot be started; the kitchen cannot set a driver status',
    r1 like 'err:22023:%' and r2 like 'err:22023:%' and r3 like 'err:22023:%'
    and (select status from public.orders where id = o) = 'confirmed' and (select status from public.orders where id = p) = 'pending',
    concat_ws(' | ', r1, r2, r3));
end $$;

do $$ declare o uuid := ktests_k.new_order('KA-ROLE', 'A', 'confirmed'); r text := ''; begin
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('select public.order_confirm(%L)', ktests_k.o('KA-PEND'))) || ' | ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('select public.order_cancel(%L, %L)', o, 'Plus de poulet')) || ' | ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('select public.order_assign_driver(%L, %L)', o, ktests_k.u('d1'))) || ' | ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('select public.order_set_payment(%L, %L)', ktests_k.o('KA-DELIV'), 'paid')) || ' | ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('select public.order_driver_update(%L, %L)', ktests_k.o('KA-READY'), 'picked_up'));
  perform ktests_k.rec('KT14', 'roles', 'kitchen staff cannot confirm, cancel (even with a reason), assign a driver, record payment or pick up',
    r !~ '(^|\| )(changed|unchanged)' and (select status from public.orders where id = o) = 'confirmed'
    and (select payment_status from public.orders where id = ktests_k.o('KA-DELIV')) = 'pending'
    and (select status from public.orders where id = ktests_k.o('KA-READY')) = 'ready', r);
end $$;

do $$ declare o uuid := ktests_k.new_order('KA-OTHERS', 'A', 'confirmed'); r text := ''; begin
  r := r || ktests_k.step('e0b2', o, 'preparing') || ' | ';
  r := r || ktests_k.step('e0c1', o, 'preparing') || ' | ';
  r := r || ktests_k.step('a1', o, 'preparing') || ' | ';
  r := r || ktests_k.step('d1', o, 'preparing') || ' | ';
  r := r || ktests_k.step('f01', o, 'preparing') || ' | ';
  r := r || ktests_k.run('anon', null, format('select public.order_kitchen_update(%L, %L)', o, 'preparing'));
  perform ktests_k.rec('KT16', 'roles', 'only kitchen staff of the order''s kitchen: kitchen B, the cashier, an admin, a driver, the customer and anon are refused',
    r !~ '(^|\| )(changed|unchanged)' and (select status from public.orders where id = o) = 'confirmed' and ktests_k.audits(o) = 0, r);
end $$;

do $$ declare c uuid := ktests_k.o('KA-CANC'); r text; begin
  r := ktests_k.step('e0b1', c, 'preparing');
  perform ktests_k.rec('KT17', 'cancel', 'a cancelled order cannot be started by the kitchen', r like 'err:22023:%' and (select status from public.orders where id = c) = 'cancelled', r);
end $$;

-- ---------------------------------------------------------------- bypass
do $$ declare o uuid := ktests_k.new_order('KA-BYPASS', 'A', 'confirmed'); r text := ''; begin
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('update public.orders set status = %L where id = %L', 'preparing', o)) || ' ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('update public.orders set preparing_at = now() where id = %L', o)) || ' ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('insert into public.order_status_updates (order_id, status) values (%L, %L)', o, 'ready')) || ' ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('update public.order_items set notes = %L where order_id = %L', 'x', o)) || ' ';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0b1'), format('delete from public.orders where id = %L', o));
  perform ktests_k.rec('KT20', 'bypass', 'kitchen staff cannot write the order directly (status, timestamp), add a timeline row, edit a line or delete the order',
    r !~ 'ok:[1-9]' and (select status || '/' || (preparing_at is null) from public.orders where id = o) = 'confirmed/true'
    and (select count(*) from public.order_status_updates where order_id = o) = 1
    and (select notes from public.order_items where order_id = o) = 'sans oignon', r);
end $$;

-- ---------------------------------------------------------------- revoked
do $$ declare o uuid := ktests_k.new_order('KA-REVOKE', 'A', 'confirmed'); before text; rv text; b text; s text; begin
  before := ktests_k.run('authenticated', ktests_k.u('e0b3'), format('select count(*)::text from public.orders where id = %L', o));
  rv := ktests_k.run('authenticated', ktests_k.u('a1'), format('select public.revoke_staff_role(%L, %L, %L)', ktests_k.u('e0b3'), 'kitchen_staff', ktests_k.k('A')));
  b := ktests_k.run('authenticated', ktests_k.u('e0b3'), ktests_k.board_sql());
  s := ktests_k.step('e0b3', o, 'preparing');
  perform ktests_k.rec('KT30', 'roles', 'a revoked cook (same session) loses the board and the steps at once',
    before = '1' and rv not like 'err:%' and b = '' and s like 'err:42501%' and (select status from public.orders where id = o) = 'confirmed',
    'before=' || before || ' revoke=' || rv || ' board=' || b || ' step=' || s);
end $$;

-- ---------------------------------------------------------------- end to end with the other roles
do $$ declare o uuid := ktests_k.new_order('KA-FLOW', 'A', 'pending'); r text := ''; x record; begin
  r := r || ktests_k.run('authenticated', ktests_k.u('e0c1'), format('select public.order_confirm(%L)', o)) || ',';
  r := r || ktests_k.step('e0b1', o, 'preparing') || ',';
  r := r || ktests_k.step('e0b1', o, 'ready') || ',';
  r := r || ktests_k.run('authenticated', ktests_k.u('e0c1'), format('select public.order_assign_driver(%L, %L)', o, ktests_k.u('d1'))) || ',';
  r := r || ktests_k.run('authenticated', ktests_k.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'picked_up'));
  select * into x from public.orders where id = o;
  perform ktests_k.rec('KT40', 'lifecycle', 'cashier confirms -> kitchen prepares -> kitchen ready -> cashier assigns -> driver picks up; the order then leaves the kitchen board',
    r = 'changed,changed,changed,changed,changed' and x.status = 'picked_up' and x.payment_status = 'pending'
    and ktests_k.run('authenticated', ktests_k.u('e0b1'), ktests_k.board_sql()) not like '%KA-FLOW%', r);
end $$;

do $$ declare o uuid := ktests_k.new_order('KA-CANCEL-PREP', 'A', 'confirmed'); r1 text; r2 text; r3 text; begin
  r1 := ktests_k.step('e0b1', o, 'preparing');
  r2 := ktests_k.run('authenticated', ktests_k.u('e0c1'), format('select public.order_cancel(%L, %L)', o, 'Client injoignable'));
  r3 := ktests_k.step('e0b1', o, 'ready');
  perform ktests_k.rec('KT41', 'cancel', 'the cashier cancels an order in preparation (with a reason): the kitchen can no longer mark it ready and it leaves the board',
    r1 = 'changed' and r2 = 'changed' and r3 like 'err:22023:%' and (select status from public.orders where id = o) = 'cancelled'
    and ktests_k.run('authenticated', ktests_k.u('e0b1'), ktests_k.board_sql()) not like '%KA-CANCEL-PREP%', concat_ws(' | ', r1, r2, r3));
end $$;
