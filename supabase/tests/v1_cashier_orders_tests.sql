-- =====================================================================
-- V1 cashier order management tests (Milestone 2). DISPOSABLE DATABASE ONLY
-- (run_v1_cashier_orders.sh). Runs after the full V1 chain including
-- 20261110120000_v1_order_lifecycle_hardening.sql. No migration of its own:
-- the cashier screens use the existing policies and workflow functions.
--
-- The reads are the app's own queries: the column lists come from
-- src/services/cashierApi.ts (the harness loads them into ktests.app_columns),
-- run as PostgREST would (SET ROLE authenticated + JWT claims).
-- Users: ...0f01/0f02 customers; ...0f05 support; ...e0c1 cashier A;
-- ...e0c2 cashier B; ...e0c3 cashier A (revoked during the test);
-- ...e0b1 kitchen staff A; ...00d1 driver A; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ktests;
create table if not exists ktests.app_columns (name text primary key, cols text not null);
create table if not exists ktests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ktests.results;
do $$ begin
  if (select count(*) from ktests.app_columns) <> 4 then raise exception 'the harness must load the app column lists first'; end if;
end $$;

create or replace function ktests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function ktests.k(p text) returns uuid language sql stable as $$
  select case p when 'A' then (select id from public.kitchens where code = 'A') else '00000000-0000-0000-0000-0000000000b2'::uuid end $$;
create or replace function ktests.cols(p text) returns text language sql stable as $$
  select cols from ktests.app_columns where name = p $$;
create or replace function ktests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
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
create or replace function ktests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into ktests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;

-- The app's queue query (fetchCashierQueue): ids of the visible orders of a tab, in the app's order.
create or replace function ktests.queue_sql(p_statuses text[], p_ascending boolean default true) returns text language sql stable as $$
  select format('select coalesce(string_agg(q.id::text, %L order by q.created_at %s), %L) from (select %s from public.orders
                  where workflow_version is not null and status = any (%L::text[]) order by created_at %s limit 50) q',
                ',', case when p_ascending then 'asc' else 'desc' end, '', ktests.cols('queue'), p_statuses,
                case when p_ascending then 'asc' else 'desc' end) $$;
-- The app's detail reads (fetchCashierOrder): order row, lines, timeline.
create or replace function ktests.detail_sql(p_order uuid) returns text language sql stable as $$
  select format('select (select count(*) from (select %s from public.orders where id = %L and workflow_version is not null) o) || '':'' ||
                        (select count(*) from (select %s from public.order_items where order_id = %L) i) || '':'' ||
                        (select count(*) from (select %s from public.order_status_updates where order_id = %L) t)',
                ktests.cols('order'), p_order, ktests.cols('items'), p_order, ktests.cols('timeline'), p_order) $$;

-- A workflow order with one line, as create_order leaves it (fixture: no pricing data needed).
create or replace function ktests.new_order(p_customer text, p_kitchen text default 'A', p_status text default 'pending',
                                            p_driver text default null) returns uuid language plpgsql as $$
declare oid uuid := gen_random_uuid();
begin
  perform set_config('loption.order_service', 'on', true);
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method, user_id,
                             driver_id, subtotal, delivery_fee, platform_service_fee, total, delivery_address, delivery_phone, created_at)
  values (oid, 'LK-' || left(oid::text, 8), p_status, 1, ktests.k(p_kitchen), 'pending', 'cash', ktests.u(p_customer),
          case when p_driver is null then null else ktests.u(p_driver) end, 65, 6, 3, 74, '12 Rue Test, Casablanca', '+212612345678',
          clock_timestamp());
  insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes, options)
  values (oid, (select id from public.meals order by id limit 1), 'Bol poulet', 2, 30, 'sans oignon',
          '[{"group": "Sauce", "name": "Harissa", "price": 0}]'::jsonb);
  insert into public.order_status_updates (order_id, status) values (oid, p_status);
  perform set_config('loption.order_service', 'off', true);
  return oid;
end $$;
create or replace function ktests.audits(p_order uuid, p_action text default null) returns bigint language sql stable as $$
  select count(*) from public.security_audit_log where details ->> 'order_id' = p_order::text and (p_action is null or action = p_action) $$;
grant usage on schema ktests to anon, authenticated, service_role;
grant execute on all functions in schema ktests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
insert into public.staff_roles (user_id, role, kitchen_id) values
  (ktests.u('e0c1'), 'cashier', ktests.k('A')), (ktests.u('e0c2'), 'cashier', ktests.k('B')),
  (ktests.u('e0c3'), 'cashier', ktests.k('A')),
  (ktests.u('e0b1'), 'kitchen_staff', ktests.k('A')), (ktests.u('d1'), 'driver', ktests.k('A')),
  (ktests.u('f05'), 'support', null)
