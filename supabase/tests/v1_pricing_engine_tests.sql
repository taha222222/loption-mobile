-- =====================================================================
-- V1 pricing engine tests. DISPOSABLE DATABASE ONLY (run_v1_pricing_engine.sh).
-- Runs after every V1 migration including 20261108120000_v1_pricing_engine.sql.
-- Acts like PostgREST (SET ROLE + request.jwt.claims); the quote functions
-- are called as service_role, like the quote-delivery Edge Function.
--
-- TEST FIXTURES, NOT DECISIONS: the pricing rows use the owner-approved V1
-- values (3 MAD; 8 + 1.5 x km, 10..25) with made-up dispatch coordinates;
-- the tax rates approved below (10 % food, 20 % fees and a 20 % test
-- product category) only exercise the engine. No accountant rate exists.
-- Users: ...0f04 Casablanca customer (first order), ...0f03 customer moved
-- to Rabat (Kitchen B), ...0f01 customer with order history; ...e0c1
-- cashier A; ...e0b1 kitchen staff A; ...00d1 driver A; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ptests;
create table if not exists ptests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ptests.results;

create or replace function ptests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function ptests.k(p text) returns uuid language sql stable as $$
  select case p when 'A' then (select id from public.kitchens where code = 'A') else '00000000-0000-0000-0000-0000000000b2'::uuid end $$;
create or replace function ptests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
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
create or replace function ptests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into ptests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;
create or replace function ptests.order_sql(p_items text, p_req uuid default null, p_kitchen uuid default null) returns text language sql stable as $$
  select format('select public.create_order(%L, %L::jsonb, %L)', coalesce(p_kitchen, ptests.k('A')), p_items, coalesce(p_req, gen_random_uuid())) $$;
-- What the Edge Function does after routing: record the road distance (metres).
create or replace function ptests.quote_sql(p_user uuid, p_metres int, p_policy uuid default null) returns text language sql stable as $$
  select format('select public.record_delivery_quote(%L, %L, %L, 33.5731, -7.5898, %s, %L)', p_user,
                coalesce(p_policy, (select p.id from public.pricing_policies p join public.delivery_zones z on z.kitchen_id = p.kitchen_id
                                     join public.user_profiles u on u.delivery_city = z.city_key
                                    where u.user_id = p_user and p.active and z.active)),
                (select delivery_address from public.user_profiles where user_id = p_user), p_metres, 'test_router') $$;
create or replace function ptests.fee(p_km numeric) returns numeric language sql immutable as $$
  select public.delivery_fee_v1(p_km, 8, 1.5, 10, 25) $$;
create table if not exists ptests.o (name text primary key, id uuid);
truncate ptests.o;
grant usage on schema ptests to anon, authenticated, service_role;
grant execute on all functions in schema ptests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.kitchens (id, code, name, is_active)
values ('00000000-0000-0000-0000-0000000000b2', 'B', 'Kitchen B (test)', true) on conflict do nothing;
insert into public.staff_roles (user_id, role, kitchen_id) values
  (ptests.u('e0c1'), 'cashier', ptests.k('A')), (ptests.u('e0b1'), 'kitchen_staff', ptests.k('A')), (ptests.u('d1'), 'driver', ptests.k('A'))
on conflict do nothing;
insert into public.meals (id, name, price, calories, protein, available) values
  ('00000000-0000-0000-0000-00000000aa03', 'Bol poulet', 35, 500, 30, true),
  ('00000000-0000-0000-0000-00000000aa05', 'Jus test (catégorie test)', 12, 100, 0, true)
on conflict (id) do nothing;
update public.meals set available = true where id = '00000000-0000-0000-0000-00000000aa02';  -- 'Sans info', 50 MAD
update public.user_profiles set delivery_address = '12 Rue Test, Casablanca', delivery_latitude = 33.5731, delivery_longitude = -7.5898,
       delivery_city = 'casablanca' where user_id in (ptests.u('f04'), ptests.u('f01'));
update public.user_profiles set delivery_address = '5 Avenue Test, Rabat', delivery_latitude = 34.0209, delivery_longitude = -6.8416,
       delivery_city = 'rabat' where user_id = ptests.u('f03');
update public.promotions set is_active = true where code = 'FIRST_ORDER_FREE_DELIVERY';

