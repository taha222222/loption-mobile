-- =====================================================================
-- V1 onboarding / first-order offer tests. DISPOSABLE DATABASE ONLY
-- (run_v1_onboarding_offer.sh). Runs after the Phase 1C core migration
-- and 20261028120000_v1_onboarding_first_order_offer.sql.
-- Each test acts the way PostgREST does (SET ROLE + request.jwt.claims),
-- attempts an action, then checks the resulting state as postgres.
-- These are local PostgreSQL results, not tests of the hosted API.
--
-- Fixture users (created by the runner):
--   ...00e1n1  new customer, profile without answers, no orders
--   ...00e1n2  signed up, no profile yet
--   ...00e1n3  new customer used for offer enforcement
--   ...00e1n4  legacy customer onboarded before the migration (backfill)
--   ...0000c1  Phase 1C fixture customer with historical orders
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists v1tests;
create table if not exists v1tests.results (
  id text primary key, area text, expectation text, passed boolean, detail text);
truncate v1tests.results;

create or replace function v1tests.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function v1tests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function v1tests.attempt(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;

create or replace function v1tests.scalar(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return 'err:' || sqlstate;
end $$;

create or replace function v1tests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into v1tests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
grant usage on schema v1tests to anon, authenticated, service_role;
grant execute on all functions in schema v1tests to anon, authenticated, service_role;

-- ============================ Nutrition ============================
do $$ declare r text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r := v1tests.attempt($q$update public.user_profiles set gender = 'man', age = 30, weight = 70, height = 175,
                          activity_level = 'moderate' where user_id = '00000000-0000-0000-0000-0000000e1001'$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  -- 10*70 + 6.25*175 - 5*30 + 5 = 1648.75 -> 1649; * 1.55 = 2555.56 -> 2556
  perform v1tests.rec('N01', 'nutrition', 'server computes Mifflin-St Jeor BMR/TDEE for the male equation',
    r = 'ok:1' and p.bmr_kcal = 1649 and p.tdee_kcal = 2556 and p.nutrition_formula = 'mifflin_st_jeor_1990'
      and p.nutrition_calculated_at is not null,
    r || ' bmr=' || coalesce(p.bmr_kcal::text, 'null') || ' tdee=' || coalesce(p.tdee_kcal::text, 'null'));
end $$;

do $$ declare r text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r := v1tests.attempt($q$update public.user_profiles set gender = 'woman', age = 25, weight = 60, height = 165,
                          activity_level = 'sedentary' where user_id = '00000000-0000-0000-0000-0000000e1001'$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  -- 600 + 1031.25 - 125 - 161 = 1345.25 -> 1345; * 1.2 = 1614.3 -> 1614
  perform v1tests.rec('N02', 'nutrition', 'female equation and sedentary multiplier',
    r = 'ok:1' and p.bmr_kcal = 1345 and p.tdee_kcal = 1614, r || ' bmr=' || coalesce(p.bmr_kcal::text, 'null')
      || ' tdee=' || coalesce(p.tdee_kcal::text, 'null'));
end $$;

do $$ declare r text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r := v1tests.attempt($q$update public.user_profiles set gender = 'unspecified'
                          where user_id = '00000000-0000-0000-0000-0000000e1001'$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('N03', 'nutrition', 'no estimate is invented when the sex input is unspecified',
    r = 'ok:1' and p.bmr_kcal is null and p.tdee_kcal is null and p.nutrition_formula is null, r);
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r1 := v1tests.attempt($q$update public.user_profiles set age = 5 where user_id = auth.uid()$q$);
  r2 := v1tests.attempt($q$update public.user_profiles set age = -3 where user_id = auth.uid()$q$);
  r3 := v1tests.attempt($q$update public.user_profiles set weight = 0 where user_id = auth.uid()$q$);
  r4 := v1tests.attempt($q$update public.user_profiles set height = 400 where user_id = auth.uid()$q$);
  r5 := v1tests.attempt($q$update public.user_profiles set activity_level = 'couch' where user_id = auth.uid()$q$);
  r6 := v1tests.attempt($q$update public.user_profiles set gender = 'robot' where user_id = auth.uid()$q$);
  r7 := v1tests.attempt($q$update public.user_profiles set age = 101 where user_id = auth.uid()$q$);
  perform v1tests.reset();
  perform v1tests.rec('N04', 'nutrition', 'out-of-range or unknown answers are refused (22023)',
    r1 = 'err:22023' and r2 = 'err:22023' and r3 = 'err:22023' and r4 = 'err:22023' and r5 = 'err:22023'
      and r6 = 'err:22023' and r7 = 'err:22023',
    concat_ws(' ', r1, r2, r3, r4, r5, r6, r7));
end $$;

do $$ declare r1 text; r2 text; r3 text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r1 := v1tests.attempt($q$update public.user_profiles set bmr_kcal = 9999 where user_id = auth.uid()$q$);
  r2 := v1tests.attempt($q$update public.user_profiles set tdee_kcal = 9999 where user_id = auth.uid()$q$);
  r3 := v1tests.attempt($q$update public.user_profiles set nutrition_formula = 'x' where user_id = auth.uid()$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('N05', 'nutrition', 'clients cannot write derived nutrition columns',
    r1 = 'err:42501' and r2 = 'err:42501' and r3 = 'err:42501' and p.bmr_kcal is distinct from 9999,
    concat_ws(' ', r1, r2, r3));
end $$;

-- ============================ Onboarding ============================
do $$ declare r text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  update public.user_profiles set gender = null where user_id = '00000000-0000-0000-0000-0000000e1001';
  r := v1tests.attempt($q$update public.user_profiles set onboarding_completed_at = now() where user_id = auth.uid()$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('B01', 'onboarding', 'completion is refused while a required answer is missing',
    r = 'err:22023' and p.onboarding_completed_at is null, r);
end $$;

do $$ declare r text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r := v1tests.attempt($q$update public.user_profiles set gender = 'man', age = 30, weight = 70, height = 175,
                          activity_level = 'moderate', onboarding_completed_at = '2000-01-01'
                          where user_id = auth.uid()$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('B02', 'onboarding', 'completion is stamped by the server (client timestamp ignored)',
    r = 'ok:1' and p.onboarding_completed_at > now() - interval '1 minute', r || ' at=' || coalesce(p.onboarding_completed_at::text, 'null'));
end $$;

do $$ declare r1 text; r2 text; before timestamptz; p record; begin
  select onboarding_completed_at into before from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r1 := v1tests.attempt($q$update public.user_profiles set onboarding_completed_at = null where user_id = auth.uid()$q$);
  r2 := v1tests.attempt($q$update public.user_profiles set onboarding_completed_at = '2030-01-01' where user_id = auth.uid()$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('B03', 'onboarding', 'a client cannot clear or move its completion time',
    p.onboarding_completed_at = before, concat_ws(' ', r1, r2));
end $$;

do $$ declare r text; before int; begin
  select weight into before from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003';
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r := v1tests.attempt($q$update public.user_profiles set weight = 99 where user_id = '00000000-0000-0000-0000-0000000e1003'$q$);
  perform v1tests.reset();
  perform v1tests.rec('B04', 'authorization', 'a customer cannot update another customer''s profile',
    r = 'ok:0' and (select weight from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003') is not distinct from before, r);
end $$;

do $$ declare n_own int; n_other int; n_anon int; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  select count(*) into n_own from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  select count(*) into n_other from public.user_profiles where user_id <> '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.reset();
  perform v1tests.act('anon');
  n_anon := coalesce(nullif(v1tests.scalar('select count(*) from public.user_profiles'), 'err:42501')::int, 0);
  perform v1tests.reset();
  perform v1tests.rec('B05', 'authorization', 'a customer reads only their own profile; anon reads none',
    n_own = 1 and n_other = 0 and n_anon = 0, format('own=%s other=%s anon=%s', n_own, n_other, n_anon));
end $$;

do $$ declare r1 text; r2 text; r3 text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1002');
  r1 := v1tests.attempt($q$insert into public.user_profiles (user_id) values ('00000000-0000-0000-0000-0000000e1001')$q$);
  r2 := v1tests.attempt($q$insert into public.user_profiles (user_id, role, is_admin) values (auth.uid(), 'admin', true)$q$);
  r3 := v1tests.attempt($q$insert into public.user_profiles (user_id, bmr_kcal, first_order_offer_status, onboarding_completed_at)
                           values (auth.uid(), 9999, 'applied', null) on conflict (user_id) do nothing$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1002';
  perform v1tests.rec('B06', 'profile', 'a signed-up user creates only their own customer profile; derived fields are server-set',
    r1 like 'err:%' and r2 = 'err:42501' and r3 = 'ok:1' and p.role = 'customer' and not p.is_admin
      and p.bmr_kcal is null and p.first_order_offer_status = 'eligible',
    concat_ws(' ', r1, r2, r3, 'status=' || coalesce(p.first_order_offer_status, 'null')));
end $$;

do $$ declare r text; n int; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1002');
  r := v1tests.attempt($q$insert into public.user_profiles (user_id) values (auth.uid()) on conflict (user_id) do nothing$q$);
  perform v1tests.reset();
  select count(*) into n from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1002';
  perform v1tests.rec('B07', 'profile', 'repeated profile creation (e.g. second provider sign-in) creates no duplicate',
    r = 'ok:0' and n = 1, r || ' rows=' || n);
end $$;

do $$ declare p record; begin
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1004';
  perform v1tests.rec('B08', 'onboarding', 'legacy onboarded profile is backfilled as complete with an estimate',
    p.onboarding_completed_at is not null and p.bmr_kcal is not null and p.weight = 80,
    'at=' || coalesce(p.onboarding_completed_at::text, 'null') || ' bmr=' || coalesce(p.bmr_kcal::text, 'null'));
end $$;

-- ============================ Delivery address ============================
do $$ declare r1 text; r2 text; r3 text; r4 text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r1 := v1tests.attempt($q$update public.user_profiles set delivery_address = 'abc' where user_id = auth.uid()$q$);
  r2 := v1tests.attempt($q$update public.user_profiles set delivery_address = '12 Rue Exemple, Casablanca',
                           delivery_latitude = 33.57 where user_id = auth.uid()$q$);
  r3 := v1tests.attempt($q$update public.user_profiles set delivery_address = '  12 Rue Exemple, Casablanca  ',
                           delivery_latitude = 33.57, delivery_longitude = -7.59 where user_id = auth.uid()$q$);
  r4 := v1tests.attempt($q$update public.user_profiles set delivery_address_updated_at = '2000-01-01' where user_id = auth.uid()$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('A01', 'address', 'address validated (length, coordinate pair), trimmed, timestamped by the server',
    r1 = 'err:22023' and r2 = 'err:22023' and r3 = 'ok:1' and r4 = 'err:42501'
      and p.delivery_address = '12 Rue Exemple, Casablanca' and p.delivery_address_updated_at > now() - interval '1 minute',
    concat_ws(' ', r1, r2, r3, r4));
end $$;

do $$ declare r text; p record; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r := v1tests.attempt($q$update public.user_profiles set delivery_address = 'Résidence Atlas, Maarif, Casablanca',
                          delivery_latitude = null, delivery_longitude = null where user_id = auth.uid()$q$);
  perform v1tests.reset();
  select * into p from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('A02', 'address', 'manual address without coordinates is accepted (location denied fallback)',
    r = 'ok:1' and p.delivery_latitude is null and p.delivery_address like 'Résidence%', r);
end $$;

-- ============================ Offer: visibility and access ============================
do $$ declare s_new text; s_hist text; begin
  select first_order_offer_status into s_new from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  select first_order_offer_status into s_hist from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform v1tests.rec('O01', 'offer', 'a new customer is eligible; a customer with order history is not',
    s_new = 'eligible' and s_hist = 'not_eligible', format('new=%s history=%s', s_new, s_hist));
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1001');
  r1 := v1tests.scalar('select count(*) from public.promotions');
  r2 := v1tests.scalar('select count(*) from public.promotion_redemptions');
  r3 := v1tests.scalar($q$select public.apply_first_order_offer('00000000-0000-0000-0000-00000000a001')$q$);
  r4 := v1tests.scalar($q$select public.first_order_offer_status_for(auth.uid())$q$);
  r5 := v1tests.attempt($q$update public.user_profiles set first_order_offer_status = 'eligible' where user_id = auth.uid()$q$);
  r6 := v1tests.attempt($q$insert into public.promotion_redemptions (promotion_id, user_id, status, discount_amount)
                           select id, auth.uid(), 'released', 0 from public.promotions$q$);
  perform v1tests.reset();
  perform v1tests.rec('O02', 'offer', 'clients cannot read promotions/redemptions, call the enforcement functions or set the status',
    r1 = 'err:42501' and r2 = 'err:42501' and r3 = 'err:42501' and r4 = 'err:42501' and r5 = 'err:42501' and r6 = 'err:42501',
    concat_ws(' ', r1, r2, r3, r4, r5, r6));
end $$;

do $$ declare r1 text; r2 text; begin
  perform v1tests.act('anon');
  r1 := v1tests.scalar('select count(*) from public.promotions');
  r2 := v1tests.scalar($q$select public.estimate_energy('man', 30, 70, 175, 'moderate')$q$);
  perform v1tests.reset();
  perform v1tests.rec('O03', 'offer', 'anon has no access to promotions or functions', r1 = 'err:42501' and r2 = 'err:42501',
    concat_ws(' ', r1, r2));
end $$;

do $$ declare r1 text; r2 text; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1003');
  r1 := v1tests.attempt($q$insert into public.orders (order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
                          values ('X-N3', 60, 60, 0, 'confirmed', 'cash', auth.uid())$q$);
  r2 := v1tests.attempt($q$update public.orders set delivery_fee = 0 where user_id = auth.uid()$q$);
  perform v1tests.reset();
  perform v1tests.rec('O04', 'offer', 'a client cannot create an order or change a delivery fee directly (Phase 1C)',
    r1 = 'err:42501' and r2 in ('ok:0', 'err:42501')
      and not exists (select 1 from public.orders where order_number = 'X-N3'),
    concat_ws(' ', r1, r2));
end $$;

-- ============================ Offer: enforcement ============================
-- A failed checkout (the order transaction rolls back) consumes nothing.
do $$ declare st text; n int; begin
  begin
    insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
    values ('00000000-0000-0000-0000-0000000e30f0', 'N3-FAIL', 75, 60, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000e1003');
    perform public.apply_first_order_offer('00000000-0000-0000-0000-0000000e30f0');
    raise exception 'simulated checkout failure';
  exception when others then null;
  end;
  select first_order_offer_status into st from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003';
  select count(*) into n from public.promotion_redemptions where user_id = '00000000-0000-0000-0000-0000000e1003';
  perform v1tests.rec('E01', 'offer', 'a failed or abandoned checkout does not consume the offer',
    st = 'eligible' and n = 0, format('status=%s redemptions=%s', st, n));
end $$;

do $$ declare d numeric; o record; st text; begin
  insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
  values ('00000000-0000-0000-0000-0000000e3001', 'N3-1', 75, 60, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000e1003');
  perform v1tests.act('service_role');
  d := public.apply_first_order_offer('00000000-0000-0000-0000-0000000e3001');
  perform v1tests.reset();
  select * into o from public.orders where id = '00000000-0000-0000-0000-0000000e3001';
  select first_order_offer_status into st from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003';
  perform v1tests.rec('E02', 'offer', 'the first order gets free delivery, recorded on the order and the redemption',
    d = 15 and o.delivery_fee = 0 and o.delivery_discount = 15 and o.delivery_fee_before_discount = 15 and o.total = 60
      and st = 'applied'
      and (select count(*) from public.promotion_redemptions where user_id = '00000000-0000-0000-0000-0000000e1003' and status = 'applied') = 1,
    format('discount=%s fee=%s total=%s status=%s', d, o.delivery_fee, o.total, st));
end $$;

do $$ declare d numeric; n int; o record; begin
  d := public.apply_first_order_offer('00000000-0000-0000-0000-0000000e3001');
  select count(*) into n from public.promotion_redemptions where user_id = '00000000-0000-0000-0000-0000000e1003';
  select * into o from public.orders where id = '00000000-0000-0000-0000-0000000e3001';
  perform v1tests.rec('E03', 'offer', 'applying again to the same order (retry) is idempotent',
    d = 15 and n = 1 and o.delivery_fee = 0 and o.total = 60, format('discount=%s redemptions=%s total=%s', d, n, o.total));
end $$;

do $$ declare d numeric; o record; begin
  insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
  values ('00000000-0000-0000-0000-0000000e3002', 'N3-2', 75, 60, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000e1003');
  d := public.apply_first_order_offer('00000000-0000-0000-0000-0000000e3002');
  select * into o from public.orders where id = '00000000-0000-0000-0000-0000000e3002';
  perform v1tests.rec('E04', 'offer', 'a second order of the same account pays delivery',
    d = 0 and o.delivery_fee = 15 and o.delivery_discount = 0 and o.total = 75, format('discount=%s fee=%s', d, o.delivery_fee));
end $$;

do $$ declare d numeric; begin
  d := public.apply_first_order_offer('00000000-0000-0000-0000-00000000a001');
  perform v1tests.rec('E05', 'offer', 'an existing customer''s order is not discounted',
    d = 0 and (select delivery_fee from public.orders where id = '00000000-0000-0000-0000-00000000a001') = 15, 'discount=' || d);
end $$;

-- Release: the order carrying the offer reaches a release status. The
-- orders CHECK constraint has no cancelled/rejected yet (Phase 2), so the
-- mechanism is tested with a configured status inside a rolled-back block.
do $$ declare st_after text; red text; st_rb text; begin
  begin
    update public.promotions set release_on_order_statuses = array['cancelled', 'rejected', 'waiting_payment']
     where code = 'FIRST_ORDER_FREE_DELIVERY';
    delete from public.orders where id = '00000000-0000-0000-0000-0000000e3002';
    update public.orders set status = 'waiting_payment' where id = '00000000-0000-0000-0000-0000000e3001';
    select status into red from public.promotion_redemptions where order_id = '00000000-0000-0000-0000-0000000e3001';
    select first_order_offer_status into st_after from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003';
    raise exception 'rollback test block';
  exception when others then
    if sqlerrm <> 'rollback test block' then raise; end if;
  end;
  select first_order_offer_status into st_rb from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003';
  perform v1tests.rec('E06', 'offer', 'a released order (configured release status) makes the account eligible again',
    red = 'released' and st_after = 'eligible' and st_rb = 'applied', format('redemption=%s status=%s after-block=%s', red, st_after, st_rb));
end $$;

do $$ declare s1 text; s2 text; s3 text; begin
  update public.promotions set is_active = false where code = 'FIRST_ORDER_FREE_DELIVERY';
  select first_order_offer_status into s1 from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
  values ('00000000-0000-0000-0000-0000000e1f01', 'N1-OFF', 75, 60, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000e1001');
  s2 := public.apply_first_order_offer('00000000-0000-0000-0000-0000000e1f01')::text;
  delete from public.orders where id = '00000000-0000-0000-0000-0000000e1f01';
  update public.promotions set is_active = true where code = 'FIRST_ORDER_FREE_DELIVERY';
  select first_order_offer_status into s3 from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001';
  perform v1tests.rec('E07', 'offer', 'deactivating the promotion hides and stops it; reactivating restores eligibility',
    s1 = 'unavailable' and s2 = '0' and s3 = 'eligible', format('off=%s discount=%s on=%s', s1, s2, s3));
end $$;

do $$ declare d text; begin
  update public.promotions set min_order_subtotal = 100 where code = 'FIRST_ORDER_FREE_DELIVERY';
  insert into public.orders (id, order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
  values ('00000000-0000-0000-0000-0000000e1f02', 'N1-MIN', 75, 60, 15, 'confirmed', 'cash', '00000000-0000-0000-0000-0000000e1001');
  d := public.apply_first_order_offer('00000000-0000-0000-0000-0000000e1f02')::text;
  delete from public.orders where id = '00000000-0000-0000-0000-0000000e1f02';
  update public.promotions set min_order_subtotal = null where code = 'FIRST_ORDER_FREE_DELIVERY';
  perform v1tests.rec('E08', 'offer', 'a configured minimum subtotal is enforced (none is set by default)',
    d = '0' and (select min_order_subtotal from public.promotions where code = 'FIRST_ORDER_FREE_DELIVERY') is null
      and (select first_order_offer_status from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1001') = 'eligible',
    'discount=' || d);
end $$;

do $$ declare st text; red record; begin
  delete from public.orders where id = '00000000-0000-0000-0000-0000000e3001';
  select * into red from public.promotion_redemptions where user_id = '00000000-0000-0000-0000-0000000e1003';
  select first_order_offer_status into st from public.user_profiles where user_id = '00000000-0000-0000-0000-0000000e1003';
  perform v1tests.rec('E09', 'offer', 'deleting the order keeps the redemption: the benefit is not granted again',
    red.status = 'applied' and red.order_id is null and st = 'applied', format('redemption=%s status=%s', red.status, st));
end $$;

do $$ declare r text; begin
  perform v1tests.act('authenticated', '00000000-0000-0000-0000-0000000e1003');
  r := v1tests.scalar($q$select first_order_offer_status from public.user_profiles where user_id = auth.uid()$q$);
  perform v1tests.reset();
  perform v1tests.rec('E10', 'offer', 'the customer reads their own offer status (same value on every sign-in)', r = 'applied', r);
end $$;

select id, case when passed then 'PASS' else 'FAIL' end as result, area, expectation, detail
  from v1tests.results order by id;