on conflict do nothing;

-- Orders: two pending in A (f01, f02), one pending in B, one confirmed in A,
-- one historical (pre-workflow) order of f01.
create table ktests.o (name text primary key, id uuid);
insert into ktests.o values
  ('a1', ktests.new_order('f01', 'A')), ('a2', ktests.new_order('f02', 'A')), ('b1', ktests.new_order('f01', 'B')),
  ('ac', ktests.new_order('f02', 'A', 'confirmed'));
with h as (insert into public.orders (order_number, total, subtotal, status, payment_method, user_id)
           values ('HIST-1', 40, 40, 'new', 'cash', ktests.u('f01')) returning id)
insert into ktests.o select 'hist', id from h;
create or replace function ktests.o(p text) returns uuid language sql stable as $$ select id from ktests.o where name = p $$;

-- ---------------------------------------------------------------- reads: the queue
do $$ declare r text; begin
  r := ktests.run('authenticated', ktests.u('e0c1'), ktests.queue_sql(array['pending']));
  perform ktests.rec('K01', 'queue', 'cashier A: the pending queue holds the pending workflow orders of kitchen A only, oldest first (not kitchen B, not historical, not confirmed)',
    r = ktests.o('a1') || ',' || ktests.o('a2'), r);
  r := ktests.run('authenticated', ktests.u('e0c1'), ktests.queue_sql(array['confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way']));
  perform ktests.rec('K02', 'queue', 'cashier A: the in-progress tab holds the confirmed order of kitchen A', r = ktests.o('ac')::text, r);
  r := ktests.run('authenticated', ktests.u('e0c2'), ktests.queue_sql(array['pending']));
  perform ktests.rec('K03', 'scope', 'cashier B sees only kitchen B''s pending order', r = ktests.o('b1')::text, r);
  r := ktests.run('authenticated', ktests.u('a1'), ktests.queue_sql(array['pending']));
  perform ktests.rec('K04', 'scope', 'an admin sees the pending workflow orders of every kitchen (acts as cashier)',
    r = (select string_agg(id::text, ',' order by created_at) from public.orders where workflow_version is not null and status = 'pending'), r);
end $$;

do $$ declare c1 text; c2 text; kst text; drv text; sup text; an text; begin
  c1 := ktests.run('authenticated', ktests.u('f01'), ktests.queue_sql(array['pending']));
  c2 := ktests.run('authenticated', ktests.u('f02'), ktests.queue_sql(array['pending']));
  perform ktests.rec('K05', 'isolation', 'a customer running the queue query gets only their own orders, never another customer''s',
    c1 = ktests.o('a1') || ',' || ktests.o('b1') and c2 = ktests.o('a2')::text, c1 || ' | ' || c2);
  kst := ktests.run('authenticated', ktests.u('e0b1'), ktests.queue_sql(array['pending']));
  drv := ktests.run('authenticated', ktests.u('d1'), ktests.queue_sql(array['pending']));
  sup := ktests.run('authenticated', ktests.u('f05'), ktests.queue_sql(array['pending']));
  an := ktests.run('anon', null, ktests.queue_sql(array['pending']));
  perform ktests.rec('K06', 'isolation', 'other roles: a driver (no assigned order), support and anon see no pending order; kitchen staff of A read them (open decision #31) but cannot act (K12)',
    drv = '' and sup = '' and (an = '' or an like 'err:42501%') and kst = ktests.o('a1') || ',' || ktests.o('a2'),
    'kitchen=' || kst || ' driver=' || drv || ' support=' || sup || ' anon=' || an);
end $$;

-- ---------------------------------------------------------------- reads: the order
do $$ declare own text; other text; b text; cust text; cust_other text; hist text; begin
  own := ktests.run('authenticated', ktests.u('e0c1'), ktests.detail_sql(ktests.o('a1')));
  b := ktests.run('authenticated', ktests.u('e0c2'), ktests.detail_sql(ktests.o('a1')));
  cust := ktests.run('authenticated', ktests.u('f01'), ktests.detail_sql(ktests.o('a1')));
  cust_other := ktests.run('authenticated', ktests.u('f02'), ktests.detail_sql(ktests.o('a1')));
  hist := ktests.run('authenticated', ktests.u('e0c1'), ktests.detail_sql(ktests.o('hist')));
  perform ktests.rec('K07', 'detail', 'cashier A reads the order, its lines and its history; cashier B, another customer and a historical order give nothing (the owner still sees their own order)',
    own = '1:1:1' and b = '0:0:0' and cust_other = '0:0:0' and cust = '1:1:1' and hist like '0:%',
    'cashierA=' || own || ' cashierB=' || b || ' owner=' || cust || ' otherCustomer=' || cust_other || ' historical=' || hist);
  other := ktests.run('authenticated', ktests.u('e0c1'),
    format('select (select %s from public.order_items where order_id = %L limit 1)::text', 'options::text || ''|'' || notes || ''|'' || quantity', ktests.o('a1')));
  perform ktests.rec('K08', 'detail', 'the lines carry the customer''s choices and note as stored at ordering (what the kitchen will prepare)',
    other = '[{"name": "Harissa", "group": "Sauce", "price": 0}]|sans oignon|2', other);