-- ---------------------------------------------------------------- formula (pure)
do $$ declare bad text := ''; x record; r text; r2 text; r3 text; begin
  -- Owner examples: 1 km -> 10, 3 -> 13, 5 -> 16, 8 -> 20, 10 -> 23, 15 -> 25.
  for x in select * from (values (1.0, 10), (3.0, 13), (5.0, 16), (8.0, 20), (10.0, 23), (15.0, 25)) v(km, fee) loop
    if ptests.fee(x.km) <> x.fee then bad := bad || x.km || ' km => ' || ptests.fee(x.km) || ' ; '; end if;
  end loop;
  perform ptests.rec('F01', 'formula', 'owner examples: 1/3/5/8/10/15 km -> 10/13/16/20/23/25 MAD', bad = '', nullif(bad, ''));
  -- 8 + 1.5 d = 14.489 (d 4.326) -> 14 ; 14.501 (d 4.334) -> 15 ; 12.5 exactly (d 3) -> 13 ; 11.49 / 11.50 with a flat formula.
  perform ptests.rec('F02', 'rounding', 'half up at the unit: 14.489 -> 14, 14.501 -> 15, 12.50 -> 13, 11.49 -> 11, 11.50 -> 12',
    ptests.fee(4.326) = 14 and ptests.fee(4.334) = 15 and ptests.fee(3) = 13
    and public.delivery_fee_v1(1, 11.49, 0, 0, 100) = 11 and public.delivery_fee_v1(1, 11.50, 0, 0, 100) = 12,
    format('%s %s %s', ptests.fee(4.326), ptests.fee(4.334), ptests.fee(3)));
  perform ptests.rec('F03', 'caps', 'minimum 10 below 1.33 km (0.1 km -> 10, 1.333 -> 10); maximum 25 from 11.33 km (11.4 -> 25, 150 -> 25); the cap is not a radius',
    ptests.fee(0.1) = 10 and ptests.fee(1.333) = 10 and ptests.fee(1.4) = 10 and ptests.fee(11.3) = 25 and ptests.fee(11.4) = 25 and ptests.fee(150) = 25
    and ptests.fee(11.0) = 25 and ptests.fee(10.6) = 24, format('%s %s', ptests.fee(11.0), ptests.fee(10.6)));
  r := ptests.run('authenticated', ptests.u('f04'), 'select public.delivery_fee_v1(0, 8, 1.5, 10, 25)');
  r2 := ptests.run('authenticated', ptests.u('f04'), 'select public.delivery_fee_v1(-2, 8, 1.5, 10, 25)');
  r3 := ptests.run('authenticated', ptests.u('f04'), 'select public.delivery_fee_v1(null, 8, 1.5, 10, 25)');
  perform ptests.rec('F04', 'formula', 'a zero, negative or missing distance is refused (never a default fee)',
    r like 'err:22023%' and r2 like 'err:22023%' and r3 like 'err:22023%', r || ' | ' || r2 || ' | ' || r3);
  -- TTC -> HT / TVA
  perform ptests.rec('F10', 'tax', 'TTC 100 at 10 % -> HT 90.91 + TVA 9.09; 50 -> 45.45 + 4.55; 35 -> 31.82 + 3.18; HT + TVA = TTC',
    (select ht = 90.91 and tva = 9.09 from public.tax_split(100, 0.10)) and (select ht = 45.45 and tva = 4.55 from public.tax_split(50, 0.10))
    and (select ht = 31.82 and tva = 3.18 from public.tax_split(35, 0.10))
    and not exists (select 1 from generate_series(1, 2000) c, public.tax_split(c / 100.0, 0.10) s where s.ht + s.tva <> c / 100.0), null);
  perform ptests.rec('F11', 'tax', 'other rates: 3 at 20 % -> 2.50 + 0.50; 16 at 20 % -> 13.33 + 2.67; 0 % -> HT = TTC; a rate outside [0,1) is refused',
    (select ht = 2.50 and tva = 0.50 from public.tax_split(3, 0.20)) and (select ht = 13.33 and tva = 2.67 from public.tax_split(16, 0.20))
    and (select ht = 16 and tva = 0 from public.tax_split(16, 0)) and ptests.run('postgres', null, 'select public.tax_split(10, 1)') like 'err:22023%', null);
end $$;

