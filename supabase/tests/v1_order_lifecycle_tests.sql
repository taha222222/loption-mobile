-- =====================================================================
-- V1 order lifecycle tests (Milestone 1). DISPOSABLE DATABASE ONLY
-- (run_v1_order_lifecycle.sh). Runs after the full V1 chain including
-- 20261110120000_v1_order_lifecycle_hardening.sql.
-- Orders are created as the order service would (fixture), so the tests do
-- not depend on pricing data; the whole lifecycle then runs through the real
-- workflow functions, as PostgREST would call them (SET ROLE + JWT claims).
-- Users: ...0f01-0f04 customers; ...0f05 support; ...e0c1 cashier A;
-- ...e0c2 cashier B; ...e0b1 kitchen A; ...e0b2 kitchen B; ...00d1 driver A;
-- ...00d2 driver without kitchen; ...00d3 driver B; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ltests;
create table if not exists ltests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ltests.results;

create or replace function ltests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function ltests.k(p text) returns uuid language sql stable as $$
  select case p when 'A' then (select id from public.kitchens where code = 'A') else '00000000-0000-0000-0000-0000000000b2'::uuid end $$;
create or replace function ltests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
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
create or replace function ltests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into ltests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;
-- A workflow order in any status, as the order service would have left it.
create or replace function ltests.new_order(p_customer text, p_kitchen text default 'A', p_status text default 'pending',
                                            p_driver text default 'd1', p_payment text default 'pending') returns uuid language plpgsql as $$
declare oid uuid := gen_random_uuid();
begin
  perform set_config('loption.order_service', 'on', true);
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method, user_id,
                             driver_id, subtotal, delivery_fee, platform_service_fee, total, delivery_address)
  values (oid, 'LT-' || left(oid::text, 8), p_status, 1, ltests.k(p_kitchen), p_payment, 'cash', ltests.u(p_customer),
          case when p_driver is null then null else ltests.u(p_driver) end, 50, 16, 3, 69, '12 Rue Test, Casablanca');
  insert into public.order_status_updates (order_id, status) values (oid, p_status);
  perform set_config('loption.order_service', 'off', true);
  return oid;
end $$;
create or replace function ltests.audits(p_order uuid, p_action text default null) returns bigint language sql stable as $$
  select count(*) from public.security_audit_log where details ->> 'order_id' = p_order::text and (p_action is null or action = p_action) $$;
grant usage on schema ltests to anon, authenticated, service_role;
grant execute on all functions in schema ltests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
insert into public.staff_roles (user_id, role, kitchen_id) values
  (ltests.u('e0c1'), 'cashier', ltests.k('A')), (ltests.u('e0c2'), 'cashier', ltests.k('B')),
  (ltests.u('e0b1'), 'kitchen_staff', ltests.k('A')), (ltests.u('e0b2'), 'kitchen_staff', ltests.k('B')),
  (ltests.u('d1'), 'driver', ltests.k('A')), (ltests.u('d2'), 'driver', null), (ltests.u('d3'), 'driver', ltests.k('B')),
  (ltests.u('f05'), 'support', null)
on conflict do nothing;
update public.promotions set is_active = true where code = 'FIRST_ORDER_FREE_DELIVERY';

-- ---------------------------------------------------------------- valid path
do $$ declare o uuid := ltests.new_order('f01', 'A', 'pending', null); r text := ''; x record; begin
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_confirm(%L)', o)) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'preparing')) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'ready')) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_assign_driver(%L, %L)', o, ltests.u('d1'))) || ',';
  r := r || ltests.run('authenticated', ltests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'picked_up')) || ',';
  r := r || ltests.run('authenticated', ltests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'on_the_way')) || ',';
  r := r || ltests.run('authenticated', ltests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'delivered'));
  select * into x from public.orders where id = o;
  perform ltests.rec('L01', 'lifecycle', 'the confirmed path pending -> confirmed -> preparing -> ready -> picked_up -> on_the_way -> delivered, each step by its role',
    r = 'changed,changed,changed,changed,changed,changed,changed' and x.status = 'delivered', r);
  perform ltests.rec('L02', 'audit', 'every step: server timestamps, one timeline row, one audit row with the acting user (no client value)',
    x.confirmed_at is not null and x.preparing_at is not null and x.ready_at is not null and x.picked_up_at is not null
    and x.on_the_way_at is not null and x.delivered_at is not null
    and (select count(*) from public.order_status_updates where order_id = o) = 7
    and (select count(*) from public.security_audit_log where details ->> 'order_id' = o::text
          and action in ('order_confirmed', 'kitchen_preparing', 'order_ready', 'driver_assigned', 'order_picked_up', 'order_on_the_way', 'order_delivered')) = 7
    and exists (select 1 from public.security_audit_log where details ->> 'order_id' = o::text and action = 'order_confirmed' and actor_id = ltests.u('e0c1'))
    and exists (select 1 from public.security_audit_log where details ->> 'order_id' = o::text and action = 'order_delivered' and actor_id = ltests.u('d1')),
    (select string_agg(action || ':' || coalesce(actor_id::text, '-'), ' ') from public.security_audit_log where details ->> 'order_id' = o::text));
