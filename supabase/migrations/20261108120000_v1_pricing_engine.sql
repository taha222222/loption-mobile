-- =====================================================================
-- L'OPTION V1 — pricing engine: road-distance delivery fee, fixed service
-- fee, TVA breakdown by tax category, and the order pricing snapshot.
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on 20261107120000_v1_delivery_zones.sql. The order workflow
-- migration (20261105120000) is not touched; create_order() is replaced
-- (rollback restores the delivery-zones version, generated).
-- Rollback: supabase/rollback/v1_pricing_engine_rollback.sql (archiving).
-- Specification: docs/v1/V1_PRICING_SPECIFICATION.md.
--
-- Owner-approved V1 pricing (2026-11-07), applied as DATA, not code:
--   service fee 3 MAD per order; delivery fee by trusted road distance d
--   (km) from the order's kitchen: D = round_half_up(min(25, max(10, 8 + 1.5 d))).
--   The values live in the kitchen's approved pricing_policies row (base,
--   per km, minimum, maximum, service fee, the kitchen's dispatch point).
--   NO row is created here: the owner inserts it with Kitchen A's location
--   (unknown to this repository). Until then create_order() refuses.
-- Not approved, therefore NOT implemented: a minimum order (removed), a
-- delivery radius or district limit (the 25 MAD cap is a fee cap, not a
-- coverage rule), any tax rate for the service and delivery fees.
--
-- Money: numeric with a fixed scale for every new amount (2 decimals MAD,
-- 3 decimals km, 4 decimals tax rate). Rounding policy (tested):
--   * delivery fee: round(x, 0) of the capped formula (PostgreSQL rounds
--     numeric half away from zero = half up for these positive amounts);
--   * product line TTC = round(unit TTC x quantity, 2);
--   * HT of an amount = round(TTC / (1 + rate), 2); TVA = TTC - HT, so
--     HT + TVA = TTC exactly for every line and fee;
--   * order HT and TVA = sums of the line values (no re-rounding).
-- TVA is included in the menu prices and in the fees: nothing is added at
-- checkout. Each tax category (restaurant food, service fee, delivery fee,
-- any other product category) has its own rate and status; create_order()
-- refuses until every category the order uses is approved (an accountant
-- decision). Seeded: restaurant_food 10 % proposed, service_fee and
-- delivery_fee without rate; all three 'pending_confirmation'.
--
-- Road distance: computed by the quote-delivery Edge Function (routing
-- provider, server side) and recorded through record_delivery_quote()
-- (service_role only). create_order() uses the customer's latest unused,
-- unexpired quote for the same kitchen, pricing row and address; the app
-- never sends a distance, fee, rate, tax or total. No quote (provider
-- down, invalid address) = no order (fail closed). Straight-line distance
-- is never used.
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 pricing engine: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_pricing_gate_ok (step text primary key) on commit drop;
create temp table v1_pricing_gate (
  step text constraint v1_pricing_engine_guard_did_not_pass references v1_pricing_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_pricing_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
begin
  if to_regclass('public.delivery_zones') is null then
    raise exception 'V1 pricing engine: the V1 delivery zones migration must be applied first; aborting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure)
     <> 'fc876c0897b2e23a59fe2cfecfcd3ad7' then
    raise exception 'V1 pricing engine: containment_violations() is not the reviewed monitor of the delivery zones migration; refusing';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 pricing engine: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  if to_regclass('public.tax_categories') is not null or to_regclass('public.delivery_quotes') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pricing_policies' and column_name = 'delivery_base_fee') then
    raise exception 'V1 pricing engine: already applied (re-run or unknown objects), refusing';
  end if;
  if exists (select 1 from public.pricing_policies) then
    raise exception 'V1 pricing engine: pricing_policies has rows; the pricing model changes shape only while no pricing exists. Refusing';
  end if;
  if exists (select 1 from public.orders where workflow_version is not null) then
    raise exception 'V1 pricing engine: workflow orders exist (created under the previous pricing model); refusing';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 pricing engine: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_pricing_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. Tax categories (server-only; accountant-approved rates)
-- ---------------------------------------------------------------------
create table public.tax_categories (
  code               text primary key check (code ~ '^[a-z][a-z_]{1,39}$'),
  label              text not null check (char_length(btrim(label)) between 2 and 80),
  applies_to         text not null check (applies_to in ('product', 'service_fee', 'delivery_fee')),
  rate               numeric(6,4) check (rate >= 0 and rate < 1),   -- 0.1000 = 10 %
  status             text not null check (status in ('pending_confirmation', 'approved')),
  approved_by        text,
  approval_reference text,
  approved_at        timestamptz,
  updated_at         timestamptz not null default now(),
  constraint tax_categories_approval check (
    status <> 'approved'
    or (rate is not null and char_length(btrim(coalesce(approved_by, ''))) >= 2
        and char_length(btrim(coalesce(approval_reference, ''))) >= 3 and approved_at is not null))
);
alter table public.tax_categories enable row level security;
revoke all on public.tax_categories from public, anon, authenticated, service_role;

create function public.tax_categories_audit()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tax categories are never deleted' using errcode = '42501';
  end if;
  new.updated_at := now();
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), 'tax_category_' || lower(tg_op), null,
          jsonb_build_object('code', new.code, 'rate', new.rate, 'status', new.status,
                             'previous_rate', case when tg_op = 'UPDATE' then old.rate end,
                             'previous_status', case when tg_op = 'UPDATE' then old.status end,
                             'approved_by', new.approved_by, 'approval_reference', new.approval_reference));
  return new;