-- ---------------------------------------------------------------- server-only objects
do $$ declare r text; r2 text; r3 text; r4 text; begin
  r := ptests.run('authenticated', ptests.u('f04'), 'select count(*) from public.tax_categories');
  r2 := ptests.run('authenticated', ptests.u('a1'), $q$update public.tax_categories set rate = 0, status = 'approved'$q$);
  r3 := ptests.run('anon', null, 'select count(*) from public.delivery_quotes');
  r4 := ptests.run('authenticated', ptests.u('a1'), 'select count(*) from public.delivery_quotes');
  perform ptests.rec('S01', 'security', 'tax categories and quotes are server-only (customers, admins, anonymous: no read, no write)',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 like 'err:42501%' and r4 like 'err:42501%', r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
  r := ptests.run('authenticated', ptests.u('f04'), format('select public.record_delivery_quote(%L, gen_random_uuid(), %L, 33.5, -7.5, 1000, %L)', ptests.u('f04'), 'x', 'x'));
  r2 := ptests.run('authenticated', ptests.u('f04'), format('select public.delivery_quote_context(%L)', ptests.u('f04')));
  r3 := ptests.run('service_role', null, format('select public.delivery_quote_scope(%L)', ptests.u('f04')));
  r4 := ptests.run('service_role', null, format($q$insert into public.delivery_quotes (user_id, kitchen_id, pricing_policy_id, address_text, destination_latitude, destination_longitude,
          origin_latitude, origin_longitude, distance_km, delivery_fee, formula_version, provider, expires_at)
          values (%L, %L, gen_random_uuid(), 'x', 0, 0, 0, 0, 1, 0, 'v1_road_km', 'xx', now() + interval '1 hour')$q$, ptests.u('f04'), ptests.k('A')));
  perform ptests.rec('S02', 'security', 'a customer cannot record a distance or read the quote context; even service_role only goes through the two quote functions',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 like 'err:42501%' and r4 like 'err:42501%', r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
  perform ptests.rec('S03', 'tax', 'seeded categories are pending: restaurant food 10 % proposed, service and delivery fees without a rate',
    (select string_agg(code || ':' || coalesce(rate::text, '-') || ':' || status, ',' order by code) from public.tax_categories)
      = 'delivery_fee:-:pending_confirmation,restaurant_food:0.1000:pending_confirmation,service_fee:-:pending_confirmation'
    and not exists (select 1 from public.meals where tax_category <> 'restaurant_food'), null);
  r := ptests.run('postgres', null, $q$update public.tax_categories set status = 'approved' where code = 'service_fee'$q$);
  r2 := ptests.run('postgres', null, $q$delete from public.tax_categories where code = 'service_fee'$q$);
  perform ptests.rec('S04', 'tax', 'a category is approved only with a rate, an approver, a reference and a date; categories are never deleted',
    r like 'err:23514%' and r2 like 'err:42501:tax categories are never deleted%', r || ' | ' || r2);
end $$;

-- ---------------------------------------------------------------- no pricing: closed
do $$ declare r text; r2 text; n0 bigint := (select count(*) from public.orders); begin
  r := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f04')));
  r2 := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ptests.rec('P01', 'pricing', 'without an approved pricing row no quote and no order (55000); nothing written',
    r like 'err:55000:ordering is not open%' and r2 like 'err:55000:ordering is not open%' and (select count(*) from public.orders) = n0, r || ' | ' || r2);
end $$;

insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at,
                                     config_version, delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee,
                                     delivery_max_fee, origin_latitude, origin_longitude)
values (ptests.k('A'), 3, 'included_in_menu_prices', 'Test fixture', 'TEST ONLY - fixture with the V1 proposal values', now(),
        'test-v1', 'v1_road_km', 8, 1.5, 10, 25, 33.5890, -7.6030);

do $$ declare r text; r2 text; pid uuid := (select id from public.pricing_policies where active and kitchen_id = ptests.k('A')); begin
  perform ptests.rec('P02', 'pricing', 'the pricing row is audited with its formula values and config version',
    exists (select 1 from public.security_audit_log where action = 'pricing_policy_approved' and details ->> 'policy_id' = pid::text
            and details ->> 'config_version' = 'test-v1' and (details ->> 'delivery_per_km')::numeric = 1.5 and (details ->> 'service_fee')::numeric = 3), null);
  r := ptests.run('authenticated', ptests.u('f04'), 'select service_fee::text || ''/'' || delivery_base_fee || ''/'' || delivery_per_km || ''/'' || delivery_min_fee || ''/'' || delivery_max_fee from public.pricing_policies');
  r2 := ptests.run('postgres', null, format('update public.pricing_policies set delivery_max_fee = 30 where id = %L', pid));
  perform ptests.rec('P03', 'pricing', 'customers read the active pricing (to show the fees); the row is never edited',
    r = '3.00/8.00/1.50/10.00/25.00' and r2 like 'err:42501:a pricing policy is never edited%', r || ' | ' || r2);
  r := ptests.run('postgres', null, $q$insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at,
      config_version, delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee, delivery_max_fee, origin_latitude, origin_longitude, minimum_subtotal)
      values ('00000000-0000-0000-0000-0000000000b2', 3, 'included_in_menu_prices', 'xx', 'xxx', now(), 'x1', 'v1_road_km', 8, 1.5, 10, 25, 0, 0, 40)$q$);
  r2 := ptests.run('postgres', null, $q$insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at,
      config_version, delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee, delivery_max_fee, origin_latitude, origin_longitude)
      values ('00000000-0000-0000-0000-0000000000b2', 3, 'included_in_menu_prices', 'xx', 'xxx', now(), 'x1', 'straight_line', 8, 1.5, 30, 25, 0, 0)$q$);
  perform ptests.rec('P04', 'pricing', 'no minimum order column exists; an unknown formula or a minimum above the maximum is refused',
    r like 'err:42703%' and r2 like 'err:23514%', r || ' | ' || r2);
