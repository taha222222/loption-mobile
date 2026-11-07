-- =====================================================================
-- V1 checkout experience tests. DISPOSABLE DATABASE ONLY
-- (run_v1_checkout_experience.sh). Runs after every V1 migration including
-- 20261109120000_v1_checkout_experience.sql.
--
-- TEST FIXTURES, NOT DECISIONS: the pricing row uses the owner values
-- (3 MAD; 8 + 1.5 x km, 10..25) with made-up coordinates; tax rates (10 %
-- food, 20 % fees) only exercise the engine; meals, choices and promo codes
-- below are invented test data. Phone numbers are fictitious.
-- Users: ...0f01, 0f02, 0f04, 0f05 customers in Casablanca; ...0f03 in
-- Rabat (not served); ...e0c1 cashier A; ...e0b1 kitchen A; ...00d1 driver A;
-- ...00d2 driver without kitchen; ...00a1 admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists xtests;
create table if not exists xtests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate xtests.results;

create or replace function xtests.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function xtests.ka() returns uuid language sql stable as $$ select id from public.kitchens where code = 'A' $$;
create or replace function xtests.m(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000000' || p)::uuid $$;
create or replace function xtests.run(p_role text, p_sub uuid, p_sql text) returns text language plpgsql as $$
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
create or replace function xtests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text) returns void language sql as $$
  insert into xtests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail $$;
-- The road distance the Edge Function would record (metres).
create or replace function xtests.quote(p_user uuid, p_metres int) returns text language sql as $$
  select xtests.run('service_role', null, format('select public.record_delivery_quote(%L, %L, %L, 33.57, -7.59, %s, %L)', p_user,
         (select id from public.pricing_policies where active and kitchen_id = xtests.ka()),
         (select delivery_address from public.user_profiles where user_id = p_user), p_metres, 'test_router')) $$;
create or replace function xtests.preview(p_user uuid, p_items text, p_code text default null) returns text language sql as $$
  select xtests.run('authenticated', p_user, format('select public.checkout_preview(%L, %L::jsonb, %L)::text', xtests.ka(), p_items, p_code)) $$;
create or replace function xtests.order_sql(p_items text, p_total numeric, p_code text default null, p_req uuid default null) returns text language sql as $$
  select format('select public.create_order(%L, %L::jsonb, %L, null, %L, %s)', xtests.ka(), p_items, coalesce(p_req, gen_random_uuid()), p_code,
                coalesce(p_total::text, 'null')) $$;
-- Preview, then order with the total the customer saw.
create or replace function xtests.order(p_user uuid, p_items text, p_code text default null) returns text language plpgsql as $$
declare pv text := xtests.preview(p_user, p_items, p_code);
begin
  if pv like 'err:%' then return pv; end if;
  return xtests.run('authenticated', p_user, xtests.order_sql(p_items, (pv::jsonb ->> 'total')::numeric, p_code));
end $$;
-- The real verification flow: code issued (service_role), sent, typed by the customer.
create or replace function xtests.verify_phone(p_user uuid, p_phone text) returns text language plpgsql as $$
declare j jsonb; r text;
begin
  update public.phone_verifications set created_at = created_at - interval '2 hours' where user_id = p_user;
  r := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)::text', p_user, p_phone));
  if r like 'err:%' then return r; end if;
  j := r::jsonb;
  perform xtests.run('service_role', null, format('select public.phone_otp_mark(%L, true, %L, %L)', j ->> 'verification_id', 'test_whatsapp', 'wamid.TEST'));
  return xtests.run('authenticated', p_user, format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id', j ->> 'code'));
end $$;
create table if not exists xtests.o (name text primary key, id uuid);
truncate xtests.o;
grant usage on schema xtests to anon, authenticated, service_role;
grant execute on all functions in schema xtests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into public.staff_roles (user_id, role, kitchen_id) values
  (xtests.u('e0c1'), 'cashier', xtests.ka()), (xtests.u('e0b1'), 'kitchen_staff', xtests.ka()),
  (xtests.u('d1'), 'driver', xtests.ka()), (xtests.u('d2'), 'driver', null)
on conflict do nothing;
insert into public.meals (id, name, price, calories, protein, available, description) values
  (xtests.m('aa06'), 'Meal A (test)', 65, 600, 40, true, 'Poulet grillé, riz complet, légumes rôtis.'),
  (xtests.m('aa03'), 'Meal B (test)', 35, 400, 25, true, null),
  (xtests.m('aa07'), 'Bowl (test)', 50, 500, 30, true, null)
on conflict (id) do nothing;
-- Bowl: a required sauce (one), up to two paid extras, free removals.
insert into public.meal_option_groups (id, meal_id, name, min_select, max_select, sort_order) values
  ('00000000-0000-0000-0000-0000000000a1'::uuid, xtests.m('aa07'), 'Sauce', 1, 1, 1),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, xtests.m('aa07'), 'Suppléments', 0, 2, 2),
  ('00000000-0000-0000-0000-0000000000a3'::uuid, xtests.m('aa07'), 'Retirer', 0, 3, 3),
  ('00000000-0000-0000-0000-0000000000a4'::uuid, xtests.m('aa07'), 'Ancienne option', 1, 1, 4);