end;
$$;
revoke all on function public.tax_categories_audit() from public, anon, authenticated, service_role;
create trigger trg_tax_categories_audit
  before insert or update or delete on public.tax_categories
  for each row execute function public.tax_categories_audit();
create trigger trg_tax_categories_no_truncate
  before truncate on public.tax_categories
  for each statement execute function public.tax_categories_audit();

insert into public.tax_categories (code, label, applies_to, rate, status) values
  ('restaurant_food', 'Restauration : plats et produits du menu', 'product', 0.1000, 'pending_confirmation'),
  ('service_fee', 'Frais de service', 'service_fee', null, 'pending_confirmation'),
  ('delivery_fee', 'Frais de livraison', 'delivery_fee', null, 'pending_confirmation');

-- Every menu item belongs to a product tax category.
alter table public.meals add column tax_category text not null default 'restaurant_food' references public.tax_categories(code);

-- ---------------------------------------------------------------------
-- 2. Pricing rows: road-distance formula and fixed service fee (the table
--    is empty; precondition). No minimum order (not approved).
-- ---------------------------------------------------------------------
alter table public.pricing_policies drop column delivery_fee, drop column minimum_subtotal;
alter table public.pricing_policies
  add column config_version            text not null check (config_version ~ '^[A-Za-z0-9._-]{2,40}$'),
  add column delivery_formula_version  text not null check (delivery_formula_version = 'v1_road_km'),
  add column delivery_base_fee         numeric(8,2) not null check (delivery_base_fee >= 0),
  add column delivery_per_km           numeric(8,2) not null check (delivery_per_km >= 0),
  add column delivery_min_fee          numeric(8,2) not null check (delivery_min_fee >= 0),
  add column delivery_max_fee          numeric(8,2) not null check (delivery_max_fee <= 500),
  add column service_fee_tax_category  text not null default 'service_fee' references public.tax_categories(code),
  add column delivery_fee_tax_category text not null default 'delivery_fee' references public.tax_categories(code),
  -- The kitchen's dispatch point: origin of every road distance for this kitchen.
  add column origin_latitude           double precision not null check (origin_latitude between -90 and 90),
  add column origin_longitude          double precision not null check (origin_longitude between -180 and 180),
  add constraint pricing_policies_fee_caps check (delivery_min_fee <= delivery_max_fee);
create unique index pricing_policies_config_version_once on public.pricing_policies (kitchen_id, config_version);