end $$;

-- ---------------------------------------------------------------- quotes
do $$ declare r text; r2 text; r3 text; j jsonb; bad text := ''; t text; begin
  j := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f04')))::jsonb;
  perform ptests.rec('Q01', 'quote', 'the quote context gives the zone''s kitchen, its dispatch point and the profile address; no quote yet',
    j ->> 'kitchen_id' = ptests.k('A')::text and (j ->> 'origin_latitude')::float8 = 33.5890 and j ->> 'address_text' = '12 Rue Test, Casablanca'
    and (j -> 'existing_quote') = 'null'::jsonb, j::text);
  update public.user_profiles set delivery_city = null where user_id = ptests.u('f01');
  r := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f01')));
  update public.user_profiles set delivery_city = 'marrakech' where user_id = ptests.u('f01');
  r2 := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f01')));
  update public.user_profiles set delivery_city = 'casablanca', delivery_address = ' ' where user_id = ptests.u('f01');
  r3 := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f01')));
  update public.user_profiles set delivery_address = '12 Rue Test, Casablanca' where user_id = ptests.u('f01');
  perform ptests.rec('Q02', 'quote', 'no quote without a city, outside a served city, or without an address (no routing call is made)',
    r like 'err:22023:choose your delivery city%' and r2 like 'err:22023:delivery is not available in your city yet%'
    and r3 like 'err:22023:a confirmed delivery address%', r || ' | ' || r2 || ' | ' || r3);
  foreach t in array array['0', '-5', '200001'] loop
    r := ptests.run('service_role', null, ptests.quote_sql(ptests.u('f04'), t::int));
    if r not like 'err:22023%' then bad := bad || t || ' m => ' || r || ' ; '; end if;
  end loop;
  r := ptests.run('service_role', null, format('select public.record_delivery_quote(%L, %L, %L, null, -7.5, 3000, %L)', ptests.u('f04'),
         (select id from public.pricing_policies where active and kitchen_id = ptests.k('A')), '12 Rue Test, Casablanca', 'test_router'));
  if r not like 'err:22023:invalid destination%' then bad := bad || 'no destination => ' || r || ' ; '; end if;
  r := ptests.run('service_role', null, format('select public.record_delivery_quote(%L, %L, %L, 33.5, -7.5, null, %L)', ptests.u('f04'),
         (select id from public.pricing_policies where active and kitchen_id = ptests.k('A')), '12 Rue Test, Casablanca', 'test_router'));
  if r not like 'err:22023%' then bad := bad || 'no distance => ' || r || ' ; '; end if;
  r := ptests.run('service_role', null, format('select public.record_delivery_quote(%L, %L, %L, 33.5, -7.5, 3000, %L)', ptests.u('f04'),
         (select id from public.pricing_policies where active and kitchen_id = ptests.k('A')), '1 Ancienne Adresse, Casablanca', 'test_router'));
  if r not like 'err:40001:the delivery address changed%' then bad := bad || 'address changed while routing => ' || r || ' ; '; end if;
  r := ptests.run('service_role', null, ptests.quote_sql(ptests.u('f04'), 3000, gen_random_uuid()));
  if r not like 'err:40001%' then bad := bad || 'other pricing => ' || r; end if;
  perform ptests.rec('Q03', 'quote', 'a zero, negative, absurd or missing distance, a missing destination, an address changed during routing or a stale pricing row is refused; nothing recorded',
    bad = '' and (select count(*) from public.delivery_quotes) = 0, nullif(bad, ''));
  j := ptests.run('service_role', null, ptests.quote_sql(ptests.u('f04'), 5000))::jsonb;
  perform ptests.rec('Q04', 'quote', 'a 5 km road distance gives 16 MAD; the quote states distance, fee, service fee, formula, config, expiry (15 min)',
    (j ->> 'distance_km')::numeric = 5 and (j ->> 'delivery_fee')::numeric = 16 and (j ->> 'service_fee')::numeric = 3
    and j ->> 'formula_version' = 'v1_road_km' and j ->> 'config_version' = 'test-v1'
    and (j ->> 'expires_at')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes'
    and exists (select 1 from public.delivery_quotes where id = (j ->> 'quote_id')::uuid and kitchen_id = ptests.k('A')
                and origin_latitude = 33.5890 and address_text = '12 Rue Test, Casablanca'), j::text);
  j := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f04')))::jsonb;
  perform ptests.rec('Q05', 'quote', 'a valid quote is offered again by the context (no second routing call)',
    (j -> 'existing_quote' ->> 'delivery_fee')::numeric = 16, j::text);
  j := ptests.run('service_role', null, ptests.quote_sql(ptests.u('f04'), 4326))::jsonb;
  perform ptests.rec('Q06', 'quote', 'metres are kept to the metre: 4326 m -> 4.326 km -> 14.489 -> 14 MAD',
    (j ->> 'distance_km')::numeric = 4.326 and (j ->> 'delivery_fee')::numeric = 14, j::text);