update public.meal_option_groups set active = false where id = '00000000-0000-0000-0000-0000000000a4';
insert into public.meal_options (id, group_id, name, price_delta, sort_order, available) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Harissa', 0, 1, true),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Algérienne', 0, 2, true),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a2', 'Fromage', 5, 1, true),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a2', 'Oeuf', 4.50, 2, true),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a2', 'Avocat', 8, 3, true),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a3', 'Sans oignon', 0, 1, true),
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000a1', 'Sauce retirée', 0, 3, false),
  ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000a4', 'Ancienne', 0, 1, true);
insert into public.pricing_policies (kitchen_id, service_fee, tva_treatment, approved_by, approval_reference, approved_at,
                                     config_version, delivery_formula_version, delivery_base_fee, delivery_per_km, delivery_min_fee,
                                     delivery_max_fee, origin_latitude, origin_longitude)
values (xtests.ka(), 3, 'included_in_menu_prices', 'Test fixture', 'TEST ONLY', now(), 'test-v1', 'v1_road_km', 8, 1.5, 10, 25, 33.589, -7.603);
update public.tax_categories set rate = coalesce(rate, 0.20), status = 'approved', approved_by = 'Test fixture',
       approval_reference = 'TEST ONLY - not an accountant rate', approved_at = now();
update public.user_profiles set delivery_address = '12 Rue Test, Casablanca', delivery_latitude = 33.5731, delivery_longitude = -7.5898,
       delivery_city = 'casablanca' where user_id in (xtests.u('f01'), xtests.u('f02'), xtests.u('f04'), xtests.u('f05'));
update public.user_profiles set delivery_address = '5 Avenue Test, Rabat', delivery_city = 'rabat' where user_id = xtests.u('f03');
update public.promotions set is_active = true where code = 'FIRST_ORDER_FREE_DELIVERY';