-- Same rule as before (never edited or deleted; every insert and
-- deactivation audited), with the new fields in the audit row.
create or replace function public.pricing_policies_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pricing policies are never deleted; deactivate the row instead' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') or (old.active = false and new.active = true) then
      raise exception 'a pricing policy is never edited: insert a new approved row and deactivate this one' using errcode = '42501';
    end if;
  end if;
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), case when tg_op = 'INSERT' then 'pricing_policy_approved' else 'pricing_policy_deactivated' end, null,
          jsonb_build_object('policy_id', new.id, 'kitchen_id', new.kitchen_id, 'config_version', new.config_version,
                             'service_fee', new.service_fee, 'delivery_base_fee', new.delivery_base_fee,
                             'delivery_per_km', new.delivery_per_km, 'delivery_min_fee', new.delivery_min_fee,
                             'delivery_max_fee', new.delivery_max_fee, 'formula', new.delivery_formula_version,
                             'approved_by', new.approved_by, 'approval_reference', new.approval_reference));
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Money functions (single source of the formulas)
-- ---------------------------------------------------------------------
-- D = round_half_up(min(max_fee, max(min_fee, base + per_km x d))), d > 0 km.
create function public.delivery_fee_v1(p_distance_km numeric, p_base numeric, p_per_km numeric, p_min numeric, p_max numeric)
returns numeric
language plpgsql immutable set search_path = ''
as $$
begin
  if p_distance_km is null or p_distance_km <= 0 then
    raise exception 'a delivery distance must be a positive road distance' using errcode = '22023';
  end if;
  return round(least(p_max, greatest(p_min, p_base + p_per_km * p_distance_km)), 0)::numeric(8,2);