end $$;

-- ---------------------------------------------------------------- exhaustive matrix
-- Every status x every action a role can request, compared with order_transitions().
do $$
declare
  st text; a record; o uuid; r text; expected boolean; bad text := ''; n int := 0;
  statuses text[] := array['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivered', 'cancelled'];
begin
  foreach st in array statuses loop
    for a in select * from (values
        ('customer', 'cancelled', 'f01', 'select public.order_cancel(%L, null)'),
        ('cashier', 'confirmed', 'e0c1', 'select public.order_confirm(%L)'),
        ('cashier', 'cancelled', 'e0c1', 'select public.order_cancel(%L, ''Plat indisponible'')'),
        ('kitchen_staff', 'preparing', 'e0b1', 'select public.order_kitchen_update(%L, ''preparing'')'),
        ('kitchen_staff', 'ready', 'e0b1', 'select public.order_kitchen_update(%L, ''ready'')'),
        ('driver', 'picked_up', 'd1', 'select public.order_driver_update(%L, ''picked_up'')'),
        ('driver', 'on_the_way', 'd1', 'select public.order_driver_update(%L, ''on_the_way'')'),
        ('driver', 'delivered', 'd1', 'select public.order_driver_update(%L, ''delivered'')')) v(actor, target, who, sql) loop
      o := ltests.new_order('f01', 'A', st, 'd1');
      r := ltests.run('authenticated', ltests.u(a.who), format(a.sql, o));
      expected := st = a.target or exists (select 1 from public.order_transitions() t where t.from_status = st and t.to_status = a.target and t.actor = a.actor);
      n := n + 1;
      if expected <> (r in ('changed', 'unchanged')) or (st = a.target and r <> 'unchanged')
         or (not expected and (select status from public.orders where id = o) <> st) then
        bad := bad || format('%s -[%s]-> %s: %s; ', st, a.actor, a.target, r);
      end if;
    end loop;
  end loop;
  perform ltests.rec('L03', 'lifecycle', 'all 64 status x action combinations behave exactly as order_transitions(): allowed ones change, repeats are unchanged, every other one is refused and changes nothing',
    bad = '' and n = 64, coalesce(nullif(bad, ''), n || ' combinations'));
end $$;

-- ---------------------------------------------------------------- cancellation
do $$ declare o uuid; o2 uuid; r text; r2 text; r3 text; begin
  o := ltests.new_order('f01', 'A', 'pending', null);
  r := ltests.run('authenticated', ltests.u('f01'), format('select public.order_cancel(%L, null)', o));
  o2 := ltests.new_order('f01', 'A', 'confirmed', null);
  r2 := ltests.run('authenticated', ltests.u('f01'), format('select public.order_cancel(%L, null)', o2));
  perform ltests.rec('L10', 'cancel', 'the customer cancels while pending (audited), not once confirmed',
    r = 'changed' and (select status from public.orders where id = o) = 'cancelled' and ltests.audits(o, 'order_cancelled') = 1
    and r2 like 'err:22023:invalid order transition confirmed -> cancelled%', r || ' | ' || r2);
  o := ltests.new_order('f01', 'A', 'preparing', null);
  r := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_cancel(%L, null)', o));
  r2 := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_cancel(%L, %L)', o, ' ab '));
  r3 := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_cancel(%L, %L)', o, 'Rupture de poulet'));
  perform ltests.rec('L11', 'cancel', 'staff cancel only with a reason (>= 3 characters); the reason is on the order, the timeline and the audit row with the actor',
    r like 'err:22023:a cancellation reason is required%' and r2 like 'err:22023:a cancellation reason is required%' and r3 = 'changed'
    and (select cancel_reason from public.orders where id = o) = 'Rupture de poulet'
    and exists (select 1 from public.order_status_updates where order_id = o and status = 'cancelled' and message = 'Rupture de poulet')
    and exists (select 1 from public.security_audit_log where details ->> 'order_id' = o::text and action = 'order_cancelled'
                and details ->> 'reason' = 'Rupture de poulet' and actor_id = ltests.u('e0c1')), r || ' | ' || r2 || ' | ' || r3);
  o := ltests.new_order('f01', 'A', 'ready', 'd1');
  r := ltests.run('authenticated', ltests.u('a1'), format('select public.order_cancel(%L, %L)', o, 'Client injoignable'));
  perform ltests.rec('L12', 'cancel', 'an admin may cancel until ready, with a reason', r = 'changed', r);
  o := ltests.new_order('f01', 'A', 'picked_up', 'd1');
  r := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_cancel(%L, %L)', o, 'Trop tard'));
  r2 := ltests.run('authenticated', ltests.u('a1'), format('select public.order_cancel(%L, %L)', o, 'Trop tard'));
  r3 := ltests.run('authenticated', ltests.u('f01'), format('select public.order_cancel(%L, null)', o));
  perform ltests.rec('L13', 'cancel', 'nobody cancels after pickup (cashier, admin, customer)',
    r like 'err:22023:invalid order transition picked_up -> cancelled%' and r2 like 'err:22023:invalid order transition%'
    and r3 like 'err:%' and (select status from public.orders where id = o) = 'picked_up', r || ' | ' || r2 || ' | ' || r3);