-- ---------------------------------------------------------------- customization and product data
do $$ declare r text; r2 text; r3 text; r4 text; begin
  r := xtests.run('authenticated', xtests.u('f04'), format('select string_agg(name, '','' order by sort_order) from public.meal_option_groups where meal_id = %L', xtests.m('aa07')));
  r2 := xtests.run('authenticated', xtests.u('f04'), $q$select string_agg(name, ',' order by name) from public.meal_options where group_id = '00000000-0000-0000-0000-0000000000a1'$q$);
  r3 := xtests.run('anon', null, 'select count(*) from public.meal_option_groups');
  perform xtests.rec('K01', 'options', 'customers read the active groups and available choices of a meal; inactive ones are hidden; anonymous callers read nothing',
    r = 'Sauce,Suppléments,Retirer' and r2 = 'Algérienne,Harissa' and r3 like 'err:42501%', r || ' | ' || r2 || ' | ' || r3);
  r := xtests.run('authenticated', xtests.u('f04'), $q$update public.meal_options set price_delta = 0$q$);
  r2 := xtests.run('authenticated', xtests.u('f04'), format($q$insert into public.meal_option_groups (meal_id, name) values (%L, 'x')$q$, xtests.m('aa07')));
  r3 := xtests.run('authenticated', xtests.u('a1'), $q$update public.meal_options set price_delta = 5 where id = '00000000-0000-0000-0000-0000000000b3'$q$);
  r4 := xtests.run('authenticated', xtests.u('f04'), $q$insert into public.meal_options (group_id, name, price_delta) values ('00000000-0000-0000-0000-0000000000a2', 'Neg', -5)$q$);
  perform xtests.rec('K02', 'options', 'a customer cannot change choices or prices; an admin can; a negative extra price is impossible',
    r = 'ok:0' and r2 like 'err:42501%' and r3 = 'ok:1' and r4 like 'err:%', r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
  r := xtests.run('authenticated', xtests.u('f04'), format('select description from public.meals where id = %L', xtests.m('aa06')));
  perform xtests.rec('K03', 'product', 'a meal description is shown when the kitchen wrote one', r = 'Poulet grillé, riz complet, légumes rôtis.', r);
end $$;

do $$ declare r text; r2 text; o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid(); begin
  -- Popularity from real received orders only (historical counter orders included when they have a customer).
  insert into public.orders (id, order_number, total, status, user_id) values
    (o1, 'POP-1', 50, 'served', xtests.u('f01')), (o2, 'POP-2', 50, 'served', xtests.u('f02')), (o3, 'POP-3', 50, 'new', xtests.u('f05'));
  insert into public.order_items (order_id, meal_id, meal_name, quantity, price) values
    (o1, xtests.m('aa03'), 'Meal B', 1, 35), (o2, xtests.m('aa03'), 'Meal B', 2, 35), (o3, xtests.m('aa03'), 'Meal B', 1, 35);
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.meal_popularity(%L)', xtests.m('aa03')));
  r2 := xtests.run('anon', null, format('select public.meal_popularity(%L)', xtests.m('aa03')));
  perform xtests.rec('K10', 'popularity', 'popularity = distinct customers who received the meal (counter orders served here; an order not received does not count); no anonymous access',
    r = '2' and r2 like 'err:42501%' and xtests.run('authenticated', xtests.u('f04'), format('select public.meal_popularity(%L)', xtests.m('aa06'))) = '0', r || ' | ' || r2);
  -- these legacy rows are test-only: remove them so they do not affect first-order eligibility
  delete from public.order_items where order_id in (o1, o2, o3);
  delete from public.orders where id in (o1, o2, o3);
end $$;

-- ---------------------------------------------------------------- phone numbers
do $$ declare bad text := ''; x record; begin
  for x in select * from (values ('06 12 34 56 78', '+212612345678'), ('0712345678', '+212712345678'), ('+212 6 12 34 56 78', '+212612345678'),
                                 ('00212612345678', '+212612345678'), ('212712345678', '+212712345678'), ('+212 (0)6-12-34-56-78', '+212612345678'),
                                 ('0522123456', null), ('0612', null), ('+33612345678', null), ('abc', null)) v(raw, want) loop
    if public.normalize_moroccan_mobile(x.raw) is distinct from x.want then bad := bad || x.raw || ' => ' || coalesce(public.normalize_moroccan_mobile(x.raw), 'null') || ' ; '; end if;
  end loop;
  perform xtests.rec('V01', 'phone', 'Moroccan mobile numbers (06/07) in any usual spelling are normalised to +2126/7XXXXXXXX; landlines, foreign and short numbers are refused', bad = '', nullif(bad, ''));
end $$;

do $$ declare r text; r2 text; r3 text; r4 text; j jsonb; begin
  r := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)', xtests.u('f04'), '0522123456'));
  j := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)::text', xtests.u('f04'), '0612345678'))::jsonb;
  r2 := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)', xtests.u('f04'), '0612345678'));
  perform xtests.rec('V02', 'phone', 'a code is issued only for a valid mobile number, once per minute; the code is 6 digits and only its hash is stored',
    r like 'err:22023:invalid phone number%' and j ->> 'code' ~ '^[0-9]{6}$' and j ->> 'phone_e164' = '+212612345678' and r2 like 'err:54000:too many codes%'
    and not exists (select 1 from public.phone_verifications where code_hash = j ->> 'code'), r || ' | ' || r2);
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id', j ->> 'code'));
  perform xtests.rec('V03', 'phone', 'a code the provider has not accepted cannot verify the number', r::jsonb ->> 'reason' = 'not_sent', r);
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_issue(%L, %L)', xtests.u('f04'), '0612345678'));
  r2 := xtests.run('authenticated', xtests.u('f04'), 'select count(*) from public.phone_verifications');
  r3 := xtests.run('authenticated', xtests.u('f04'), format($q$update public.user_profiles set phone_e164 = '+212612345678', phone_verified_at = now() where user_id = %L$q$, xtests.u('f04')));
  r4 := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_mark(%L, true, %L, %L)', j ->> 'verification_id', 'x', 'x'));
  perform xtests.rec('V04', 'phone', 'a customer can neither issue nor mark codes, read verifications, nor set a verified number directly',
    r like 'err:42501%' and r2 like 'err:42501%' and r3 like 'err:42501%' and r4 like 'err:42501%'
    and (select phone_verified_at from public.user_profiles where user_id = xtests.u('f04')) is null, r || ' | ' || r2 || ' | ' || r3 || ' | ' || r4);
  -- Provider failure: never verified.
  perform xtests.run('service_role', null, format('select public.phone_otp_mark(%L, false, %L, %L)', j ->> 'verification_id', 'test_whatsapp', 'provider error 503'));
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id', j ->> 'code'));
  perform xtests.rec('V05', 'phone', 'when the provider fails the code is marked failed and never verifies the number',
    r::jsonb ->> 'reason' = 'not_sent' and (select status from public.phone_verifications where id = (j ->> 'verification_id')::uuid) = 'failed', r);
end $$;