end $$;

-- ---------------------------------------------------------------- taxes must be approved
do $$ declare r text; n0 bigint := (select count(*) from public.orders); i0 bigint := (select count(*) from public.order_items); begin
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ptests.rec('T01', 'tax', 'with the fee tax treatment pending, ordering stays closed (55000); nothing written',
    r like 'err:55000:ordering is not open: the tax treatment of the service and delivery fees is not approved%'
    and (select count(*) from public.orders) = n0 and (select count(*) from public.delivery_quotes where used_by_order is not null) = 0, r);
  update public.tax_categories set rate = 0.20, status = 'approved', approved_by = 'Test fixture', approval_reference = 'TEST ONLY - not an accountant rate', approved_at = now()
   where code in ('service_fee', 'delivery_fee');
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ptests.rec('T02', 'tax', 'with a product category pending, ordering stays closed; the order row and lines are rolled back',
    r like 'err:55000:ordering is not open: the tax rate of restaurant_food is not approved%'
    and (select count(*) from public.orders) = n0 and (select count(*) from public.order_items) = i0, r);
  update public.tax_categories set status = 'approved', approved_by = 'Test fixture', approval_reference = 'TEST ONLY - not an accountant rate', approved_at = now()
   where code = 'restaurant_food';
  insert into public.tax_categories (code, label, applies_to, rate, status, approved_by, approval_reference, approved_at)
  values ('test_beverage', 'Catégorie de test', 'product', 0.20, 'approved', 'Test fixture', 'TEST ONLY', now());
  update public.meals set tax_category = 'test_beverage' where id = '00000000-0000-0000-0000-00000000aa05';
  perform ptests.rec('T03', 'tax', 'every category change is audited (rate, status, approver, reference)',
    (select count(*) from public.security_audit_log where action like 'tax_category_%' and details ->> 'status' = 'approved') = 4, null);
end $$;