end;
$$;
revoke all on function public.delivery_fee_v1(numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.delivery_fee_v1(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

-- HT and TVA of a tax-inclusive amount: HT = round(TTC / (1 + rate), 2), TVA = TTC - HT.
create function public.tax_split(p_ttc numeric, p_rate numeric, out ht numeric, out tva numeric)
language plpgsql immutable set search_path = ''
as $$
begin
  if p_ttc is null or p_rate is null or p_rate < 0 or p_rate >= 1 then
    raise exception 'tax_split needs an amount and a rate in [0, 1)' using errcode = '22023';
  end if;
  ht := round(p_ttc / (1 + p_rate), 2);
  tva := p_ttc - ht;
end;
$$;
revoke all on function public.tax_split(numeric, numeric) from public, anon;
grant execute on function public.tax_split(numeric, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Delivery quotes (road distance computed server side)
-- ---------------------------------------------------------------------
create table public.delivery_quotes (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  kitchen_id            uuid not null references public.kitchens(id),
  pricing_policy_id     uuid not null references public.pricing_policies(id),
  -- the customer's address as it was when the distance was computed
  address_text          text not null,
  address_latitude      double precision,
  address_longitude     double precision,
  destination_latitude  double precision not null check (destination_latitude between -90 and 90),
  destination_longitude double precision not null check (destination_longitude between -180 and 180),
  origin_latitude       double precision not null,
  origin_longitude      double precision not null,
  distance_km           numeric(8,3) not null check (distance_km > 0 and distance_km <= 200),
  delivery_fee          numeric(8,2) not null check (delivery_fee >= 0),
  formula_version       text not null,
  provider              text not null check (char_length(provider) between 2 and 40),
  created_at            timestamptz not null default clock_timestamp(),   -- several quotes in one transaction stay ordered
  expires_at            timestamptz not null,
  used_by_order         uuid references public.orders(id) on delete set null
);
create index delivery_quotes_user_idx on public.delivery_quotes (user_id, created_at desc);
alter table public.delivery_quotes enable row level security;
revoke all on public.delivery_quotes from public, anon, authenticated, service_role;

-- Internal: what a quote for this customer needs, or a clear refusal.
create function public.delivery_quote_scope(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  prof record;
  zone public.delivery_zones%rowtype;
  pol public.pricing_policies%rowtype;
begin
  select nullif(btrim(p.delivery_address), '') as address, p.delivery_latitude as lat, p.delivery_longitude as lng, p.delivery_city as city
    into prof from public.user_profiles p where p.user_id = p_user;
  if not found or prof.address is null then
    raise exception 'a confirmed delivery address is required' using errcode = '22023';
  end if;
  if prof.city is null then
    raise exception 'choose your delivery city' using errcode = '22023';
  end if;
  select * into zone from public.delivery_zones z where z.city_key = prof.city and z.active;
  if not found then
    raise exception 'delivery is not available in your city yet' using errcode = '22023';
  end if;
  select * into pol from public.pricing_policies p where p.kitchen_id = zone.kitchen_id and p.active;
  if not found then
    raise exception 'ordering is not open: pricing is not approved for this kitchen' using errcode = '55000';
  end if;
  return jsonb_build_object('kitchen_id', zone.kitchen_id, 'pricing_policy_id', pol.id, 'config_version', pol.config_version,
    'origin_latitude', pol.origin_latitude, 'origin_longitude', pol.origin_longitude,
    'address_text', prof.address, 'address_latitude', prof.lat, 'address_longitude', prof.lng, 'service_fee', pol.service_fee);
end;
$$;
revoke all on function public.delivery_quote_scope(uuid) from public, anon, authenticated, service_role;

create function public.delivery_quote_json(q public.delivery_quotes, p_service_fee numeric, p_config text)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('quote_id', q.id, 'kitchen_id', q.kitchen_id, 'distance_km', q.distance_km,
    'delivery_fee', q.delivery_fee, 'service_fee', p_service_fee, 'formula_version', q.formula_version,
    'config_version', p_config, 'expires_at', q.expires_at)
$$;
revoke all on function public.delivery_quote_json(public.delivery_quotes, numeric, text) from public, anon, authenticated, service_role;

-- For the quote-delivery Edge Function (service_role only): the origin and
-- destination to route, and a still-valid quote to reuse if there is one
-- (no new routing call for the same address within its validity).
create function public.delivery_quote_context(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s jsonb := public.delivery_quote_scope(p_user);
  q public.delivery_quotes%rowtype;
begin
  select * into q from public.delivery_quotes d
   where d.user_id = p_user and d.kitchen_id = (s ->> 'kitchen_id')::uuid
     and d.pricing_policy_id = (s ->> 'pricing_policy_id')::uuid and d.used_by_order is null and d.expires_at > now() + interval '2 minutes'
     and d.address_text = s ->> 'address_text'
     and d.address_latitude is not distinct from (s ->> 'address_latitude')::double precision
     and d.address_longitude is not distinct from (s ->> 'address_longitude')::double precision
   order by d.created_at desc limit 1;
  return s || jsonb_build_object('existing_quote',
    case when found then public.delivery_quote_json(q, (s ->> 'service_fee')::numeric, s ->> 'config_version') end);
end;
$$;
revoke all on function public.delivery_quote_context(uuid) from public, anon, authenticated;
grant execute on function public.delivery_quote_context(uuid) to service_role;

-- For the quote-delivery Edge Function (service_role only): records a road
-- distance computed by the routing provider. The fee is computed here, from
-- the active approved pricing row; the caller passes neither fee nor price.
create function public.record_delivery_quote(p_user uuid, p_pricing_policy uuid, p_address_text text, p_destination_latitude double precision,
                                             p_destination_longitude double precision, p_distance_m integer, p_provider text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s jsonb := public.delivery_quote_scope(p_user);
  pol public.pricing_policies%rowtype;
  km numeric;
  q public.delivery_quotes%rowtype;
begin
  if (s ->> 'pricing_policy_id')::uuid is distinct from p_pricing_policy then
    raise exception 'the pricing changed while the distance was computed; request a new quote' using errcode = '40001';
  end if;
  -- The distance belongs to the address that was routed: refuse if the
  -- customer changed it meanwhile.
  if (s ->> 'address_text') is distinct from p_address_text then
    raise exception 'the delivery address changed while the distance was computed; request a new quote' using errcode = '40001';
  end if;
  if p_distance_m is null or p_distance_m <= 0 or p_distance_m > 200000 then
    raise exception 'a delivery distance must be a positive road distance' using errcode = '22023';
  end if;
  if p_destination_latitude is null or p_destination_longitude is null
     or p_destination_latitude not between -90 and 90 or p_destination_longitude not between -180 and 180 then
    raise exception 'invalid destination' using errcode = '22023';
  end if;
  if p_provider is null or char_length(p_provider) not between 2 and 40 then
    raise exception 'unknown routing provider' using errcode = '22023';
  end if;
  select * into pol from public.pricing_policies where id = p_pricing_policy;
  km := round(p_distance_m::numeric / 1000, 3);
  insert into public.delivery_quotes (user_id, kitchen_id, pricing_policy_id, address_text, address_latitude, address_longitude,
                                      destination_latitude, destination_longitude, origin_latitude, origin_longitude,
                                      distance_km, delivery_fee, formula_version, provider, expires_at)
  values (p_user, pol.kitchen_id, pol.id, s ->> 'address_text', (s ->> 'address_latitude')::double precision,
          (s ->> 'address_longitude')::double precision, p_destination_latitude, p_destination_longitude,
          pol.origin_latitude, pol.origin_longitude, km,
          public.delivery_fee_v1(km, pol.delivery_base_fee, pol.delivery_per_km, pol.delivery_min_fee, pol.delivery_max_fee),
          pol.delivery_formula_version, p_provider, clock_timestamp() + interval '15 minutes')
  returning * into q;
  return public.delivery_quote_json(q, pol.service_fee, pol.config_version);
end;
$$;
revoke all on function public.record_delivery_quote(uuid, uuid, text, double precision, double precision, integer, text) from public, anon, authenticated;
grant execute on function public.record_delivery_quote(uuid, uuid, text, double precision, double precision, integer, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. Pricing snapshot columns (fixed scale; written only by create_order)
-- ---------------------------------------------------------------------
alter table public.order_items
  add column tax_category   text,
  add column tax_rate       numeric(6,4),
  add column line_total_ttc numeric(12,2),
  add column line_ht        numeric(12,2),
  add column line_tva       numeric(12,2);
alter table public.orders
  add column pricing_policy_id         uuid,
  add column pricing_config_version    text,
  add column delivery_quote_id         uuid,
  add column delivery_distance_km      numeric(8,3),
  add column delivery_formula_version  text,
  add column products_ht               numeric(12,2),
  add column products_tva              numeric(12,2),
  add column service_fee_tax_category  text,
  add column service_fee_tax_rate      numeric(6,4),
  add column service_fee_ht            numeric(12,2),
  add column service_fee_tva           numeric(12,2),
  add column delivery_fee_tax_category text,
  add column delivery_fee_tax_rate     numeric(6,4),
  add column delivery_fee_ht           numeric(12,2),
  add column delivery_fee_tva          numeric(12,2),
  add column priced_at                 timestamptz;

-- The tax snapshot of an order line never changes (the workflow migration's
-- guard already protects price, meal, name and quantity).
create function public.order_items_tax_snapshot_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.tax_category is distinct from old.tax_category or new.tax_rate is distinct from old.tax_rate
     or new.line_total_ttc is distinct from old.line_total_ttc or new.line_ht is distinct from old.line_ht
     or new.line_tva is distinct from old.line_tva then
    raise exception 'order lines keep their tax snapshot' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.order_items_tax_snapshot_guard() from public, anon, authenticated, service_role;
create trigger trg_order_items_tax_snapshot_guard
  before update on public.order_items
  for each row execute function public.order_items_tax_snapshot_guard();

-- ---------------------------------------------------------------------
-- 6. create_order(): delivery-zones version + pricing engine
-- ---------------------------------------------------------------------
create or replace function public.create_order(p_kitchen uuid, p_items jsonb, p_client_request_id uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing uuid;
  pol public.pricing_policies%rowtype;
  addr text;
  alat double precision;
  alng double precision;
  city text;
  zone public.delivery_zones%rowtype;
  quote public.delivery_quotes%rowtype;
  svc_cat public.tax_categories%rowtype;
  dlv_cat public.tax_categories%rowtype;
  line jsonb;
  m record;
  cat public.tax_categories%rowtype;
  qty integer;
  n_lines integer;
  oid uuid := gen_random_uuid();
  onum text;
  discount numeric;
  line_ttc numeric(12,2);
  split record;
  sub numeric(12,2) := 0;
  prod_ht numeric(12,2) := 0;
  prod_tva numeric(12,2) := 0;
  svc_split record;
  dlv_split record;
  final_delivery numeric;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  -- One request at a time per customer and request id: a retry waits, then
  -- finds the order the first call created.
  perform pg_advisory_xact_lock(hashtextextended('v1.create_order:' || uid::text || ':' || p_client_request_id::text, 0));
  select o.id into existing from public.orders o where o.user_id = uid and o.client_request_id = p_client_request_id;
  if found then
    return existing;
  end if;

  if exists (select 1 from public.staff_roles s where s.user_id = uid and s.is_active) then
    raise exception 'staff accounts cannot place customer orders' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kitchens k where k.id = p_kitchen and k.is_active) then
    raise exception 'unknown or inactive kitchen' using errcode = '22023';
  end if;
  select * into pol from public.pricing_policies p where p.kitchen_id = p_kitchen and p.active;
  if not found then
    raise exception 'ordering is not open: pricing is not approved for this kitchen' using errcode = '55000';
  end if;
  select nullif(btrim(p.delivery_address), ''), p.delivery_latitude, p.delivery_longitude, p.delivery_city
    into addr, alat, alng, city from public.user_profiles p where p.user_id = uid;
  if addr is null then
    raise exception 'a confirmed delivery address is required' using errcode = '22023';
  end if;
  -- Zone: the customer's city must be served, by this kitchen.
  if city is null then
    raise exception 'choose your delivery city' using errcode = '22023';
  end if;
  select * into zone from public.delivery_zones z where z.city_key = city and z.active;
  if not found then
    raise exception 'delivery is not available in your city yet' using errcode = '22023';
  end if;
  if zone.kitchen_id <> p_kitchen then
    raise exception 'this kitchen does not deliver to your city' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a list' using errcode = '22023';
  end if;
  n_lines := jsonb_array_length(p_items);
  if n_lines < 1 or n_lines > 30 then
    raise exception 'an order has 1 to 30 lines' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'meal_id') from jsonb_array_elements(p_items) x) <> n_lines then
    raise exception 'each meal appears once per order (use the quantity)' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'the order note is too long' using errcode = '22023';
  end if;

  -- Fees' tax treatment must be approved (accountant) before any order.
  select * into svc_cat from public.tax_categories where code = pol.service_fee_tax_category;
  select * into dlv_cat from public.tax_categories where code = pol.delivery_fee_tax_category;
  if svc_cat.status is distinct from 'approved' or dlv_cat.status is distinct from 'approved' then
    raise exception 'ordering is not open: the tax treatment of the service and delivery fees is not approved' using errcode = '55000';
  end if;

  -- Road distance: the customer's latest valid quote for this kitchen,
  -- pricing row and current address (never a client value).
  select * into quote from public.delivery_quotes d
   where d.user_id = uid and d.kitchen_id = p_kitchen and d.pricing_policy_id = pol.id
     and d.used_by_order is null and d.expires_at > now()
     and d.address_text = addr and d.address_latitude is not distinct from alat and d.address_longitude is not distinct from alng
   order by d.created_at desc, d.id limit 1
   for update;
  if not found then
    raise exception 'delivery quote required: the road distance to your address must be calculated first' using errcode = '55000';
  end if;

  perform set_config('loption.order_service', 'on', true);
  onum := 'LO-' || to_char(now() at time zone 'Africa/Casablanca', 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 5, '0');
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method,
                             user_id, client_request_id, delivery_address, subtotal, delivery_fee, platform_service_fee,
                             total, status_changed_at, created_at, updated_at)
  values (oid, onum, 'pending', 1, p_kitchen, 'pending', 'cash',
          uid, p_client_request_id, addr, 0, quote.delivery_fee, pol.service_fee, 0, now(), now(), now());

  for line in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(line) <> 'object' or (line ->> 'meal_id') is null
       or (line ->> 'meal_id') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'invalid order line' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(line -> 'quantity'), '') <> 'number' or coalesce(line ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;
    qty := (line ->> 'quantity')::integer;
    if qty < 1 or qty > 20 then
      raise exception 'a quantity is 1 to 20' using errcode = '22023';
    end if;
    if (line -> 'notes') is not null and (jsonb_typeof(line -> 'notes') not in ('string', 'null') or char_length(line ->> 'notes') > 200) then
      raise exception 'a line note is too long' using errcode = '22023';
    end if;
    select me.id, me.name, me.price, me.tax_category into m from public.meals me
     where me.id = (line ->> 'meal_id')::uuid and coalesce(me.available, false);
    if not found or m.price is null or m.price < 0 then
      raise exception 'meal % is not available', line ->> 'meal_id' using errcode = '22023';
    end if;
    select * into cat from public.tax_categories where code = m.tax_category;
    if cat.status is distinct from 'approved' or cat.applies_to <> 'product' then
      raise exception 'ordering is not open: the tax rate of % is not approved', m.tax_category using errcode = '55000';
    end if;
    line_ttc := round(m.price * qty, 2);
    split := public.tax_split(line_ttc, cat.rate);
    insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes, tax_category, tax_rate, line_total_ttc, line_ht, line_tva)
    values (oid, m.id, m.name, qty, m.price, nullif(btrim(line ->> 'notes'), ''), cat.code, cat.rate, line_ttc, split.ht, split.tva);
    sub := sub + line_ttc;
    prod_ht := prod_ht + split.ht;
    prod_tva := prod_tva + split.tva;
  end loop;

  update public.orders set subtotal = sub, total = sub + pol.service_fee + quote.delivery_fee where id = oid;

  -- First-order free delivery (existing, idempotent, per account).
  discount := public.apply_first_order_offer(oid);

  -- Fee taxes on the amounts actually charged (after the offer).
  select o.delivery_fee into final_delivery from public.orders o where o.id = oid;
  svc_split := public.tax_split(pol.service_fee, svc_cat.rate);
  dlv_split := public.tax_split(final_delivery, dlv_cat.rate);
  update public.orders
     set pricing_policy_id = pol.id, pricing_config_version = pol.config_version, delivery_quote_id = quote.id,
         delivery_distance_km = quote.distance_km, delivery_formula_version = quote.formula_version,
         products_ht = prod_ht, products_tva = prod_tva,
         service_fee_tax_category = svc_cat.code, service_fee_tax_rate = svc_cat.rate, service_fee_ht = svc_split.ht, service_fee_tva = svc_split.tva,
         delivery_fee_tax_category = dlv_cat.code, delivery_fee_tax_rate = dlv_cat.rate, delivery_fee_ht = dlv_split.ht, delivery_fee_tva = dlv_split.tva,
         priced_at = now()
   where id = oid;
  update public.delivery_quotes set used_by_order = oid where id = quote.id;

  insert into public.order_status_updates (order_id, status, message) values (oid, 'pending', null);
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (uid, 'order_created', uid,
          jsonb_build_object('order_id', oid, 'kitchen_id', p_kitchen, 'lines', n_lines, 'subtotal', sub,
                             'service_fee', pol.service_fee, 'delivery_fee', final_delivery, 'delivery_discount', discount,
                             'distance_km', quote.distance_km, 'quote_id', quote.id, 'pricing_policy_id', pol.id,
                             'config_version', pol.config_version, 'city', city));
  perform set_config('loption.order_service', 'off', true);
  return oid;
end;
$$;
revoke all on function public.create_order(uuid, jsonb, uuid, text) from public, anon, service_role;
grant execute on function public.create_order(uuid, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Postcondition
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
  f text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 pricing engine postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure) <> 'fc876c0897b2e23a59fe2cfecfcd3ad7' then
    raise exception 'V1 pricing engine postcondition failed: the monitor changed (this migration adds no client policy or client function)';
  end if;
  if exists (select 1 from public.pricing_policies) then
    raise exception 'V1 pricing engine postcondition failed: no pricing row may be created by the migration';
  end if;
  if (select count(*) from public.tax_categories where status = 'approved') <> 0 then
    raise exception 'V1 pricing engine postcondition failed: no tax category may be approved by the migration';
  end if;
  foreach f in array array['public.delivery_quote_context(uuid)',
                           'public.record_delivery_quote(uuid,uuid,text,double precision,double precision,integer,text)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'V1 pricing engine postcondition failed: % must be executable by service_role only', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.tax_categories', 'SELECT') or has_table_privilege('authenticated', 'public.delivery_quotes', 'SELECT')
     or has_table_privilege('service_role', 'public.delivery_quotes', 'INSERT') then
    raise exception 'V1 pricing engine postcondition failed: tax categories and quotes are server-only';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 pricing engine: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_pricing_gate_ok values ('postcondition');
end
$post$;

commit;