end $$;

-- ---------------------------------------------------------------- confirm
do $$ declare o uuid := ktests.o('a1'); r text; r2 text; x record; tl bigint; begin
  r := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_confirm(%L)', o));
  select * into x from public.orders where id = o;
  perform ktests.rec('K10', 'confirm', 'cashier A confirms: status confirmed, payment still pending (COD), server timestamp, one timeline row, one audit row with the cashier as actor, no payment record',
    r = 'changed' and x.status = 'confirmed' and x.payment_status = 'pending' and x.payment_method = 'cash' and x.confirmed_at is not null
    and (select count(*) from public.order_status_updates where order_id = o and status = 'confirmed') = 1
    and (select count(*) from public.security_audit_log where details ->> 'order_id' = o::text and action = 'order_confirmed' and actor_id = ktests.u('e0c1')) = 1
    and ktests.audits(o, 'payment_confirmed') = 0 and ktests.audits(o, 'payment_failed') = 0,
    r || ' ' || x.status || '/' || x.payment_status);
  tl := (select count(*) from public.order_status_updates where order_id = o);
  r2 := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_confirm(%L)', o));
  r := ktests.run('authenticated', ktests.u('a1'), format('select public.order_confirm(%L)', o));
  perform ktests.rec('K11', 'duplicate', 'a second confirmation (double tap, retry, a colleague or an admin) returns unchanged and writes nothing',
    r2 = 'unchanged' and r = 'unchanged' and (select count(*) from public.order_status_updates where order_id = o) = tl and ktests.audits(o, 'order_confirmed') = 1,
    r2 || ',' || r);
  r := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  perform ktests.rec('K13', 'payment', 'confirmed is not paid: payment cannot be recorded before delivery',
    r like 'err:22023:%' and (select payment_status from public.orders where id = o) = 'pending', r);
end $$;

do $$ declare o uuid := ktests.o('a2'); kst text; drv text; sup text; cust text; b text; begin
  kst := ktests.run('authenticated', ktests.u('e0b1'), format('select public.order_confirm(%L)', o));
  drv := ktests.run('authenticated', ktests.u('d1'), format('select public.order_confirm(%L)', o));
  sup := ktests.run('authenticated', ktests.u('f05'), format('select public.order_confirm(%L)', o));
  cust := ktests.run('authenticated', ktests.u('f02'), format('select public.order_confirm(%L)', o));
  b := ktests.run('authenticated', ktests.u('e0c2'), format('select public.order_confirm(%L)', o));
  perform ktests.rec('K12', 'roles', 'only the cashier of the kitchen or an admin confirms: kitchen staff, driver, support, the customer and cashier B are refused; the order stays pending',
    kst like 'err:42501%' and drv like 'err:42501%' and sup like 'err:42501%' and cust like 'err:42501%' and b like 'err:42501%'
    and (select status from public.orders where id = o) = 'pending' and ktests.audits(o) = 0,
    concat_ws(' | ', kst, drv, sup, cust, b));
end $$;