-- ---------------------------------------------------------------- a priced order
do $$ declare r text; r2 text; o public.orders%rowtype; q uuid; req uuid := '22222222-2222-2222-2222-222222222222'; begin
  q := (select id from public.delivery_quotes where user_id = ptests.u('f04') order by created_at desc limit 1);   -- 4.326 km, 14 MAD
  -- The lines carry forged price, fee, tax and total keys: all ignored.
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql(
         '[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":2,"price":1,"total":0,"tax_rate":0,"tva":0,"delivery_fee":0,"service_fee":0,"line_total_ttc":1},'
         '{"meal_id":"00000000-0000-0000-0000-00000000aa03","quantity":1,"price":0},{"meal_id":"00000000-0000-0000-0000-00000000aa05","quantity":1,"tax_category":"restaurant_food"}]', req));
  insert into ptests.o values ('first', r::uuid);
  select * into o from public.orders where id = r::uuid;
  perform ptests.rec('O01', 'total', 'subtotal TTC 147 (2 x 50 + 35 + 12, menu prices); service fee 3 once; first order: delivery 14 offered; total = COD due = 150',
    o.subtotal = 147 and o.platform_service_fee = 3 and o.delivery_fee_before_discount = 14 and o.delivery_discount = 14 and o.delivery_fee = 0
    and o.total = 150 and o.payment_method = 'cash' and o.payment_status = 'pending' and o.status = 'pending',
    format('sub=%s svc=%s dlv=%s disc=%s total=%s', o.subtotal, o.platform_service_fee, o.delivery_fee, o.delivery_discount, o.total));
  perform ptests.rec('O02', 'tax', 'line snapshot: 100 at 10 % = 90.91 + 9.09; 35 at 10 % = 31.82 + 3.18; 12 at 20 % (test category) = 10.00 + 2.00',
    (select string_agg(meal_name || ':' || quantity || ':' || price || ':' || tax_category || ':' || tax_rate || ':' || line_total_ttc || ':' || line_ht || ':' || line_tva, ' | ' order by meal_name)
       from public.order_items where order_id = o.id)
    = 'Bol poulet:1:35:restaurant_food:0.1000:35.00:31.82:3.18 | Jus test (catégorie test):1:12:test_beverage:0.2000:12.00:10.00:2.00 | Sans info:2:50:restaurant_food:0.1000:100.00:90.91:9.09',
    (select string_agg(meal_name || ':' || quantity || ':' || price || ':' || tax_category || ':' || tax_rate || ':' || line_total_ttc || ':' || line_ht || ':' || line_tva, ' | ' order by meal_name)
       from public.order_items where order_id = o.id));
  perform ptests.rec('O03', 'tax', 'order snapshot: products HT 132.73 + TVA 14.27 = 147; service fee 3 at 20 % = 2.50 + 0.50; delivery 0 after the offer = 0 + 0; TVA never added',
    o.products_ht = 132.73 and o.products_tva = 14.27 and o.products_ht + o.products_tva = o.subtotal
    and o.service_fee_tax_category = 'service_fee' and o.service_fee_tax_rate = 0.20 and o.service_fee_ht = 2.50 and o.service_fee_tva = 0.50
    and o.delivery_fee_tax_category = 'delivery_fee' and o.delivery_fee_ht = 0 and o.delivery_fee_tva = 0
    and o.total = o.subtotal + o.platform_service_fee + o.delivery_fee,
    format('ht=%s tva=%s', o.products_ht, o.products_tva));
  perform ptests.rec('O04', 'snapshot', 'the order keeps kitchen, distance 4.326 km, formula, pricing row, config version, quote and calculation time; the quote is used',
    o.kitchen_id = ptests.k('A') and o.delivery_distance_km = 4.326 and o.delivery_formula_version = 'v1_road_km'
    and o.pricing_policy_id = (select id from public.pricing_policies where active and kitchen_id = ptests.k('A')) and o.pricing_config_version = 'test-v1'
    and o.delivery_quote_id = q and o.priced_at is not null
    and (select used_by_order from public.delivery_quotes where id = q) = o.id
    and exists (select 1 from public.security_audit_log where action = 'order_created' and details ->> 'order_id' = o.id::text
                and (details ->> 'distance_km')::numeric = 4.326 and details ->> 'quote_id' = q::text and details ->> 'config_version' = 'test-v1'), null);
  r2 := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa03","quantity":9}]', req));
  perform ptests.rec('O05', 'idempotency', 'the same request id returns the same order (no new lines, no other quote consumed)',
    r2 = r and (select count(*) from public.order_items where order_id = o.id) = 3
    and (select count(*) from public.delivery_quotes where used_by_order is not null) = 1, r2);
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ptests.rec('O06', 'quote', 'the 5 km quote (older, unused) is still valid and is the only one left: a second order uses it',
    r ~ '^[0-9a-f-]{36}$' and (select delivery_distance_km = 5 and delivery_fee = 16 and coalesce(delivery_discount, 0) = 0 and total = 50 + 3 + 16
                               and delivery_fee_ht = 13.33 and delivery_fee_tva = 2.67 from public.orders where id = r::uuid), r);
  insert into ptests.o values ('second', r::uuid);
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ptests.rec('O07', 'quote', 'every quote is used once: with none left, no order (the distance must be calculated again)',
    r like 'err:55000:delivery quote required%', r);