do $$ declare r text; r2 text; j jsonb; i int; begin
  update public.phone_verifications set created_at = created_at - interval '2 hours' where user_id = xtests.u('f04');
  j := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)::text', xtests.u('f04'), '06 12 34 56 78'))::jsonb;
  perform xtests.run('service_role', null, format('select public.phone_otp_mark(%L, true, %L, %L)', j ->> 'verification_id', 'test_whatsapp', 'wamid.1'));
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id',
         case when j ->> 'code' = '000000' then '111111' else '000000' end));
  r2 := xtests.run('authenticated', xtests.u('f05'), format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id', j ->> 'code'));
  perform xtests.rec('V06', 'phone', 'a wrong code is counted (4 attempts left); another customer cannot use this code',
    r::jsonb ->> 'reason' = 'wrong_code' and (r::jsonb ->> 'attempts_left')::int = 4 and r2 like 'err:42501%', r || ' | ' || r2);
  for i in 1 .. 4 loop
    perform xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_verify(%L, %L)', j ->> 'verification_id',
              case when j ->> 'code' = '000000' then '111111' else '000000' end));
  end loop;
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id', j ->> 'code'));
  perform xtests.rec('V07', 'phone', 'after 5 wrong codes even the right code is refused', r::jsonb ->> 'reason' = 'too_many_attempts', r);
  update public.phone_verifications set created_at = created_at - interval '2 hours' where user_id = xtests.u('f04');
  j := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)::text', xtests.u('f04'), '0612345678'))::jsonb;
  perform xtests.run('service_role', null, format('select public.phone_otp_mark(%L, true, %L, %L)', j ->> 'verification_id', 'test_whatsapp', 'wamid.2'));
  update public.phone_verifications set expires_at = now() - interval '1 second' where id = (j ->> 'verification_id')::uuid;
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.phone_otp_verify(%L, %L)::text', j ->> 'verification_id', j ->> 'code'));
  perform xtests.rec('V08', 'phone', 'an expired code (10 minutes) is refused', r::jsonb ->> 'reason' = 'expired', r);
  r := xtests.verify_phone(xtests.u('f04'), '0612345678');
  perform xtests.rec('V09', 'phone', 'the right code verifies the number: stored normalised with its date, audited (no full number in the audit)',
    r::jsonb ->> 'ok' = 'true' and (select phone_e164 = '+212612345678' and phone_verified_at is not null from public.user_profiles where user_id = xtests.u('f04'))
    and exists (select 1 from public.security_audit_log where action = 'phone_verified' and target_user_id = xtests.u('f04') and details ->> 'phone_suffix' = '78'
                and details::text not like '%612345678%'), r);
  -- Hourly limits (5 per customer).
  for i in 1 .. 5 loop
    update public.phone_verifications set created_at = created_at - interval '61 seconds' where user_id = xtests.u('f05');
    r := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)', xtests.u('f05'), '0700000001'));
  end loop;
  update public.phone_verifications set created_at = created_at - interval '61 seconds' where user_id = xtests.u('f05');
  r := xtests.run('service_role', null, format('select public.phone_otp_issue(%L, %L)', xtests.u('f05'), '0700000001'));
  perform xtests.rec('V10', 'phone', 'at most 5 codes per hour per customer', r like 'err:54000:too many codes: try again in an hour%', r);
end $$;