-- ---------------------------------------------------------------- cancel
do $$ declare o uuid := ktests.o('a2'); r1 text; r2 text; r3 text; r4 text; x record; begin
  r1 := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_cancel(%L, null)', o));
  r2 := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_cancel(%L, %L)', o, '  ab '));
  perform ktests.rec('K20', 'cancel', 'a cashier cannot cancel without a reason (null or under 3 characters); nothing changes',
    r1 like 'err:22023:%reason%' and r2 like 'err:22023:%reason%' and (select status from public.orders where id = o) = 'pending' and ktests.audits(o) = 0,
    r1 || ' | ' || r2);
  r3 := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_cancel(%L, %L)', o, 'Rupture de stock'));
  select * into x from public.orders where id = o;
  perform ktests.rec('K21', 'cancel', 'with a reason: cancelled; the reason is on the order, the customer timeline and the audit row (actor = cashier); payment untouched',
    r3 = 'changed' and x.status = 'cancelled' and x.cancel_reason = 'Rupture de stock' and x.cancelled_at is not null and x.payment_status = 'pending'
    and exists (select 1 from public.order_status_updates where order_id = o and status = 'cancelled' and message = 'Rupture de stock')
    and exists (select 1 from public.security_audit_log where details ->> 'order_id' = o::text and action = 'order_cancelled'
                and actor_id = ktests.u('e0c1') and details ->> 'reason' = 'Rupture de stock'),
    r3 || ' ' || x.status);
  r4 := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_confirm(%L)', o));
  perform ktests.rec('K22', 'cancel', 'a cancelled order cannot be confirmed afterwards', r4 like 'err:22023:%' and (select status from public.orders where id = o) = 'cancelled', r4);
end $$;

do $$ declare st text; o uuid; r text; bad text := ''; begin
  foreach st in array array['picked_up', 'on_the_way', 'delivered'] loop
    o := ktests.new_order('f01', 'A', st, 'd1');
    r := ktests.run('authenticated', ktests.u('e0c1'), format('select public.order_cancel(%L, %L)', o, 'Client injoignable'));
    if r not like 'err:22023:%' or (select status from public.orders where id = o) <> st then bad := bad || st || '=' || r || ' '; end if;
  end loop;
  perform ktests.rec('K23', 'cancel', 'nobody cancels after pickup: the cashier is refused at picked_up, on_the_way and delivered', bad = '', bad);
end $$;

-- ---------------------------------------------------------------- bypass
do $$ declare o uuid := ktests.new_order('f01'); r text := ''; begin
  r := r || ktests.run('authenticated', ktests.u('e0c1'), format('update public.orders set status = %L where id = %L', 'confirmed', o)) || ' ';
  r := r || ktests.run('authenticated', ktests.u('e0c1'), format('update public.orders set payment_status = %L where id = %L', 'paid', o)) || ' ';
  r := r || ktests.run('authenticated', ktests.u('e0c1'), format('update public.orders set total = 1 where id = %L', o)) || ' ';
  r := r || ktests.run('authenticated', ktests.u('e0c1'), format('insert into public.order_status_updates (order_id, status) values (%L, %L)', o, 'confirmed')) || ' ';
  r := r || ktests.run('authenticated', ktests.u('e0c1'), format('update public.order_items set notes = %L where order_id = %L', 'x', o)) || ' ';
  r := r || ktests.run('authenticated', ktests.u('e0c1'), format('delete from public.orders where id = %L', o));
  perform ktests.rec('K30', 'bypass', 'a cashier cannot write the order directly (status, payment, total), add a timeline row, edit a line or delete the order',
    r !~ 'ok:[1-9]' and (select status || '/' || payment_status || '/' || (total = 74) from public.orders where id = o) = 'pending/pending/true'
    and (select count(*) from public.order_status_updates where order_id = o) = 1
    and (select notes from public.order_items where order_id = o) = 'sans oignon', r);
end $$;

-- ---------------------------------------------------------------- revoked cashier
do $$ declare o uuid := ktests.new_order('f01'); before text; rv text; q text; c text; begin
  before := ktests.run('authenticated', ktests.u('e0c3'), format('select count(*)::text from public.orders where id = %L', o));
  rv := ktests.run('authenticated', ktests.u('a1'), format('select public.revoke_staff_role(%L, %L, %L)', ktests.u('e0c3'), 'cashier', ktests.k('A')));
  q := ktests.run('authenticated', ktests.u('e0c3'), ktests.queue_sql(array['pending']));
  c := ktests.run('authenticated', ktests.u('e0c3'), format('select public.order_confirm(%L)', o));
  perform ktests.rec('K40', 'roles', 'a revoked cashier (same session) loses the queue and the confirmation at once',
    before = '1' and rv not like 'err:%' and q = '' and c like 'err:42501%' and (select status from public.orders where id = o) = 'pending',
    'before=' || before || ' revoke=' || rv || ' queue=' || q || ' confirm=' || c);
end $$;

-- ---------------------------------------------------------------- realtime source
do $$ begin
  perform ktests.rec('K50', 'realtime', 'orders and order_status_updates are in the supabase_realtime publication (the queue''s live updates; RLS filters the rows)',
    (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('orders', 'order_status_updates')) = 2,
    (select string_agg(tablename, ',') from pg_publication_tables where pubname = 'supabase_realtime'));
end $$;