end $$;

-- ---------------------------------------------------------------- the quote must match the address, kitchen and pricing
do $$ declare r text; r2 text; j jsonb; n0 bigint; begin
  perform ptests.run('service_role', null, ptests.quote_sql(ptests.u('f04'), 3000));
  update public.user_profiles set delivery_address = '99 Boulevard Autre, Casablanca', delivery_latitude = 33.60 where user_id = ptests.u('f04');
  n0 := (select count(*) from public.orders);
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  j := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f04')))::jsonb;
  perform ptests.rec('M01', 'quote', 'after an address change the old quote is not used (no order, no stale offer)',
    r like 'err:55000:delivery quote required%' and (j -> 'existing_quote') = 'null'::jsonb and (select count(*) from public.orders) = n0, r);
  perform ptests.run('service_role', null, ptests.quote_sql(ptests.u('f04'), 3000));
  update public.delivery_quotes set expires_at = now() - interval '1 second' where user_id = ptests.u('f04') and used_by_order is null;
  r := ptests.run('authenticated', ptests.u('f04'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]'));
  perform ptests.rec('M02', 'quote', 'an expired quote is not used', r like 'err:55000:delivery quote required%', r);
  -- Kitchen B serves Rabat from its own dispatch point.
  insert into public.delivery_zones (city_key, city_name, kitchen_id) values ('rabat', 'Rabat', ptests.k('B'));
  insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at, config_version,
                                       delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee, delivery_max_fee, origin_latitude, origin_longitude)
  values (ptests.k('B'), 3, 'included_in_menu_prices', 'Test fixture', 'TEST ONLY', now(), 'test-v1-b', 'v1_road_km', 8, 1.5, 10, 25, 34.0100, -6.8300);
  j := ptests.run('service_role', null, ptests.quote_sql(ptests.u('f03'), 8000))::jsonb;
  perform ptests.rec('M03', 'kitchen', 'the distance is measured from the kitchen that serves the address (Rabat -> Kitchen B origin)',
    j ->> 'kitchen_id' = ptests.k('B')::text and (j ->> 'delivery_fee')::numeric = 20
    and exists (select 1 from public.delivery_quotes where id = (j ->> 'quote_id')::uuid and origin_latitude = 34.0100 and kitchen_id = ptests.k('B')), j::text);
  r := ptests.run('authenticated', ptests.u('f03'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]', null, ptests.k('A')));
  r2 := ptests.run('authenticated', ptests.u('f03'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]', null, ptests.k('B')));
  perform ptests.rec('M04', 'kitchen', 'the order is taken by the kitchen of the quote only (Kitchen A refused; Kitchen B priced with its distance)',
    r like 'err:22023:this kitchen does not deliver to your city%' and r2 ~ '^[0-9a-f-]{36}$'
    and (select kitchen_id = ptests.k('B') and delivery_distance_km = 8 and pricing_config_version = 'test-v1-b' from public.orders where id = r2::uuid), r || ' | ' || r2);
  -- A new pricing row (deactivate + insert) invalidates earlier quotes.
  perform ptests.run('service_role', null, ptests.quote_sql(ptests.u('f03'), 8000));
  update public.pricing_policies set active = false where kitchen_id = ptests.k('B') and active;
  insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at, config_version,
                                       delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee, delivery_max_fee, origin_latitude, origin_longitude)
  values (ptests.k('B'), 3, 'included_in_menu_prices', 'Test fixture', 'TEST ONLY', now(), 'test-v1-b2', 'v1_road_km', 8, 1.5, 10, 25, 34.0100, -6.8300);
  r := ptests.run('authenticated', ptests.u('f03'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]', null, ptests.k('B')));
  perform ptests.rec('M05', 'pricing', 'a quote made under a replaced pricing row is not used', r like 'err:55000:delivery quote required%', r);
  update public.delivery_zones set active = false where city_key = 'rabat';
  r := ptests.run('service_role', null, format('select public.delivery_quote_context(%L)', ptests.u('f03')));
  r2 := ptests.run('authenticated', ptests.u('f03'), ptests.order_sql('[{"meal_id":"00000000-0000-0000-0000-00000000aa02","quantity":1}]', null, ptests.k('B')));
  perform ptests.rec('M06', 'zone', 'an unserved city: no quote, no order (zone enforcement kept)',
    r like 'err:22023:delivery is not available in your city yet%' and r2 like 'err:22023:delivery is not available in your city yet%', r || ' | ' || r2);
end $$;

-- ---------------------------------------------------------------- tampering and history
do $$ declare r text; r2 text; r3 text; r4 text; first uuid := (select id from ptests.o where name = 'first'); begin
  r := ptests.run('authenticated', ptests.u('f04'), format('update public.orders set total = 1, delivery_fee = 0, products_tva = 0 where id = %L', first));
  r2 := ptests.run('authenticated', ptests.u('f04'), format('update public.order_items set price = 1, line_total_ttc = 1, tax_rate = 0 where order_id = %L', first));
  r3 := ptests.run('authenticated', ptests.u('a1'), format('update public.orders set delivery_fee_tva = 0, total = 0 where id = %L', first));
  r4 := ptests.run('authenticated', ptests.u('a1'), format('update public.order_items set line_tva = 0 where order_id = %L', first));
  perform ptests.rec('X01', 'tampering', 'no client changes a total, fee, tax or line snapshot (customer: invisible; admin: refused)',
    r = 'ok:0' and r2 = 'ok:0' and r3 like 'err:42501%' and r4 like 'err:42501%' and (select total from public.orders where id = first) = 150,
    r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
  r := ptests.run('postgres', null, format('update public.order_items set line_tva = 0 where order_id = %L', first));
  r2 := ptests.run('authenticated', ptests.u('f04'), format($q$insert into public.order_items (order_id, meal_name, quantity, price, line_total_ttc) values (%L, 'x', 1, 0, 0)$q$, first));
  r3 := ptests.run('authenticated', ptests.u('f04'), format($q$update public.orders set status = 'delivered', payment_status = 'paid' where id = %L$q$, first));
  perform ptests.rec('X02', 'tampering', 'even the owner role cannot rewrite a tax snapshot; a customer cannot add lines or change status/payment',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 = 'ok:0', r || ' | ' || r2 || ' | ' || r3);
  update public.meals set price = 999 where id = '00000000-0000-0000-0000-00000000aa02';
  update public.tax_categories set rate = 0.14 where code = 'restaurant_food';
  perform ptests.rec('X03', 'history', 'a later menu price or tax rate change does not touch a created order (prices, rates, HT/TVA, totals)',
    (select price = 50 and tax_rate = 0.10 and line_ht = 90.91 and line_tva = 9.09 from public.order_items where order_id = first and meal_name = 'Sans info')
    and (select total = 150 and products_tva = 14.27 from public.orders where id = first), null);
  update public.meals set price = 50 where id = '00000000-0000-0000-0000-00000000aa02';
  update public.tax_categories set rate = 0.10 where code = 'restaurant_food';
end $$;

-- ---------------------------------------------------------------- COD lifecycle (unchanged)
do $$ declare r text := ''; o uuid := (select id from ptests.o where name = 'second'); t0 numeric := (select total from public.orders where id = o); begin
  r := r || ptests.run('authenticated', ptests.u('f04'), format('select public.order_set_payment(%L, %L)', o, 'paid')) || ',';
  r := r || ptests.run('authenticated', ptests.u('e0c1'), format('select public.order_confirm(%L)', o)) || ',';
  r := r || (select payment_status from public.orders where id = o) || ',';
  r := r || ptests.run('authenticated', ptests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'preparing')) || ',';
  r := r || ptests.run('authenticated', ptests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'ready')) || ',';
  r := r || ptests.run('authenticated', ptests.u('e0c1'), format('select public.order_assign_driver(%L, %L)', o, ptests.u('d1'))) || ',';
  r := r || ptests.run('authenticated', ptests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'picked_up')) || ',';
  r := r || ptests.run('authenticated', ptests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'on_the_way')) || ',';
  r := r || ptests.run('authenticated', ptests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'delivered')) || ',';
  r := r || ptests.run('authenticated', ptests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  perform ptests.rec('L01', 'cod', 'a priced order follows the COD workflow: confirmation does not mark it paid; payment by the cashier after delivery; total unchanged',
    r like 'err:42501%,changed,pending,changed,changed,changed,changed,changed,changed,changed'
    and (select status = 'delivered' and payment_status = 'paid' and total = t0 and total = 69 from public.orders where id = o), r);
end $$;