-- ---------------------------------------------------------------- price preview and validation
do $$ declare r text; r2 text; r3 text; j jsonb; bad text := ''; t text; begin
  perform xtests.quote(xtests.u('f04'), 5000);
  j := xtests.preview(xtests.u('f04'), format('[{"meal_id":"%s","quantity":1},{"meal_id":"%s","quantity":1}]', xtests.m('aa06'), xtests.m('aa03')))::jsonb;
  perform xtests.rec('P10', 'fees', 'owner example, first order: products 100 (65 + 35), service 0, delivery 0 (5 km quote 16), total 100',
    (j ->> 'products_subtotal')::numeric = 100 and (j ->> 'service_fee')::numeric = 0 and (j ->> 'delivery_fee')::numeric = 0
    and (j ->> 'service_fee_before_discount')::numeric = 3 and (j ->> 'delivery_fee_before_discount')::numeric = 16
    and (j ->> 'first_order')::boolean and (j ->> 'total')::numeric = 100 and (j -> 'phone' ->> 'verified')::boolean
    and j ? 'quote_id' = false and j ? 'pricing_policy_id' = false, j::text);
  j := xtests.preview(xtests.u('f04'), format('[{"meal_id":"%s","quantity":2,"option_ids":["00000000-0000-0000-0000-0000000000b1","00000000-0000-0000-0000-0000000000b3","00000000-0000-0000-0000-0000000000b4","00000000-0000-0000-0000-0000000000b6"],"price":1,"total":1}]', xtests.m('aa07')))::jsonb;
  perform xtests.rec('P11', 'options', 'choices are priced by the server: (50 + 5 + 4.50) x 2 = 119.00; the line lists every choice; client prices are ignored',
    (j ->> 'products_subtotal')::numeric = 119 and (j -> 'lines' -> 0 ->> 'unit_price')::numeric = 59.5
    and (select string_agg(x ->> 'name', ',') from jsonb_array_elements(j -> 'lines' -> 0 -> 'options') x) = 'Harissa,Fromage,Oeuf,Sans oignon', j::text);
  foreach t in array array[
    format('[{"meal_id":"%s","quantity":1}]', xtests.m('aa07')),                                                                 -- required sauce missing
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b1","00000000-0000-0000-0000-0000000000b2"]}]', xtests.m('aa07')), -- two sauces
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b1","00000000-0000-0000-0000-0000000000b3","00000000-0000-0000-0000-0000000000b4","00000000-0000-0000-0000-0000000000b5"]}]', xtests.m('aa07')), -- three extras
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b7"]}]', xtests.m('aa07')),           -- unavailable choice
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b8","00000000-0000-0000-0000-0000000000b1"]}]', xtests.m('aa07')), -- inactive group
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b1"]}]', xtests.m('aa06')),           -- choice of another meal
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b1","00000000-0000-0000-0000-0000000000b1"]}]', xtests.m('aa07')), -- duplicate id
    format('[{"meal_id":"%s","quantity":1,"option_ids":"x"}]', xtests.m('aa07')),
    format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b1"]},{"meal_id":"%s","quantity":2,"option_ids":["00000000-0000-0000-0000-0000000000b1"]}]', xtests.m('aa07'), xtests.m('aa07'))] loop
    r := xtests.preview(xtests.u('f04'), t);
    if r not like 'err:22023%' then bad := bad || t || ' => ' || r || ' ; '; end if;
  end loop;
  perform xtests.rec('P12', 'options', 'refused: required choice missing, too many in a group, unavailable choice, inactive group, choice of another meal, duplicates, same meal with the same choices twice',
    bad = '', nullif(bad, ''));
  r := xtests.preview(xtests.u('f04'), format('[{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b1"]},{"meal_id":"%s","quantity":1,"option_ids":["00000000-0000-0000-0000-0000000000b2","00000000-0000-0000-0000-0000000000b3"]}]', xtests.m('aa07'), xtests.m('aa07')));
  perform xtests.rec('P13', 'options', 'the same meal with different choices is two lines: 50 + 55 = 105', (r::jsonb ->> 'products_subtotal')::numeric = 105, r);
  r := xtests.preview(xtests.u('f03'), format('[{"meal_id":"%s","quantity":1}]', xtests.m('aa03')));
  r2 := xtests.preview(xtests.u('f05'), format('[{"meal_id":"%s","quantity":1}]', xtests.m('aa03')));
  r3 := xtests.run('anon', null, format('select public.checkout_preview(%L, %L::jsonb, null)', xtests.ka(), '[]'));
  perform xtests.rec('P14', 'zone', 'outside a served city: refused; no road distance yet: refused (no fee is guessed); anonymous: refused',
    r like 'err:22023:delivery is not available in your city yet%' and r2 like 'err:55000:delivery quote required%' and r3 like 'err:42501%', r || ' | ' || r2 || ' | ' || r3);
end $$;

-- ---------------------------------------------------------------- orders: first, second, phone, total shown
do $$ declare r text; r2 text; o public.orders%rowtype; n0 bigint; items text := format('[{"meal_id":"%s","quantity":1},{"meal_id":"%s","quantity":1}]', xtests.m('aa06'), xtests.m('aa03')); begin
  perform xtests.quote(xtests.u('f05'), 5000);
  n0 := (select count(*) from public.orders);
  r := xtests.run('authenticated', xtests.u('f05'), xtests.order_sql(items, 100));
  perform xtests.rec('O20', 'phone', 'without a verified phone number no order is created', r like 'err:22023:a verified phone number is required%' and (select count(*) from public.orders) = n0, r);
  r := xtests.run('authenticated', xtests.u('f04'), xtests.order_sql(items, null));
  r2 := xtests.run('authenticated', xtests.u('f04'), xtests.order_sql(items, 99));
  perform xtests.rec('O21', 'total', 'the order needs the total the customer saw; a different total is refused (40001) and nothing is written',
    r like 'err:22023:the total shown to the customer is required%' and r2 like 'err:40001:the order total changed (100.00 MAD instead of 99 MAD)%'
    and (select count(*) from public.orders) = n0 and (select count(*) from public.promotion_redemptions where user_id = xtests.u('f04')) = 0, r || ' | ' || r2);
  r := xtests.order(xtests.u('f04'), items);
  insert into xtests.o values ('first', r::uuid);
  select * into o from public.orders where id = r::uuid;
  perform xtests.rec('O22', 'fees', 'first qualifying order: products 100, service 0 (3 waived), delivery 0 (16 waived), total = cash due = 100; verified phone on the order',
    o.subtotal = 100 and o.platform_service_fee = 0 and o.service_fee_before_discount = 3 and o.service_fee_discount = 3
    and o.delivery_fee = 0 and o.delivery_fee_before_discount = 16 and o.delivery_discount = 16 and o.total = 100
    and o.payment_method = 'cash' and o.payment_status = 'pending' and o.delivery_phone = '+212612345678'
    and exists (select 1 from public.security_audit_log where action = 'order_created' and details ->> 'order_id' = o.id::text and (details ->> 'first_order')::boolean),
    format('sub=%s svc=%s/%s dlv=%s/%s total=%s', o.subtotal, o.platform_service_fee, o.service_fee_before_discount, o.delivery_fee, o.delivery_fee_before_discount, o.total));
  perform xtests.quote(xtests.u('f04'), 5000);
  r := xtests.order(xtests.u('f04'), items);
  insert into xtests.o values ('second', r::uuid);
  select * into o from public.orders where id = r::uuid;
  perform xtests.rec('O23', 'fees', 'owner example, second order: 100 + service 3 + delivery 16 = 119',
    o.subtotal = 100 and o.platform_service_fee = 3 and o.service_fee_discount = 0 and o.delivery_fee = 16 and coalesce(o.delivery_discount, 0) = 0 and o.total = 119
    and o.service_fee_ht = 2.50 and o.service_fee_tva = 0.50, format('svc=%s dlv=%s total=%s', o.platform_service_fee, o.delivery_fee, o.total));
end $$;

do $$ declare r text; r2 text; j jsonb; o public.orders%rowtype; items text := format('[{"meal_id":"%s","quantity":2,"option_ids":["00000000-0000-0000-0000-0000000000b2","00000000-0000-0000-0000-0000000000b5"],"notes":"Bien cuit"}]', xtests.m('aa07')); begin
  -- A cancelled first order does not use the benefit.
  perform xtests.verify_phone(xtests.u('f02'), '0700000002');
  perform xtests.quote(xtests.u('f02'), 3000);
  r := xtests.order(xtests.u('f02'), items);
  r2 := xtests.run('authenticated', xtests.u('f02'), format('select public.order_cancel(%L, null)', r));
  perform xtests.quote(xtests.u('f02'), 3000);
  j := xtests.preview(xtests.u('f02'), items)::jsonb;
  perform xtests.rec('O24', 'fees', 'a cancelled first order releases the benefit: the next order is again free of service and delivery fees',
    r2 = 'changed' and (j ->> 'first_order')::boolean and (j ->> 'service_fee')::numeric = 0 and (j ->> 'delivery_fee')::numeric = 0, r2 || ' | ' || j::text);
  r := xtests.order(xtests.u('f02'), items);
  insert into xtests.o values ('choices', r::uuid);
  perform xtests.rec('O25', 'snapshot', 'the line keeps its choices, their unit price and the note: (50 + 0 + 8) x 2 = 116',
    (select options_unit_price = 8 and price = 50 and line_total_ttc = 116 and notes = 'Bien cuit'
            and (select string_agg(x ->> 'group' || ':' || (x ->> 'name') || ':' || (x ->> 'price'), ',') from jsonb_array_elements(options) x) = 'Sauce:Algérienne:0.00,Suppléments:Avocat:8.00'
       from public.order_items where order_id = r::uuid), r);
  r2 := xtests.run('authenticated', xtests.u('f02'), xtests.order_sql(items, 116, null, (select client_request_id from public.orders where id = r::uuid)));
  perform xtests.rec('O26', 'idempotency', 'the same request id returns the same order', r2 = r, r2);
  r2 := xtests.run('postgres', null, format($q$update public.order_items set options = '[]', options_unit_price = 0 where order_id = %L$q$, r));
  perform xtests.rec('O27', 'tampering', 'choices and their prices on a created line never change, even for the owner role', r2 like 'err:42501%', r2);
end $$;

-- ---------------------------------------------------------------- promo codes
do $$ declare r text; r2 text; j jsonb; items text; begin
  items := format('[{"meal_id":"%s","quantity":1},{"meal_id":"%s","quantity":1}]', xtests.m('aa06'), xtests.m('aa03'));
  perform xtests.quote(xtests.u('f04'), 5000);
  j := xtests.preview(xtests.u('f04'), items, 'nope42')::jsonb;
  r := xtests.run('authenticated', xtests.u('f04'), xtests.order_sql(items, 119, 'NOPE42'));
  perform xtests.rec('R01', 'promo', 'an unknown code is reported (not raised) and counted; create_order refuses a code that was not checked successfully',
    j -> 'promo' ->> 'status' = 'invalid' and (j ->> 'total')::numeric = 119
    and exists (select 1 from public.promo_code_attempts where user_id = xtests.u('f04') and code = 'NOPE42' and outcome = 'invalid')
    and r like 'err:22023:check the promo code before ordering%', r);
  j := xtests.preview(xtests.u('f04'), items, 'FIRST_ORDER_FREE_DELIVERY')::jsonb;
  r := xtests.run('authenticated', xtests.u('a1'), $q$insert into public.promotions (code, kind, audience, is_active, percent_off) values ('HACK', 'percent_off', 'code', true, 100)$q$);
  perform xtests.rec('R02', 'promo', 'the first-order offer is not a code; no client (not even an admin) creates codes', j -> 'promo' ->> 'status' = 'invalid' and r like 'err:42501%', r);
  insert into public.promotions (code, kind, audience, is_active, percent_off, max_discount, min_order_subtotal, description)
  values ('TEST10', 'percent_off', 'code', true, 10, 8, 50, 'TEST ONLY');
  j := xtests.preview(xtests.u('f04'), items, ' test10 ')::jsonb;
  perform xtests.rec('R03', 'promo', 'a valid 10 % code (cap 8, minimum 50): discount 8 (10 % of 100 capped); total 100 - 8 + 3 + 16 = 111; audited',
    j -> 'promo' ->> 'status' = 'valid' and (j -> 'promo' ->> 'discount')::numeric = 8 and (j ->> 'total')::numeric = 111
    and exists (select 1 from public.security_audit_log where action = 'promotion_insert' and details ->> 'code' = 'TEST10'), j::text);
  r := xtests.order(xtests.u('f04'), items, 'test10');
  insert into xtests.o values ('promo', r::uuid);
  perform xtests.rec('R04', 'promo', 'the order keeps the code and the 8 MAD discount shared over the lines (5.20 + 2.80); TVA on the net amounts; one redemption',
    (select total = 111 and promo_discount = 8 and promotion_code = 'TEST10' from public.orders where id = r::uuid)
    and (select string_agg(line_discount::text, ',' order by line_total_ttc desc) from public.order_items where order_id = r::uuid) = '5.20,2.80'
    and (select sum(line_ht + line_tva) from public.order_items where order_id = r::uuid) = 92
    and (select count(*) from public.promotion_redemptions pr join public.promotions p on p.id = pr.promotion_id where p.code = 'TEST10' and pr.status = 'applied') = 1, r);
  perform xtests.quote(xtests.u('f04'), 5000);
  j := xtests.preview(xtests.u('f04'), items, 'TEST10')::jsonb;
  perform xtests.rec('R05', 'promo', 'a code is used once per customer', j -> 'promo' ->> 'status' = 'already_used', j::text);
  r2 := xtests.run('authenticated', xtests.u('f04'), format('select public.order_cancel(%L, null)', r));
  j := xtests.preview(xtests.u('f04'), items, 'TEST10')::jsonb;
  perform xtests.rec('R06', 'promo', 'cancelling the order releases its code', r2 = 'changed' and j -> 'promo' ->> 'status' = 'valid', r2 || ' | ' || j::text);
end $$;

do $$ declare j jsonb; r text; items text := format('[{"meal_id":"%s","quantity":1}]', xtests.m('aa03')); bad text := ''; begin
  perform xtests.quote(xtests.u('f04'), 5000);
  insert into public.promotions (code, kind, audience, is_active, amount_off, starts_at, description) values ('LATER', 'amount_off', 'code', true, 5, now() + interval '1 day', 'TEST');
  insert into public.promotions (code, kind, audience, is_active, amount_off, ends_at, starts_at, description) values ('OVER', 'amount_off', 'code', true, 5, now() - interval '1 hour', now() - interval '2 days', 'TEST');
  insert into public.promotions (code, kind, audience, is_active, amount_off, applicable_meal_ids, description) values ('ONLYA', 'amount_off', 'code', true, 5, array[xtests.m('aa06')], 'TEST');
  insert into public.promotions (code, kind, audience, is_active, amount_off, max_redemptions, description) values ('ONEUSE', 'amount_off', 'code', true, 5, 1, 'TEST');
  insert into public.promotions (code, kind, audience, is_active, amount_off, description) values ('OFF', 'amount_off', 'code', false, 5, 'TEST');
  insert into public.promotions (code, kind, audience, is_active, amount_off, description) values ('BIG', 'amount_off', 'code', true, 500, 'TEST');
  if xtests.preview(xtests.u('f04'), items, 'LATER')::jsonb -> 'promo' ->> 'status' <> 'not_started' then bad := bad || 'LATER '; end if;
  if xtests.preview(xtests.u('f04'), items, 'OVER')::jsonb -> 'promo' ->> 'status' <> 'expired' then bad := bad || 'OVER '; end if;
  if xtests.preview(xtests.u('f04'), items, 'ONLYA')::jsonb -> 'promo' ->> 'status' <> 'not_applicable' then bad := bad || 'ONLYA '; end if;
  if xtests.preview(xtests.u('f04'), items, 'OFF')::jsonb -> 'promo' ->> 'status' <> 'invalid' then bad := bad || 'OFF '; end if;
  if xtests.preview(xtests.u('f04'), items, 'TEST10')::jsonb -> 'promo' ->> 'status' <> 'minimum_not_reached' then bad := bad || 'TEST10 '; end if;
  j := xtests.preview(xtests.u('f04'), items, 'BIG')::jsonb;
  if (j -> 'promo' ->> 'discount')::numeric <> 35 or (j ->> 'total')::numeric <> 19 then bad := bad || 'BIG ' || j::text; end if;
  -- ONEUSE: used by f02, then exhausted for f04.
  perform xtests.quote(xtests.u('f02'), 5000);
  perform xtests.preview(xtests.u('f02'), items, 'ONEUSE');
  r := xtests.order(xtests.u('f02'), items, 'ONEUSE');
  if r !~ '^[0-9a-f-]{36}$' then bad := bad || 'ONEUSE order ' || r; end if;
  if xtests.preview(xtests.u('f04'), items, 'ONEUSE')::jsonb -> 'promo' ->> 'status' <> 'exhausted' then bad := bad || 'ONEUSE '; end if;
  perform xtests.rec('R07', 'promo', 'refused codes: not started, expired, not for these meals, inactive, below minimum, usage limit reached; a discount never exceeds the products (500 off 35 -> 35)',
    bad = '', nullif(bad, ''));
  -- Not combinable with the first-order benefit unless the code says so.
  perform xtests.verify_phone(xtests.u('f01'), '0700000003');
  perform xtests.quote(xtests.u('f01'), 5000);
  j := xtests.preview(xtests.u('f01'), items, 'BIG')::jsonb;
  update public.promotions set stackable_with_first_order = true where code = 'BIG';
  r := xtests.preview(xtests.u('f01'), items, 'BIG');
  perform xtests.rec('R08', 'promo', 'on a first order a code applies only when the code allows it (stacking is a rule of the code)',
    j -> 'promo' ->> 'status' = 'not_combinable' and r::jsonb -> 'promo' ->> 'status' = 'valid' and (r::jsonb ->> 'total')::numeric = 0, j::text || ' | ' || r);
  r := xtests.run('postgres', null, $q$insert into public.promotions (code, kind, audience, is_active, description) values ('bad code', 'amount_off', 'code', true, 'x')$q$);
  perform xtests.rec('R09', 'promo', 'a code needs an upper-case shape and its amount or percentage', r like 'err:23514%', r);
end $$;

do $$ declare j jsonb; i int; items text := format('[{"meal_id":"%s","quantity":1}]', xtests.m('aa03')); begin
  for i in 1 .. 10 loop perform xtests.preview(xtests.u('f05'), items, 'GUESS' || i); end loop;
  j := xtests.run('authenticated', xtests.u('f05'), format('select public.checkout_preview(%L, %L::jsonb, %L)::text', xtests.ka(), items, 'BIG'))::jsonb;
  perform xtests.rec('R10', 'promo', 'after 10 refused codes in 15 minutes even a real code is not checked (guessing is rate-limited)',
    j -> 'promo' ->> 'status' = 'rate_limited' and (j -> 'promo' ->> 'discount')::numeric = 0, j::text);
end $$;

-- ---------------------------------------------------------------- visibility and COD lifecycle
do $$ declare r text := ''; r2 text; r3 text; o uuid := (select id from xtests.o where name = 'second'); begin
  r2 := xtests.run('authenticated', xtests.u('d2'), format('select delivery_phone from public.orders where id = %L', o));
  r := r || xtests.run('authenticated', xtests.u('e0c1'), format('select public.order_confirm(%L)', o)) || ',';
  r := r || (select payment_status from public.orders where id = o) || ',';
  r := r || xtests.run('authenticated', xtests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'preparing')) || ',';
  r := r || xtests.run('authenticated', xtests.u('e0b1'), format('select public.order_kitchen_update(%L, %L)', o, 'ready')) || ',';
  r := r || xtests.run('authenticated', xtests.u('e0c1'), format('select public.order_assign_driver(%L, %L)', o, xtests.u('d1'))) || ',';
  r3 := xtests.run('authenticated', xtests.u('d1'), format('select delivery_phone from public.orders where id = %L', o));
  r := r || xtests.run('authenticated', xtests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'picked_up')) || ',';
  r := r || xtests.run('authenticated', xtests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'on_the_way')) || ',';
  r := r || xtests.run('authenticated', xtests.u('d1'), format('select public.order_driver_update(%L, %L)', o, 'delivered')) || ',';
  r := r || xtests.run('authenticated', xtests.u('e0c1'), format('select public.order_set_payment(%L, %L)', o, 'paid'));
  perform xtests.rec('L40', 'cod', 'cash on delivery unchanged: confirmation leaves payment pending; kitchen, driver, payment after delivery; total 119 kept',
    r = 'changed,pending,changed,changed,changed,changed,changed,changed,changed'
    and (select status = 'delivered' and payment_status = 'paid' and total = 119 from public.orders where id = o), r);
  perform xtests.rec('L41', 'privacy', 'the verified phone is visible to the assigned driver; an unassigned driver does not see the order',
    r3 = '+212612345678' and r2 = '<null>', r3 || ' | ' || r2);
  r := xtests.run('authenticated', xtests.u('f04'), format('select public.meal_popularity(%L)', xtests.m('aa06')));
  perform xtests.rec('L42', 'popularity', 'the delivered order now counts for its meals (1 customer)', r = '1', r);
end $$;