end $$;

-- ---------------------------------------------------------------- customers and staff scope
do $$ declare o uuid := ltests.new_order('f01', 'A', 'pending', null); r text; r2 text; r3 text; r4 text; begin
  r := ltests.run('authenticated', ltests.u('f02'), format('select public.order_cancel(%L, null)', o));
  r2 := ltests.run('authenticated', ltests.u('f02'), format('select count(*) from public.orders where id = %L', o));
  r3 := ltests.run('authenticated', ltests.u('f02'), format('update public.orders set status = %L where id = %L', 'cancelled', o));
  r4 := ltests.run('authenticated', ltests.u('f02'), format('select count(*) from public.order_status_updates where order_id = %L', o));
  perform ltests.rec('L20', 'scope', 'another customer can neither cancel, read, update nor see the timeline of an order (and learns nothing about it)',
    r like 'err:42501:order not found or not allowed%' and r2 = '0' and r3 = 'ok:0' and r4 = '0'
    and (select status from public.orders where id = o) = 'pending', r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
  r := ltests.run('authenticated', ltests.u('e0c2'), format('select public.order_confirm(%L)', o));
  r2 := ltests.run('authenticated', ltests.u('e0b1'), format('select public.order_confirm(%L)', o));
  r3 := ltests.run('authenticated', ltests.u('f05'), format('select public.order_confirm(%L)', o));
  r4 := ltests.run('authenticated', ltests.u('d1'), format('select public.order_confirm(%L)', o));
  perform ltests.rec('L21', 'scope', 'only the cashier of the kitchen (or an admin) confirms: cashier of kitchen B, kitchen staff, support and drivers are refused',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 like 'err:42501%' and r4 like 'err:42501%'
    and (select status from public.orders where id = o) = 'pending', r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
end $$;

do $$ declare o uuid := ltests.new_order('f01', 'A', 'confirmed', null); r text; r2 text; r3 text; r4 text; begin
  r := ltests.run('authenticated', ltests.u('e0b2'), format('select public.order_kitchen_update(%L, %L)', o, 'preparing'));
  r2 := ltests.run('authenticated', ltests.u('a1'), format('select public.order_kitchen_update(%L, %L)', o, 'preparing'));
  r3 := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_kitchen_update(%L, %L)', o, 'preparing'));
  r4 := ltests.run('authenticated', ltests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'delivered'));
  perform ltests.rec('L22', 'scope', 'kitchen steps only by kitchen staff of that kitchen: kitchen B, admin, cashier refused; the kitchen cannot set a driver status',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 like 'err:42501%' and r4 like 'err:22023:the kitchen can only set preparing or ready%'
    and (select status from public.orders where id = o) = 'confirmed', r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
end $$;

do $$ declare o uuid := ltests.new_order('f01', 'A', 'ready', 'd1'); r text; r2 text; r3 text; r4 text; r5 text; r6 text; begin
  r := ltests.run('authenticated', ltests.u('d2'), format('select public.order_driver_update(%L, %L)', o, 'picked_up'));
  r2 := ltests.run('authenticated', ltests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'delivered'));
  r3 := ltests.run('authenticated', ltests.u('d1'), format('select public.order_kitchen_update(%L, %L)', o, 'ready'));
  r4 := ltests.run('authenticated', ltests.u('d1'), format('select public.order_cancel(%L, %L)', o, 'Je ne peux pas'));
  r5 := ltests.run('authenticated', ltests.u('d1'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  r6 := ltests.run('authenticated', ltests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'cancelled'));
  perform ltests.rec('L23', 'scope', 'drivers: an unassigned driver is refused; the assigned driver cannot skip steps, act as kitchen, cancel, record payment or set another status',
    r like 'err:42501%' and r2 like 'err:22023:invalid order transition ready -> delivered%' and r3 like 'err:42501%'
    and r4 like 'err:42501%' and r5 like 'err:42501%' and r6 like 'err:22023:a driver can only set%'
    and (select status from public.orders where id = o) = 'ready', concat_ws(' | ', r, r2, r3, r4, r5, r6));
end $$;

-- ---------------------------------------------------------------- direct writes
do $$ declare o uuid := ltests.new_order('f01', 'A', 'confirmed', 'd1'); bad text := ''; x record; r text; begin
  for x in select * from (values ('authenticated', 'f01'), ('authenticated', 'e0c1'), ('authenticated', 'e0b1'), ('authenticated', 'd1'),
                                 ('authenticated', 'a1'), ('service_role', null)) v(rl, who) loop
    r := ltests.run(x.rl, case when x.who is null then null else ltests.u(x.who) end,
                    format('update public.orders set status = %L, confirmed_at = now() - interval ''1 day'', payment_status = %L where id = %L', 'delivered', 'paid', o));
    if r not in ('ok:0') and r not like 'err:42501%' then bad := bad || x.who || '=' || r || '; '; end if;
    r := ltests.run(x.rl, case when x.who is null then null else ltests.u(x.who) end,
                    format('insert into public.order_status_updates (order_id, status) values (%L, %L)', o, 'delivered'));
    if r not like 'err:42501%' then bad := bad || x.who || ' timeline=' || r || '; '; end if;
  end loop;
  perform ltests.rec('L30', 'bypass', 'no role (customer, cashier, kitchen, driver, admin, service_role) writes status, timestamps or payment directly, or adds a timeline row',
    bad = '' and (select status = 'confirmed' and payment_status = 'pending' from public.orders where id = o)
    and (select count(*) from public.order_status_updates where order_id = o) = 1, nullif(bad, ''));
end $$;

do $$ declare o uuid := ltests.new_order('f01', 'A', 'pending', null); r text; r2 text; r3 text; r4 text; r5 text; r6 text; begin
  r := ltests.run('authenticated', ltests.u('a1'), format('delete from public.orders where id = %L', o));
  r2 := ltests.run('service_role', null, format('delete from public.orders where id = %L', o));
  r3 := ltests.run('service_role', null, format('update public.order_status_updates set status = %L where order_id = %L', 'delivered', o));
  r4 := ltests.run('service_role', null, format('delete from public.order_status_updates where order_id = %L', o));
  r5 := ltests.run('authenticated', ltests.u('a1'), format('update public.orders set user_id = null where id = %L', o));
  r6 := ltests.run('postgres', null, format('update public.order_status_updates set message = %L where order_id = %L', 'x', o));
  perform ltests.rec('L31', 'bypass', 'hardening: a workflow order is never deleted (admin, service_role); its timeline is never rewritten or deleted (even by the owner role); an admin cannot detach the customer',
    r like 'err:42501:a workflow order is never deleted%' and r2 like 'err:42501:a workflow order is never deleted%'
    and r3 like 'err:42501:the timeline of a workflow order is never changed%' and r4 like 'err:42501:the timeline of a workflow order is never changed%'
    and r5 like 'err:42501:only account deletion detaches%' and r6 like 'err:42501%'
    and exists (select 1 from public.orders where id = o and user_id = ltests.u('f01'))
    and (select count(*) from public.order_status_updates where order_id = o and status = 'pending') = 1, concat_ws(' | ', r, r2, r3, r4, r5, r6));
  r := ltests.run('postgres', null, format('update public.orders set user_id = null where id = %L', o));
  perform ltests.rec('L32', 'bypass', 'account deletion (runs as postgres) still detaches the customer; nothing else changes',
    r = 'ok:1' and (select user_id is null and status = 'pending' from public.orders where id = o), r);
end $$;

-- ---------------------------------------------------------------- repeats and payment
do $$ declare o uuid := ltests.new_order('f01', 'A', 'pending', null); r text; r2 text; begin
  r := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_confirm(%L)', o));
  r2 := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_confirm(%L)', o));
  perform ltests.rec('L40', 'idempotency', 'a repeated request (double tap, retry) returns unchanged and writes nothing more',
    r = 'changed' and r2 = 'unchanged' and ltests.audits(o, 'order_confirmed') = 1
    and (select count(*) from public.order_status_updates where order_id = o and status = 'confirmed') = 1, r || ' | ' || r2);
end $$;

do $$ declare o uuid; r text := ''; r2 text; r3 text; begin
  o := ltests.new_order('f01', 'A', 'on_the_way', 'd1');
  r2 := ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  perform ltests.run('authenticated', ltests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'delivered'));
  perform ltests.rec('L41', 'payment', 'delivering does not mean paid: payment stays pending and cannot be recorded before delivery',
    (select status = 'delivered' and payment_status = 'pending' from public.orders where id = o)
    and r2 like 'err:22023:invalid payment change pending -> paid for an order that is on_the_way%', r2);
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'failed')) || ',';
  r := r || (select payment_status from public.orders where id = o) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'refunded')) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'paid')) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'failed')) || ',';
  r := r || ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'refunded'));
  perform ltests.rec('L42', 'payment', 'failed is not paid; failed -> paid is the correction; no refund from failed; paid cannot go back to failed; refund only after paid',
    r ~ '^changed,failed,err:22023:invalid payment change failed -> refunded[^,]*,changed,err:22023:invalid payment change paid -> failed[^,]*,changed$'
    and (select payment_status from public.orders where id = o) = 'refunded', r);
  perform ltests.rec('L43', 'payment', 'payment history is kept in the audit log (failed, confirmed, refunded, with actor and from/to); the customer timeline holds status changes only',
    (select string_agg(action || ':' || (details ->> 'from') || '>' || (details ->> 'to'), ',' order by id)
       from public.security_audit_log where details ->> 'order_id' = o::text and action like 'payment_%')
      = 'payment_failed:pending>failed,payment_confirmed:failed>paid,payment_refunded:paid>refunded'
    and not exists (select 1 from public.security_audit_log where details ->> 'order_id' = o::text and action like 'payment_%' and actor_id is distinct from ltests.u('e0c1'))
    and not exists (select 1 from public.order_status_updates where order_id = o and status in ('paid', 'failed', 'refunded')),
    (select string_agg(action, ',') from public.security_audit_log where details ->> 'order_id' = o::text));
  o := ltests.new_order('f01', 'A', 'delivered', 'd1');
  r := ltests.run('authenticated', ltests.u('e0c2'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  r2 := ltests.run('authenticated', ltests.u('e0b1'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  r3 := ltests.run('authenticated', ltests.u('f01'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  perform ltests.rec('L44', 'payment', 'payment is recorded only by the cashier of the kitchen or an admin (other cashier, kitchen staff, customer refused)',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 like 'err:42501%'
    and (select payment_status from public.orders where id = o) = 'pending', r || ' | ' || r2 || ' | ' || r3);
end $$;

-- ---------------------------------------------------------------- first-order eligibility (existing rule, #48 pinned)
do $$ declare o uuid; s0 text; s1 text; s2 text; s3 text; begin
  s0 := public.first_order_offer_status_for(ltests.u('f03'));
  o := ltests.new_order('f03', 'A', 'pending', null);
  s1 := public.first_order_offer_status_for(ltests.u('f03'));
  perform ltests.run('authenticated', ltests.u('f03'), format('select public.order_cancel(%L, null)', o));
  s2 := public.first_order_offer_status_for(ltests.u('f03'));
  o := ltests.new_order('f03', 'A', 'delivered', 'd1');
  perform ltests.run('authenticated', ltests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'failed'));
  s3 := public.first_order_offer_status_for(ltests.u('f03'));
  perform ltests.rec('L50', 'first-order', 'existing rule unchanged: a pending order uses the benefit, a cancelled one releases it',
    s0 = 'eligible' and s1 = 'not_eligible' and s2 = 'eligible', concat_ws(',', s0, s1, s2));
  perform ltests.rec('L51', 'first-order', '#48 pinned (open decision): a delivered order whose cash payment failed still uses the benefit (current rule; changes only with an owner decision)',
    s3 = 'not_eligible', s3);
end $$;
