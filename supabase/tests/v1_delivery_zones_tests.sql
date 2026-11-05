-- =====================================================================
-- V1 delivery zones tests. DISPOSABLE DATABASE ONLY (run_v1_delivery_zones.sh).
-- Runs after every V1 migration including 20261107120000_v1_delivery_zones.sql.
-- The pricing row is a TEST FIXTURE (10 / 5 / 40 MAD), not an approved price.
-- Users: ...0f04 and ...0f03 customers; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ztests;
create table if not exists ztests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ztests.results;
create or replace function ztests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function ztests.ka() returns uuid language sql stable as $$ select id from public.kitchens where code = 'A' $$;
create or replace function ztests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
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
create or replace function ztests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into ztests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;
create or replace function ztests.order_sql(p_kitchen uuid default null) returns text language sql stable as $$
  select format('select public.create_order(%L, %L::jsonb, %L)', coalesce(p_kitchen, ztests.ka()),
                '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]', gen_random_uuid()) $$;
grant usage on schema ztests to anon, authenticated, service_role;
grant execute on all functions in schema ztests to anon, authenticated, service_role;

-- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
update public.meals set available = true where id = '00000000-0000-0000-0000-00000000aa02';  -- 50 MAD
insert into public.pricing_policies (kitchen_id, delivery_fee, service_fee, minimum_subtotal, tva_treatment, approved_by, approval_reference, approved_at)
select k.id, 10, 5, 40, 'included_in_menu_prices', 'Test fixture', 'TEST ONLY - not an approved price', now()
  from public.kitchens k where k.code in ('A', 'B');
update public.user_profiles set delivery_address = '12 Rue Test', delivery_city = null where user_id in (ztests.u('f04'), ztests.u('f03'));

do $$ declare r text; r2 text; begin
  perform ztests.rec('Z01', 'zones', 'launch zone: Casablanca only, served by Kitchen A, seeded and audited',
    (select count(*) from public.delivery_zones) = 1
    and exists (select 1 from public.delivery_zones where city_key = 'casablanca' and city_name = 'Casablanca' and active and kitchen_id = ztests.ka())
    and exists (select 1 from public.security_audit_log where action = 'delivery_zone_insert' and details ->> 'city_key' = 'casablanca'), null);
  r := ztests.run('authenticated', ztests.u('f04'), 'select string_agg(city_key, '','') from public.delivery_zones');
  r2 := ztests.run('anon', null, 'select count(*) from public.delivery_zones');
  perform ztests.rec('Z02', 'zones', 'signed-in customers read the served cities; anonymous callers do not', r = 'casablanca' and r2 like 'err:42501%', r || ' | ' || r2);
  r := ztests.run('authenticated', ztests.u('a1'), format($q$insert into public.delivery_zones (city_key, city_name, kitchen_id) values ('rabat', 'Rabat', %L)$q$, ztests.ka()));
  r2 := ztests.run('postgres', null, 'delete from public.delivery_zones');
  perform ztests.rec('Z03', 'zones', 'no client (not even an admin) adds a city; zones are never deleted (deactivated instead)',
    r like 'err:42501%' and r2 like 'err:42501:delivery zones are never deleted%', r || ' | ' || r2);
end $$;

do $$ declare r text; r2 text; r3 text; n0 bigint := (select count(*) from public.orders); begin
  r := ztests.run('authenticated', ztests.u('f04'), $q$update public.user_profiles set delivery_city = 'rabat' where user_id = '00000000-0000-0000-0000-000000000f04'$q$);
  r2 := ztests.run('authenticated', ztests.u('f04'), $q$update public.user_profiles set delivery_city = 'rabat' where user_id = '00000000-0000-0000-0000-000000000f03'$q$);
  r3 := ztests.run('authenticated', ztests.u('f04'), $q$update public.user_profiles set delivery_city = 'Casa Blanca!' where user_id = '00000000-0000-0000-0000-000000000f04'$q$);
  perform ztests.rec('Z10', 'city', 'a customer saves their own city (any city key); not another customer''s; an invalid key is refused',
    r = 'ok:1' and r2 = 'ok:0' and r3 like 'err:23514%', r || ' | ' || r2 || ' | ' || r3);
  r := ztests.run('authenticated', ztests.u('f04'), ztests.order_sql());
  perform ztests.rec('Z11', 'zone', 'outside Casablanca: "delivery is not available in your city yet"; nothing written',
    r like 'err:22023:delivery is not available in your city yet%' and (select count(*) from public.orders) = n0, r);
  r := ztests.run('authenticated', ztests.u('f03'), ztests.order_sql());
  perform ztests.rec('Z12', 'zone', 'without a city the customer is asked to choose it; nothing written',
    r like 'err:22023:choose your delivery city%' and (select count(*) from public.orders) = n0, r);
end $$;

do $$ declare r text; r2 text; begin
  update public.user_profiles set delivery_city = 'casablanca' where user_id = ztests.u('f04');
  r := ztests.run('authenticated', ztests.u('f04'), ztests.order_sql());
  perform ztests.rec('Z20', 'zone', 'in Casablanca the order is created (Kitchen A), the city is in the audit row',
    r ~ '^[0-9a-f-]{36}$' and (select kitchen_id from public.orders where id = r::uuid) = ztests.ka()
    and exists (select 1 from public.security_audit_log where action = 'order_created' and details ->> 'order_id' = r and details ->> 'city' = 'casablanca'), r);
  r := ztests.run('authenticated', ztests.u('f04'), ztests.order_sql('00000000-0000-0000-0000-0000000000b2'));
  perform ztests.rec('Z21', 'zone', 'a kitchen that does not serve the city cannot take the order', r like 'err:22023:this kitchen does not deliver to your city%', r);
  update public.delivery_zones set active = false where city_key = 'casablanca';
  r := ztests.run('authenticated', ztests.u('f04'), ztests.order_sql());
  update public.delivery_zones set active = true where city_key = 'casablanca';
  r2 := ztests.run('authenticated', ztests.u('f04'), 'select count(*) from public.delivery_zones');
  perform ztests.rec('Z22', 'zone', 'pausing a zone stops orders there (audited); resuming restores it',
    r like 'err:22023:delivery is not available%' and r2 = '1'
    and (select count(*) from public.security_audit_log where action = 'delivery_zone_update') = 2, r);
end $$;

do $$ declare r text; begin
  -- Scaling: the owner opens Rabat (served by Kitchen A here) with one reviewed row.
  insert into public.delivery_zones (city_key, city_name, kitchen_id) values ('rabat', 'Rabat', ztests.ka());
  update public.user_profiles set delivery_city = 'rabat' where user_id = ztests.u('f03');
  r := ztests.run('authenticated', ztests.u('f03'), ztests.order_sql());
  perform ztests.rec('Z30', 'scale', 'opening a new city is one row: its customers can order', r ~ '^[0-9a-f-]{36}$', r);
end $$;
