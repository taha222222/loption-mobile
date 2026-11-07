-- =====================================================================
-- L'OPTION V1 — checkout experience: meal customization, descriptions,
-- popularity, promo codes, WhatsApp-verified phone, first-order fee rule,
-- server price preview and create_order() v2.
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on 20261108120000_v1_pricing_engine.sql. The order workflow
-- migration is not touched. Rollback: supabase/rollback/
-- v1_checkout_experience_rollback.sql (archiving). Specification:
-- docs/v1/V1_PRICING_SPECIFICATION.md (§9 checkout).
--
-- Owner rules applied (brief of 2026-11-07, "Product detail, customization
-- and checkout"):
--   * first qualifying order: service fee 0 and delivery fee 0; later orders:
--     3 MAD service fee (pricing row) + the road-distance delivery fee.
--     "Qualifying" is the existing first-order offer rule
--     (first_order_offer_status_for): the account has no order outside the
--     release statuses (cancelled, rejected). A cancelled first order
--     releases the benefit; the waiver is recorded by
--     apply_first_order_offer() (delivery) and in the order (service).
--   * a verified phone number (WhatsApp code) is required to order.
--   * promo codes: rules are DATA on each promotions row (window, minimum,
--     global limit, applicable meals, percent or amount, cap, stacking with
--     the first-order benefit). No code is created here.
--   * the customer must have seen the total: create_order() takes the total
--     the app displayed and refuses (40001) if the server total differs.
-- Prices of options are TTC and never negative; a "remove" choice is a 0 MAD
-- option. Every amount is recomputed by the server from the database.
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 checkout experience: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_checkout_gate_ok (step text primary key) on commit drop;
create temp table v1_checkout_gate (
  step text constraint v1_checkout_experience_guard_did_not_pass references v1_checkout_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_checkout_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
begin
  if to_regclass('public.tax_categories') is null or to_regclass('public.delivery_quotes') is null then
    raise exception 'V1 checkout experience: the V1 pricing engine migration must be applied first; aborting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure)
     <> 'fc876c0897b2e23a59fe2cfecfcd3ad7' then
    raise exception 'V1 checkout experience: containment_violations() is not the reviewed monitor of the pricing engine; refusing';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 checkout experience: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  if to_regclass('public.meal_option_groups') is not null or to_regclass('public.phone_verifications') is not null
     or to_regprocedure('public.checkout_preview(uuid,jsonb,text)') is not null then
    raise exception 'V1 checkout experience: already applied (re-run or unknown objects), refusing';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'V1 checkout experience: pgcrypto (schema extensions) is required for the phone codes; refusing';
  end if;
  if exists (select 1 from public.orders where workflow_version is not null) then
    raise exception 'V1 checkout experience: workflow orders exist; create_order changes signature only before any order. Refusing';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 checkout experience: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_checkout_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. Meal description and customization (configured per meal; read by
--    signed-in customers; written by admins, like meals)
-- ---------------------------------------------------------------------
alter table public.meals add column description text check (description is null or char_length(btrim(description)) between 1 and 600);

create table public.meal_option_groups (
  id          uuid primary key default gen_random_uuid(),
  meal_id     uuid not null references public.meals(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  min_select  integer not null default 0 check (min_select between 0 and 10),
  max_select  integer not null default 1 check (max_select between 1 and 10),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint meal_option_groups_range check (min_select <= max_select)
);
create index meal_option_groups_meal_idx on public.meal_option_groups (meal_id, sort_order);

create table public.meal_options (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.meal_option_groups(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  -- TTC extra charge; 0 for a free choice or a removal. Never negative.
  price_delta numeric(8,2) not null default 0 check (price_delta >= 0 and price_delta <= 500),
  available   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index meal_options_group_idx on public.meal_options (group_id, sort_order);

alter table public.meal_option_groups enable row level security;
alter table public.meal_options enable row level security;
revoke all on public.meal_option_groups, public.meal_options from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.meal_option_groups, public.meal_options to authenticated;
create policy meal_option_groups_read_active on public.meal_option_groups
  for select to authenticated using (active);
create policy meal_options_read_available on public.meal_options
  for select to authenticated using (available and exists (select 1 from public.meal_option_groups g where g.id = meal_options.group_id and g.active));
create policy staff_admin_all_meal_option_groups on public.meal_option_groups for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));
create policy staff_admin_all_meal_options on public.meal_options for all to authenticated
  using ((select public.has_staff_role('admin'))) with check ((select public.has_staff_role('admin')));

-- ---------------------------------------------------------------------
-- 2. Order snapshot additions (written only by create_order)
-- ---------------------------------------------------------------------
alter table public.order_items
  add column options            jsonb not null default '[]'::jsonb,
  add column options_unit_price numeric(8,2) not null default 0,
  add column line_discount      numeric(12,2) not null default 0;
alter table public.orders
  add column promotion_code              text,
  add column promo_discount              numeric(12,2) not null default 0,
  add column service_fee_before_discount numeric(8,2),
  add column service_fee_discount        numeric(8,2),
  add column delivery_phone              text;

-- The line snapshot (taxes, choices, discount) never changes.
create or replace function public.order_items_tax_snapshot_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.tax_category is distinct from old.tax_category or new.tax_rate is distinct from old.tax_rate
     or new.line_total_ttc is distinct from old.line_total_ttc or new.line_ht is distinct from old.line_ht
     or new.line_tva is distinct from old.line_tva or new.options is distinct from old.options
     or new.options_unit_price is distinct from old.options_unit_price or new.line_discount is distinct from old.line_discount then
    raise exception 'order lines keep their tax snapshot' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Promo codes: rules are data on the promotions row
-- ---------------------------------------------------------------------
alter table public.promotions drop constraint promotions_kind_check, drop constraint promotions_audience_check;
alter table public.promotions
  add constraint promotions_kind_check check (kind in ('free_delivery', 'percent_off', 'amount_off')),
  add constraint promotions_audience_check check (audience in ('first_order', 'code')),
  add column percent_off   numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  add column amount_off    numeric(8,2) check (amount_off > 0),
  add column max_discount  numeric(8,2) check (max_discount > 0),
  add column max_redemptions integer check (max_redemptions > 0),
  add column applicable_meal_ids uuid[],
  add column stackable_with_first_order boolean not null default false,
  add constraint promotions_code_shape check (
    audience <> 'code'
    or (code ~ '^[A-Z0-9_-]{3,30}$' and kind in ('percent_off', 'amount_off')
        and (kind <> 'percent_off' or percent_off is not null) and (kind <> 'amount_off' or amount_off is not null)));
-- A code is redeemed once per customer (existing index); an order may now
-- carry the first-order benefit and one code.
drop index public.promotion_redemptions_order_unique;
create unique index promotion_redemptions_order_unique on public.promotion_redemptions (promotion_id, order_id) where order_id is not null;

create function public.promotions_audit()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'promotions are never deleted; deactivate them instead' using errcode = '42501';
  end if;
  new.updated_at := now();
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), 'promotion_' || lower(tg_op), null,
          jsonb_build_object('code', new.code, 'kind', new.kind, 'audience', new.audience, 'active', new.is_active,
                             'percent_off', new.percent_off, 'amount_off', new.amount_off, 'max_discount', new.max_discount,
                             'min_order_subtotal', new.min_order_subtotal, 'max_redemptions', new.max_redemptions,
                             'starts_at', new.starts_at, 'ends_at', new.ends_at));
  return new;
end;
$$;
revoke all on function public.promotions_audit() from public, anon, authenticated, service_role;
create trigger trg_promotions_audit before insert or update or delete on public.promotions
  for each row execute function public.promotions_audit();

-- Rate limit of promo code checks (each refused code counts).
-- create_order() accepts a code only after a recent successful check, so
-- codes cannot be guessed through it either.
create table public.promo_code_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  code         text not null,
  attempted_at timestamptz not null default clock_timestamp(),
  outcome      text not null
);
create index promo_code_attempts_user_idx on public.promo_code_attempts (user_id, attempted_at desc);
alter table public.promo_code_attempts enable row level security;
revoke all on public.promo_code_attempts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Phone number verified by a WhatsApp code
-- ---------------------------------------------------------------------
alter table public.user_profiles
  add column phone_e164        text check (phone_e164 is null or phone_e164 ~ '^\+212[67][0-9]{8}$'),
  add column phone_verified_at timestamptz,
  add constraint user_profiles_phone_verified_shape check (phone_verified_at is null or phone_e164 is not null);
-- Not granted to any client: written only by phone_otp_verify().

-- Moroccan mobile numbers (06 / 07), in any usual spelling -> +2126XXXXXXXX.
create function public.normalize_moroccan_mobile(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when d ~ '^0[67][0-9]{8}$' then '+212' || substr(d, 2)
    when d ~ '^2120?[67][0-9]{8}$' then '+212' || right(d, 9)
    when d ~ '^002120?[67][0-9]{8}$' then '+212' || right(d, 9)
    else null end
  from (select regexp_replace(coalesce(p, ''), '[\s().+-]', '', 'g') as d) x
$$;
revoke all on function public.normalize_moroccan_mobile(text) from public, anon;
grant execute on function public.normalize_moroccan_mobile(text) to authenticated, service_role;

create table public.phone_verifications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  phone_e164          text not null check (phone_e164 ~ '^\+212[67][0-9]{8}$'),
  code_hash           text not null,
  status              text not null check (status in ('pending_send', 'sent', 'verified', 'failed', 'superseded')),
  attempts            integer not null default 0,
  provider            text,
  provider_message_id text,
  failure_reason      text,
  created_at          timestamptz not null default clock_timestamp(),
  expires_at          timestamptz not null,
  verified_at         timestamptz
);
create index phone_verifications_user_idx on public.phone_verifications (user_id, created_at desc);
create index phone_verifications_phone_idx on public.phone_verifications (phone_e164, created_at desc);
alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from public, anon, authenticated, service_role;

-- For the phone-otp Edge Function (service_role only): a new code for this
-- customer and number, returned once so the function can send it. Limits:
-- one code per 60 s, 5 per hour per customer, 5 per hour per number.
create function public.phone_otp_issue(p_user uuid, p_phone text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  phone text := public.normalize_moroccan_mobile(p_phone);
  code text;
  v public.phone_verifications%rowtype;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'unknown customer' using errcode = '42501';
  end if;
  if phone is null then
    raise exception 'invalid phone number: a Moroccan mobile number (06 or 07) is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('v1.phone_otp:' || p_user::text, 0));
  if exists (select 1 from public.phone_verifications where user_id = p_user and created_at > clock_timestamp() - interval '60 seconds') then
    raise exception 'too many codes: wait one minute before asking for a new code' using errcode = '54000';
  end if;
  if (select count(*) from public.phone_verifications where user_id = p_user and created_at > clock_timestamp() - interval '1 hour') >= 5
     or (select count(*) from public.phone_verifications where phone_e164 = phone and created_at > clock_timestamp() - interval '1 hour') >= 5 then
    raise exception 'too many codes: try again in an hour' using errcode = '54000';
  end if;
  update public.phone_verifications set status = 'superseded'
   where user_id = p_user and status in ('pending_send', 'sent');
  code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.phone_verifications (user_id, phone_e164, code_hash, status, expires_at)
  values (p_user, phone, '-', 'pending_send', clock_timestamp() + interval '10 minutes')
  returning * into v;
  update public.phone_verifications set code_hash = encode(extensions.digest(code || ':' || v.id::text, 'sha256'), 'hex') where id = v.id;
  return jsonb_build_object('verification_id', v.id, 'phone_e164', phone, 'code', code, 'expires_at', v.expires_at);
end;
$$;
revoke all on function public.phone_otp_issue(uuid, text) from public, anon, authenticated;
grant execute on function public.phone_otp_issue(uuid, text) to service_role;

-- For the phone-otp Edge Function: the provider's answer. Only a code the
-- provider accepted can be verified.
create function public.phone_otp_mark(p_verification uuid, p_sent boolean, p_provider text, p_detail text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.phone_verifications
     set status = case when p_sent then 'sent' else 'failed' end,
         provider = left(p_provider, 40),
         provider_message_id = case when p_sent then left(p_detail, 200) end,
         failure_reason = case when p_sent then null else left(p_detail, 300) end
   where id = p_verification and status = 'pending_send';
  if not found then
    raise exception 'verification not pending' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.phone_otp_mark(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.phone_otp_mark(uuid, boolean, text, text) to service_role;

-- The customer types the code. Expected failures are returned, not raised,
-- so that the attempt counter is kept (5 attempts, 10 minutes).
create function public.phone_otp_verify(p_verification uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v public.phone_verifications%rowtype;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v from public.phone_verifications where id = p_verification and user_id = uid for update;
  if not found then
    raise exception 'verification not found or not allowed' using errcode = '42501';
  end if;
  if v.status = 'verified' then
    return jsonb_build_object('ok', true, 'phone_e164', v.phone_e164);
  end if;
  if v.status <> 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'not_sent');
  end if;
  if v.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$'
     or encode(extensions.digest(p_code || ':' || v.id::text, 'sha256'), 'hex') <> v.code_hash then
    update public.phone_verifications set attempts = attempts + 1 where id = v.id;
    return jsonb_build_object('ok', false, 'reason', 'wrong_code', 'attempts_left', greatest(0, 4 - v.attempts));
  end if;
  update public.phone_verifications set status = 'verified', verified_at = clock_timestamp() where id = v.id;
  update public.user_profiles set phone_e164 = v.phone_e164, phone_verified_at = clock_timestamp() where user_id = uid;
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (uid, 'phone_verified', uid, jsonb_build_object('verification_id', v.id, 'provider', v.provider,
          'phone_suffix', right(v.phone_e164, 2)));
  return jsonb_build_object('ok', true, 'phone_e164', v.phone_e164);
end;
$$;
revoke all on function public.phone_otp_verify(uuid, text) from public, anon, service_role;
grant execute on function public.phone_otp_verify(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Popularity from real orders: distinct customers who RECEIVED the meal
--    (orders delivered, or served at the counter). Nothing is estimated.
-- ---------------------------------------------------------------------
create function public.meal_popularity(p_meal uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(distinct o.user_id)::integer
    from public.order_items i join public.orders o on o.id = i.order_id
   where i.meal_id = p_meal and o.user_id is not null and o.status in ('delivered', 'served')
$$;
revoke all on function public.meal_popularity(uuid) from public, anon, service_role;
grant execute on function public.meal_popularity(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. The price of a cart: ONE function for the preview and the order
-- ---------------------------------------------------------------------
-- Items: [{"meal_id": uuid, "quantity": 1..20, "notes": text?, "option_ids": [uuid]?}]
-- Raises on what makes ordering impossible (zone, pricing, taxes, items,
-- quote); returns the promo code and phone status for the caller to judge.
create function public.checkout_price(p_user uuid, p_kitchen uuid, p_items jsonb, p_promo_code text, p_for_order boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pol public.pricing_policies%rowtype;
  addr text;
  alat double precision;
  alng double precision;
  city text;
  phone text;
  phone_at timestamptz;
  zone public.delivery_zones%rowtype;
  quote public.delivery_quotes%rowtype;
  svc_cat public.tax_categories%rowtype;
  dlv_cat public.tax_categories%rowtype;
  cat public.tax_categories%rowtype;
  fo public.promotions%rowtype;
  promo public.promotions%rowtype;
  line jsonb;
  m record;
  qty integer;
  n_lines integer;
  opt_ids uuid[];
  opts jsonb;
  opt_total numeric(8,2);
  line_ttc numeric(12,2);
  keys text[] := '{}';
  k text;
  lines jsonb := '[]'::jsonb;
  out_lines jsonb := '[]'::jsonb;
  sub numeric(12,2) := 0;
  promo_code text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  promo_status text := 'none';
  promo_base numeric(12,2) := 0;
  discount numeric(12,2) := 0;
  remaining numeric(12,2);
  n_applicable integer := 0;
  seen integer := 0;
  share numeric(12,2);
  net numeric(12,2);
  split record;
  first_order boolean;
  service numeric(8,2);
  delivery numeric(8,2);
  i integer;
begin
  if exists (select 1 from public.staff_roles s where s.user_id = p_user and s.is_active) then
    raise exception 'staff accounts cannot place customer orders' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kitchens kk where kk.id = p_kitchen and kk.is_active) then
    raise exception 'unknown or inactive kitchen' using errcode = '22023';
  end if;
  select * into pol from public.pricing_policies p where p.kitchen_id = p_kitchen and p.active;
  if not found then
    raise exception 'ordering is not open: pricing is not approved for this kitchen' using errcode = '55000';
  end if;
  select nullif(btrim(p.delivery_address), ''), p.delivery_latitude, p.delivery_longitude, p.delivery_city, p.phone_e164, p.phone_verified_at
    into addr, alat, alng, city, phone, phone_at from public.user_profiles p where p.user_id = p_user;
  if addr is null then
    raise exception 'a confirmed delivery address is required' using errcode = '22023';
  end if;
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

  for line in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(line) <> 'object' or (line ->> 'meal_id') is null or (line ->> 'meal_id') !~ '^[0-9a-fA-F-]{36}$' then
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
    if (line -> 'option_ids') is not null and jsonb_typeof(line -> 'option_ids') not in ('array', 'null') then
      raise exception 'invalid options' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(line -> 'option_ids', '[]'::jsonb)) x
                where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[0-9a-fA-F-]{36}$') then
      raise exception 'invalid options' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct (x #>> '{}')::uuid order by (x #>> '{}')::uuid), '{}') into opt_ids
      from jsonb_array_elements(coalesce(line -> 'option_ids', '[]'::jsonb)) x;
    if cardinality(opt_ids) <> jsonb_array_length(coalesce(line -> 'option_ids', '[]'::jsonb)) or cardinality(opt_ids) > 20 then
      raise exception 'invalid options' using errcode = '22023';
    end if;
    select me.id, me.name, me.price, me.tax_category into m from public.meals me
     where me.id = (line ->> 'meal_id')::uuid and coalesce(me.available, false);
    if not found or m.price is null or m.price < 0 then
      raise exception 'meal % is not available', line ->> 'meal_id' using errcode = '22023';
    end if;
    -- Every choice belongs to an active group of THIS meal and is available.
    if exists (select 1 from unnest(opt_ids) x
                where not exists (select 1 from public.meal_options o join public.meal_option_groups g on g.id = o.group_id
                                   where o.id = x and g.meal_id = m.id and g.active and o.available)) then
      raise exception 'a choice for % is not available', m.name using errcode = '22023';
    end if;
    -- Required and maximum choices of every active group.
    if exists (select 1 from public.meal_option_groups g
                where g.meal_id = m.id and g.active
                  and (select count(*) from public.meal_options o where o.group_id = g.id and o.id = any (opt_ids))
                      not between g.min_select and g.max_select) then
      raise exception 'choose the required options for %', m.name using errcode = '22023';
    end if;
    k := m.id::text || ':' || array_to_string(opt_ids, ',');
    if k = any (keys) then
      raise exception 'the same meal with the same choices appears twice (use the quantity)' using errcode = '22023';
    end if;
    keys := keys || k;
    select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'group', g.name, 'name', o.name, 'price', o.price_delta)
                              order by g.sort_order, g.name, o.sort_order, o.name), '[]'::jsonb),
           coalesce(sum(o.price_delta), 0)
      into opts, opt_total
      from public.meal_options o join public.meal_option_groups g on g.id = o.group_id
     where o.id = any (opt_ids);
    select * into cat from public.tax_categories where code = m.tax_category;
    if cat.status is distinct from 'approved' or cat.applies_to <> 'product' then
      raise exception 'ordering is not open: the tax rate of % is not approved', m.tax_category using errcode = '55000';
    end if;
    line_ttc := round((m.price + opt_total) * qty, 2);
    lines := lines || jsonb_build_object('meal_id', m.id, 'name', m.name, 'quantity', qty, 'base_price', m.price,
               'options', opts, 'options_unit_price', opt_total, 'unit_price', m.price + opt_total,
               'line_total_ttc', line_ttc, 'notes', nullif(btrim(line ->> 'notes'), ''),
               'tax_category', cat.code, 'tax_rate', cat.rate);
    sub := sub + line_ttc;
  end loop;

  select * into svc_cat from public.tax_categories where code = pol.service_fee_tax_category;
  select * into dlv_cat from public.tax_categories where code = pol.delivery_fee_tax_category;
  if svc_cat.status is distinct from 'approved' or dlv_cat.status is distinct from 'approved' then
    raise exception 'ordering is not open: the tax treatment of the service and delivery fees is not approved' using errcode = '55000';
  end if;

  if p_for_order then
    select * into quote from public.delivery_quotes d
     where d.user_id = p_user and d.kitchen_id = p_kitchen and d.pricing_policy_id = pol.id
       and d.used_by_order is null and d.expires_at > now()
       and d.address_text = addr and d.address_latitude is not distinct from alat and d.address_longitude is not distinct from alng
     order by d.created_at desc, d.id limit 1
     for update;
  else
    select * into quote from public.delivery_quotes d
     where d.user_id = p_user and d.kitchen_id = p_kitchen and d.pricing_policy_id = pol.id
       and d.used_by_order is null and d.expires_at > now()
       and d.address_text = addr and d.address_latitude is not distinct from alat and d.address_longitude is not distinct from alng
     order by d.created_at desc, d.id limit 1;
  end if;
  if not found then
    raise exception 'delivery quote required: the road distance to your address must be calculated first' using errcode = '55000';
  end if;

  -- First qualifying order (existing offer rule, server history only).
  select * into fo from public.promotions where code = 'FIRST_ORDER_FREE_DELIVERY';
  first_order := public.first_order_offer_status_for(p_user) = 'eligible'
                 and (fo.min_order_subtotal is null or sub >= fo.min_order_subtotal);

  -- Promo code: every rule is a column of the promotions row.
  if promo_code is not null then
    if p_for_order then
      select * into promo from public.promotions where code = promo_code and audience = 'code' for update;
    else
      select * into promo from public.promotions where code = promo_code and audience = 'code';
    end if;
    if not found or not promo.is_active then
      promo_status := 'invalid';
    elsif promo.starts_at is not null and now() < promo.starts_at then
      promo_status := 'not_started';
    elsif promo.ends_at is not null and now() >= promo.ends_at then
      promo_status := 'expired';
    elsif exists (select 1 from public.promotion_redemptions r where r.promotion_id = promo.id and r.user_id = p_user and r.status = 'applied') then
      promo_status := 'already_used';
    elsif promo.max_redemptions is not null
          and (select count(*) from public.promotion_redemptions r where r.promotion_id = promo.id and r.status = 'applied') >= promo.max_redemptions then
      promo_status := 'exhausted';
    elsif first_order and not promo.stackable_with_first_order then
      promo_status := 'not_combinable';
    elsif promo.min_order_subtotal is not null and sub < promo.min_order_subtotal then
      promo_status := 'minimum_not_reached';
    else
      select coalesce(sum((l ->> 'line_total_ttc')::numeric), 0), count(*) into promo_base, n_applicable
        from jsonb_array_elements(lines) l
       where promo.applicable_meal_ids is null or (l ->> 'meal_id')::uuid = any (promo.applicable_meal_ids);
      if n_applicable = 0 or promo_base <= 0 then
        promo_status := 'not_applicable';
      else
        promo_status := 'valid';
        discount := case when promo.kind = 'percent_off' then round(promo_base * promo.percent_off / 100, 2) else promo.amount_off end;
        if promo.max_discount is not null then discount := least(discount, promo.max_discount); end if;
        discount := least(discount, promo_base);
      end if;
    end if;
  end if;

  -- Lines: the discount is shared over the applicable lines in proportion
  -- (the last one takes the remainder); taxes on the net amount.
  remaining := discount;
  for i in 0 .. jsonb_array_length(lines) - 1 loop
    line := lines -> i;
    share := 0;
    if promo_status = 'valid' and (promo.applicable_meal_ids is null or (line ->> 'meal_id')::uuid = any (promo.applicable_meal_ids)) then
      seen := seen + 1;
      share := case when seen = n_applicable then remaining
                    else round(discount * (line ->> 'line_total_ttc')::numeric / promo_base, 2) end;
      remaining := remaining - share;
    end if;
    net := (line ->> 'line_total_ttc')::numeric - share;
    split := public.tax_split(net, (line ->> 'tax_rate')::numeric);
    out_lines := out_lines || (line || jsonb_build_object('line_discount', share, 'line_ht', split.ht, 'line_tva', split.tva));
  end loop;

  service := case when first_order then 0 else pol.service_fee end;
  delivery := case when first_order then 0 else quote.delivery_fee end;
  return jsonb_build_object(
    'kitchen_id', p_kitchen, 'pricing_policy_id', pol.id, 'config_version', pol.config_version,
    'quote_id', quote.id, 'distance_km', quote.distance_km, 'formula_version', quote.formula_version, 'quote_expires_at', quote.expires_at,
    'address', addr, 'city', city,
    'phone', jsonb_build_object('e164', phone, 'verified', phone is not null and phone_at is not null),
    'lines', out_lines, 'products_subtotal', sub,
    'promo', jsonb_build_object('code', promo_code, 'status', promo_status, 'discount', discount,
                                'promotion_id', case when promo_status = 'valid' then promo.id end),
    'first_order', first_order,
    'service_fee_before_discount', pol.service_fee, 'service_fee', service,
    'delivery_fee_before_discount', quote.delivery_fee, 'delivery_fee', delivery,
    'total', sub - discount + service + delivery);
end;
$$;
revoke all on function public.checkout_price(uuid, uuid, jsonb, text, boolean) from public, anon, authenticated, service_role;

-- The customer's price, before ordering: the same function create_order()
-- uses, without locking or consuming anything. A refused promo code is
-- reported (not raised) and counted: 10 refused codes in 15 minutes stop
-- further checks for 15 minutes.
create function public.checkout_preview(p_kitchen uuid, p_items jsonb, p_promo_code text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  promo_norm text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  limited boolean;
  r jsonb;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  limited := promo_norm is not null
             and (select count(*) from public.promo_code_attempts a
                   where a.user_id = uid and a.outcome <> 'valid' and a.attempted_at > clock_timestamp() - interval '15 minutes') >= 10;
  r := public.checkout_price(uid, p_kitchen, p_items, case when limited then null else promo_norm end, false);
  if limited then
    r := jsonb_set(r, '{promo}', jsonb_build_object('code', promo_norm, 'status', 'rate_limited', 'discount', 0));
  elsif promo_norm is not null then
    insert into public.promo_code_attempts (user_id, code, outcome) values (uid, promo_norm, r -> 'promo' ->> 'status');
  end if;
  return r - 'pricing_policy_id' - 'quote_id' - 'formula_version';
end;
$$;
revoke all on function public.checkout_preview(uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.checkout_preview(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. create_order() v2: same safeguards as before (idempotency, zone,
--    pricing, taxes, quote used once, snapshot, audit) + choices, promo
--    code, first-order fee rule, verified phone and the displayed total.
-- ---------------------------------------------------------------------
drop function public.create_order(uuid, jsonb, uuid, text);
create function public.create_order(p_kitchen uuid, p_items jsonb, p_client_request_id uuid, p_note text default null,
                                    p_promo_code text default null, p_expected_total numeric default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing uuid;
  p jsonb;
  l jsonb;
  oid uuid := gen_random_uuid();
  onum text;
  sub numeric(12,2);
  discount numeric(12,2);
  svc numeric(8,2);
  dlv numeric(8,2);
  fo_discount numeric;
  fo_applied boolean;
  prod_ht numeric(12,2);
  prod_tva numeric(12,2);
  svc_cat public.tax_categories%rowtype;
  dlv_cat public.tax_categories%rowtype;
  pol public.pricing_policies%rowtype;
  o public.orders%rowtype;
  svc_split record;
  dlv_split record;
  promo_norm text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
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
  select x.id into existing from public.orders x where x.user_id = uid and x.client_request_id = p_client_request_id;
  if found then
    return existing;
  end if;
  if p_expected_total is null or p_expected_total < 0 then
    raise exception 'the total shown to the customer is required' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'the order note is too long' using errcode = '22023';
  end if;
  -- A code is accepted only after a recent successful check (rate-limited).
  if promo_norm is not null and not exists (select 1 from public.promo_code_attempts a
                                       where a.user_id = uid and a.code = promo_norm and a.outcome = 'valid'
                                         and a.attempted_at > clock_timestamp() - interval '30 minutes') then
    raise exception 'check the promo code before ordering' using errcode = '22023';
  end if;

  p := public.checkout_price(uid, p_kitchen, p_items, promo_norm, true);
  if not (p -> 'phone' ->> 'verified')::boolean then
    raise exception 'a verified phone number is required' using errcode = '22023';
  end if;
  if promo_norm is not null and p -> 'promo' ->> 'status' <> 'valid' then
    raise exception 'promo code not accepted: %', p -> 'promo' ->> 'status' using errcode = '22023';
  end if;
  select * into pol from public.pricing_policies where id = (p ->> 'pricing_policy_id')::uuid;
  sub := (p ->> 'products_subtotal')::numeric;
  discount := (p -> 'promo' ->> 'discount')::numeric;
  svc := pol.service_fee;
  dlv := (p ->> 'delivery_fee_before_discount')::numeric;

  perform set_config('loption.order_service', 'on', true);
  onum := 'LO-' || to_char(now() at time zone 'Africa/Casablanca', 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 5, '0');
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method,
                             user_id, client_request_id, delivery_address, delivery_phone, subtotal, promotion_code, promo_discount,
                             delivery_fee, platform_service_fee, total, status_changed_at, created_at, updated_at)
  values (oid, onum, 'pending', 1, p_kitchen, 'pending', 'cash',
          uid, p_client_request_id, p ->> 'address', p -> 'phone' ->> 'e164', sub, case when discount > 0 then promo_norm end, discount,
          dlv, svc, sub - discount + svc + dlv, now(), now(), now());

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes, options, options_unit_price,
                                    tax_category, tax_rate, line_total_ttc, line_discount, line_ht, line_tva)
    values (oid, (l ->> 'meal_id')::uuid, l ->> 'name', (l ->> 'quantity')::integer, (l ->> 'base_price')::numeric, l ->> 'notes',
            l -> 'options', (l ->> 'options_unit_price')::numeric, l ->> 'tax_category', (l ->> 'tax_rate')::numeric,
            (l ->> 'line_total_ttc')::numeric, (l ->> 'line_discount')::numeric, (l ->> 'line_ht')::numeric, (l ->> 'line_tva')::numeric);
  end loop;
  select coalesce(sum(i.line_ht), 0), coalesce(sum(i.line_tva), 0) into prod_ht, prod_tva from public.order_items i where i.order_id = oid;

  if promo_norm is not null then
    begin
      insert into public.promotion_redemptions (promotion_id, user_id, order_id, status, discount_amount)
      values ((p -> 'promo' ->> 'promotion_id')::uuid, uid, oid, 'applied', discount);
    exception when unique_violation then
      raise exception 'promo code not accepted: already_used' using errcode = '22023';
    end;
  end if;

  -- First qualifying order: free delivery through the existing offer, and the
  -- service fee waived with it (owner rule). Recorded on the order.
  fo_discount := public.apply_first_order_offer(oid);
  fo_applied := exists (select 1 from public.promotion_redemptions r join public.promotions pr on pr.id = r.promotion_id
                         where r.order_id = oid and pr.code = 'FIRST_ORDER_FREE_DELIVERY' and r.status = 'applied');
  update public.orders
     set service_fee_before_discount = svc,
         service_fee_discount = case when fo_applied then svc else 0 end,
         platform_service_fee = case when fo_applied then 0 else svc end,
         total = total - case when fo_applied then svc else 0 end
   where id = oid;

  select * into o from public.orders where id = oid;
  select * into svc_cat from public.tax_categories where code = pol.service_fee_tax_category;
  select * into dlv_cat from public.tax_categories where code = pol.delivery_fee_tax_category;
  svc_split := public.tax_split(o.platform_service_fee, svc_cat.rate);
  dlv_split := public.tax_split(o.delivery_fee, dlv_cat.rate);
  update public.orders
     set pricing_policy_id = pol.id, pricing_config_version = pol.config_version, delivery_quote_id = (p ->> 'quote_id')::uuid,
         delivery_distance_km = (p ->> 'distance_km')::numeric, delivery_formula_version = p ->> 'formula_version',
         products_ht = prod_ht, products_tva = prod_tva,
         service_fee_tax_category = svc_cat.code, service_fee_tax_rate = svc_cat.rate, service_fee_ht = svc_split.ht, service_fee_tva = svc_split.tva,
         delivery_fee_tax_category = dlv_cat.code, delivery_fee_tax_rate = dlv_cat.rate, delivery_fee_ht = dlv_split.ht, delivery_fee_tva = dlv_split.tva,
         priced_at = now()
   where id = oid;
  update public.delivery_quotes set used_by_order = oid where id = (p ->> 'quote_id')::uuid;

  -- The customer confirmed the total they saw; anything else is refused and
  -- nothing is kept (e.g. the first-order benefit was just used elsewhere).
  if o.total <> p_expected_total then
    raise exception 'the order total changed (% MAD instead of % MAD): review your order', o.total, p_expected_total using errcode = '40001';
  end if;

  insert into public.order_status_updates (order_id, status, message) values (oid, 'pending', null);
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (uid, 'order_created', uid,
          jsonb_build_object('order_id', oid, 'kitchen_id', p_kitchen, 'lines', jsonb_array_length(p -> 'lines'), 'subtotal', sub,
                             'promo_code', case when discount > 0 then promo_norm end, 'promo_discount', discount,
                             'first_order', fo_applied, 'service_fee', o.platform_service_fee, 'delivery_fee', o.delivery_fee,
                             'delivery_discount', fo_discount, 'total', o.total,
                             'distance_km', p ->> 'distance_km', 'quote_id', p ->> 'quote_id', 'pricing_policy_id', pol.id,
                             'config_version', pol.config_version, 'city', p ->> 'city'));
  perform set_config('loption.order_service', 'off', true);
  return oid;
end;
$$;
revoke all on function public.create_order(uuid, jsonb, uuid, text, text, numeric) from public, anon, service_role;
grant execute on function public.create_order(uuid, jsonb, uuid, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Phase 1C monitor: reviewed policies and client functions extended.
--    GENERATED by supabase/tools/generate_nutrition_monitor.py; do not
--    edit by hand.
-- ---------------------------------------------------------------------
-- BEGIN GENERATED MONITOR
create or replace function public.containment_violations()
returns table (category text, object text, problem text)
language plpgsql stable set search_path = ''
as $cv$
declare
  -- Supabase platform roles (image) + documented hosted-only roles.
  -- cli_login_postgres is created by the Supabase CLI itself (link/db push).
  allowed_roles text[] := array[
    'anon','authenticated','authenticator','dashboard_user','pgbouncer','postgres',
    'service_role','supabase_admin','supabase_auth_admin','supabase_etl_admin',
    'supabase_privileged_role','supabase_read_only_user','supabase_replication_admin',
    'supabase_storage_admin','supabase_functions_admin','supabase_realtime_admin',
    'cli_login_postgres','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker'];
  allowed_superusers text[] := array['supabase_admin'];
  allowed_bypassrls  text[] := array['postgres','service_role','supabase_admin',
    'supabase_etl_admin','supabase_read_only_user'];
  -- (group, member) pairs observed in the image, plus the CLI login role.
  allowed_members text[] := array[
    'anon<-authenticator','anon<-postgres','authenticated<-authenticator',
    'authenticated<-postgres','authenticator<-postgres','authenticator<-supabase_storage_admin',
    'service_role<-authenticator','service_role<-postgres',
    'supabase_privileged_role<-postgres','supabase_privileged_role<-supabase_etl_admin',
    'postgres<-cli_login_postgres'];
  privileged_groups text[] := array['anon','authenticated','service_role','authenticator',
    'postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin',
    'supabase_privileged_role','supabase_functions_admin','supabase_realtime_admin'];
  -- Event-trigger functions shipped by Supabase, plus the staging RLS
  -- auto-enable helper (it only runs ALTER TABLE ... ENABLE ROW LEVEL SECURITY).
  allowed_evt_functions text[] := array[
    'extensions.grant_pg_cron_access()','extensions.grant_pg_graphql_access()',
    'extensions.grant_pg_net_access()','extensions.set_graphql_placeholder()',
    'extensions.pgrst_ddl_watch()','extensions.pgrst_drop_watch()','public.rls_auto_enable()'];
  -- Schemas that hold Supabase platform objects (their grants are the
  -- platform's). Any OTHER schema a client role can use, and every view,
  -- materialized view or foreign table in the API schemas, is reported.
  platform_schemas text[] := array['auth','storage','extensions','graphql','realtime','vault',
    'pgsodium','pgsodium_masks','net','cron','supabase_functions','supabase_migrations',
    'pgbouncer','information_schema'];
  api_schemas text[] := array['public','graphql_public'];
  -- REVIEWED POLICY DEFINITIONS. Every policy in schema public (and, for
  -- the storage category, in schema storage) must match one entry exactly:
  --   table|name|PERMISSIVE or RESTRICTIVE|roles|command|USING|WITH CHECK
  -- (expressions as PostgreSQL 17 prints them in pg_policies, whitespace
  -- collapsed; '-' = none). A changed expression, command, role list or
  -- mode is reported even when the policy name is unchanged. Extend only
  -- through a reviewed commit.
  reviewed_public_policies text[] := array[
    'collaborator_analytics|staff_admin_all_collaborator_analytics|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborator_orders|collaborators_view_own_orders|PERMISSIVE|{public}|SELECT|(collaborator_id IN ( SELECT collaborators.id FROM public.collaborators WHERE (collaborators.user_id = auth.uid())))|-',
    'collaborator_orders|staff_admin_all_collaborator_orders|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborator_payouts|staff_admin_all_collaborator_payouts|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborators|collaborators_view_own|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'collaborators|staff_admin_all_collaborators|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'driver_push_tokens|Drivers can insert own push tokens|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'driver_push_tokens|Drivers can view own push tokens|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'drivers|Users can view own driver record|PERMISSIVE|{public}|SELECT|(auth.uid() = id)|-',
    'drivers|drivers_self_update_profile_location|PERMISSIVE|{authenticated}|UPDATE|(id = ( SELECT auth.uid() AS uid))|(id = ( SELECT auth.uid() AS uid))',
    'drivers|staff_admin_all_drivers|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'kitchens|kitchens_read_authenticated|PERMISSIVE|{authenticated}|SELECT|true|-',
    'meals|Anyone can view meals|PERMISSIVE|{public}|SELECT|true|-',
    'meals|Enable read access for all users|PERMISSIVE|{public}|SELECT|true|-',
    'meals|staff_admin_write_meals|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'order_items|Service role full access order_items|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'order_items|Users can view their own order items|PERMISSIVE|{public}|SELECT|(EXISTS ( SELECT 1 FROM public.orders WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid()))))|-',
    'order_items|staff_admin_all_order_items|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'order_status_updates|order_owner_read_status|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE ((o.id = order_status_updates.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)))))|-',
    'order_status_updates|staff_admin_read_status|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'orders|drivers_read_assigned_orders|PERMISSIVE|{authenticated}|SELECT|((driver_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.has_staff_role(''driver''::text) AS has_staff_role))|-',
    'orders|Service role full access|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'orders|Users can view their own orders|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'orders|staff_admin_all_orders|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'security_audit_log|security_audit_log_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'staff_roles|staff_roles_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'staff_roles|staff_roles_self_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'user_profiles|Service role has full access|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'user_profiles|Users can insert their own profile|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'user_profiles|Users can update their own profile|PERMISSIVE|{public}|UPDATE|(auth.uid() = user_id)|-',
    'user_profiles|Users can view their own profile|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'user_push_tokens|Users can insert own push tokens|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'user_push_tokens|Users can view own push tokens|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'notification_preferences|notification_prefs_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'notification_preferences|notification_prefs_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'notification_preferences|notification_prefs_owner_update|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))',
    'nutrition_daily_targets|nutrition_targets_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'nutrition_log_entries|nutrition_entries_owner_delete_mark|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))',
    'nutrition_log_entries|nutrition_entries_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'nutrition_log_entries|nutrition_entries_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'activity_daily_totals|activity_days_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'activity_daily_totals|activity_days_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'activity_daily_totals|activity_days_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'activity_daily_totals|activity_days_owner_update|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_sessions|workouts_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_sessions|workouts_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_sessions|workouts_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_exercises|gym_exercises_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_exercises|gym_exercises_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_exercises|gym_exercises_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_sets|gym_sets_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_sets|gym_sets_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_sets|gym_sets_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'driver_location_points|driver_locations_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'order_items|order_items_read_with_order|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE (o.id = order_items.order_id)))|-',
    'order_status_updates|order_status_read_with_order|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE (o.id = order_status_updates.order_id)))|-',
    'orders|orders_cashier_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''cashier''::text, kitchen_id))|-',
    'orders|orders_kitchen_staff_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''kitchen_staff''::text, kitchen_id))|-',
    'pricing_policies|pricing_policies_read_active|PERMISSIVE|{authenticated}|SELECT|active|-',
    'delivery_zones|delivery_zones_read_active|PERMISSIVE|{authenticated}|SELECT|active|-',
    'meal_option_groups|meal_option_groups_read_active|PERMISSIVE|{authenticated}|SELECT|active|-',
    'meal_option_groups|staff_admin_all_meal_option_groups|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'meal_options|meal_options_read_available|PERMISSIVE|{authenticated}|SELECT|(available AND (EXISTS ( SELECT 1 FROM public.meal_option_groups g WHERE ((g.id = meal_options.group_id) AND g.active))))|-',
    'meal_options|staff_admin_all_meal_options|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)'];
  reviewed_storage_policies text[] := array[
    'objects|staff_admin_delete_meal_images|PERMISSIVE|{authenticated}|DELETE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_insert_meal_images|PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))',
    'objects|staff_admin_select_meal_images|PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_update_meal_images|PERMISSIVE|{authenticated}|UPDATE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))'];
  -- SECURITY DEFINER functions a client role may execute (authenticated only).
  client_definer_functions text[] := array[
    'public.has_staff_role(text)','public.assign_staff_role(uuid,text,uuid)',
    'public.revoke_staff_role(uuid,text,uuid)','public.set_driver_availability(boolean)',
    'public.register_push_token(text,text)','public.deactivate_push_token(text)','public.delete_my_account(text)','public.order_confirm(uuid)','public.order_kitchen_update(uuid,text)','public.order_assign_driver(uuid,uuid)','public.order_driver_update(uuid,text)','public.order_cancel(uuid,text)','public.order_set_payment(uuid,text)','public.driver_report_location(uuid,doubleprecision,doubleprecision,real,timestampwithtimezone)','public.create_order(uuid,jsonb,uuid,text,text,numeric)','public.checkout_preview(uuid,jsonb,text)','public.meal_popularity(uuid)','public.phone_otp_verify(uuid,text)'];
  -- Functions created by the Phase 1C migrations, fingerprinted as
  --   signature|security definer|configuration|md5(body)
  -- so a CREATE OR REPLACE that weakens one is reported.
  reviewed_functions text[] := array[
    'public.assign_staff_role(uuid,text,uuid)|true|search_path=""|554f8a3f6bba9e6a3bc9c4ced7938cca',
    'public.enforce_driver_availability()|true|search_path=""|da0e53b932e051e9a371cb9fb2e64ce0',
    'public.enforce_profile_privilege_guard()|false|search_path=""|777cbb1b279b251dbb5380675638c1eb',
    'public.has_staff_role(text)|true|search_path=""|f44b74472038a40e54a5875a1ad1a835',
    'public.revoke_staff_role(uuid,text,uuid)|true|search_path=""|33bdc8cefd5a08a7c32c5ad9a2883b7f',
    'public.security_audit_log_append_only()|false|search_path=""|9283a0cd3cd689131cb43161db1f0c1e',
    'public.set_driver_availability(boolean)|true|search_path=""|387497cf2e12e33c2a3e528dfec585b7',
    'public.staff_roles_driver_offline()|true|search_path=""|6c92d893f56587ae443a911badcfd922',
    'public.staff_roles_no_truncate()|false|search_path=""|5b001f4e82a1558a7fb36fb7f42d64e5',
    'public.staff_roles_require_admin()|true|search_path=""|44a2aecd08c07582112b0e65beb07aa5',
    'public.staff_roles_serialize()|false|search_path=""|cf5ff3a87980a74d971b17c7fa89a16a'];
begin
  -- ============================ drift (U3) ============================
  return query select 'drift'::text, r.rolname::text, 'unexpected database role'::text
    from pg_roles r where r.rolname !~ '^pg_' and r.rolname <> all (allowed_roles);
  return query select 'drift', r.rolname::text, 'unexpected SUPERUSER role'
    from pg_roles r where r.rolsuper and r.rolname <> all (allowed_superusers);
  return query select 'drift', r.rolname::text, 'unexpected BYPASSRLS role'
    from pg_roles r where r.rolbypassrls and r.rolname <> all (allowed_bypassrls);
  return query select 'drift', r.rolname::text, 'client role has elevated attributes (superuser/bypassrls/createrole/createdb/login)'
    from pg_roles r where r.rolname in ('anon','authenticated')
     and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolcanlogin);
  return query select 'drift', g.rolname || '<-' || m.rolname, 'unexpected membership in a privileged or client role'
    from pg_auth_members a join pg_roles g on g.oid = a.roleid join pg_roles m on m.oid = a.member
   where (g.rolname = any (privileged_groups) or m.rolname in ('anon','authenticated','service_role'))
     and (g.rolname || '<-' || m.rolname) <> all (allowed_members);
  -- ============================ drift (U4) ============================
  -- schema-qualified name built explicitly (independent of search_path)
  return query select 'drift', e.evtname::text, 'unexpected event trigger function ' || f.fn
    from pg_event_trigger e
    cross join lateral (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = e.evtfoid) as f(fn)
   where f.fn <> all (allowed_evt_functions);
  -- ============================ drift (U5) ============================
  return query select 'drift', 'authenticator', 'authenticator must be NOSUPERUSER, NOBYPASSRLS, NOINHERIT'
    from pg_roles r where r.rolname = 'authenticator' and (r.rolsuper or r.rolbypassrls or r.rolinherit);
  return query select 'drift', 'authenticator', 'authenticator role missing'
   where not exists (select 1 from pg_roles where rolname = 'authenticator');
  -- ============================ drift (U6) ============================
  return query select 'drift', 'schema ' || n.nspname || ' / ' || x.grantee, 'client or PUBLIC can CREATE in schema'
    from pg_namespace n
    cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
                          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                         where a.privilege_type = 'CREATE') x
   where n.nspname in ('public','extensions','graphql_public','auth','storage','realtime','vault')
     and x.grantee in ('PUBLIC','anon','authenticated','authenticator');
  -- Auth hooks: a custom access-token hook could rewrite the JWT role
  -- claim (e.g. to service_role). Hooks are functions the Auth service
  -- (supabase_auth_admin) executes. Reported: (1) any non-auth function
  -- explicitly granted to supabase_auth_admin; (2) any non-auth function
  -- with the hook signature (one jsonb argument, returns jsonb) that
  -- supabase_auth_admin can EFFECTIVELY execute (incl. through PUBLIC).
  -- The hosted Auth hook configuration itself is not visible in SQL.
  if to_regrole('supabase_auth_admin') is not null then
    return query select 'drift', p.oid::regprocedure::text, 'function explicitly executable by supabase_auth_admin (possible Auth hook)'
      from pg_proc p cross join lateral aclexplode(p.proacl) a
     where p.proacl is not null and a.privilege_type = 'EXECUTE'
       and a.grantee = 'supabase_auth_admin'::regrole
       and p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema');
    return query select 'drift', p.oid::regprocedure::text, 'hook-shaped function (jsonb -> jsonb) effectively executable by supabase_auth_admin (possible Auth hook)'
      from pg_proc p
     where p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema')
       and p.pronargs = 1 and p.proargtypes[0] = 'jsonb'::regtype and p.prorettype = 'jsonb'::regtype
       and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
       and not exists (select 1 from aclexplode(coalesce(p.proacl, '{}')) a
                        where a.privilege_type = 'EXECUTE' and a.grantee = 'supabase_auth_admin'::regrole);
  end if;
  -- API-schema relations: owner, RLS, unexpected grantees
  return query select 'drift', n.nspname || '.' || c.relname, 'relation not owned by postgres (owner ' || c.relowner::regrole::text || ')'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
     and c.relowner <> 'postgres'::regrole;
  return query select 'drift', 'public.' || c.relname, 'row level security disabled'
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
     and not c.relrowsecurity;
  return query select distinct 'drift', 'public.' || c.relname || ' / ' || a.grantee::regrole::text, 'unexpected table grantee'
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and c.relacl is not null
     and a.grantee <> 0
     and a.grantee::regrole::text not in ('postgres','anon','authenticated','service_role');
  return query select distinct 'drift', 'public.' || c.relname || ' / PUBLIC', 'table privilege granted to PUBLIC'
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and c.relacl is not null
     and a.grantee = 0;

  -- ========================= containment =========================
  -- Policies: exact reviewed definitions (command, roles, mode, USING,
  -- WITH CHECK), not names.
  return query select 'containment', 'public.' || p.tablename || '.' || p.policyname,
                      'policy not reviewed, or its command/roles/mode/USING/WITH CHECK differ from the reviewed definition'
    from pg_policies p
   where p.schemaname = 'public'
     and (p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::text || '|' || p.cmd || '|'
          || coalesce(regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|'
          || coalesce(regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')) <> all (reviewed_public_policies);
  return query select 'containment', 'public.' || split_part(r, '|', 1) || '.' || split_part(r, '|', 2), 'reviewed policy missing'
    from unnest(reviewed_public_policies) r
   where not exists (select 1 from pg_policies p where p.schemaname = 'public'
                        and p.tablename = split_part(r, '|', 1) and p.policyname = split_part(r, '|', 2));
  return query select 'containment', 'public.' || c.relname || ' / anon ' || v.p, 'anon privilege other than SELECT on meals'
    from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('anon', c.oid, v.p)
     and not (c.relname = 'meals' and v.p = 'SELECT');
  return query select 'containment', 'public.' || c.relname || ' / authenticated ' || v.p, 'authenticated holds a privilege that RLS does not govern'
    from pg_class c cross join (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('authenticated', c.oid, v.p);
  return query select 'containment', 'public.' || t || ' / ' || r || ' TRUNCATE', 'TRUNCATE on an authority or append-only table'
    from unnest(array['staff_roles','security_audit_log','kitchens']) t cross join unnest(array['service_role','anon','authenticated']) r
   where to_regclass('public.' || t) is not null and has_table_privilege(r, ('public.' || t)::regclass, 'TRUNCATE');
  -- Views run with their owner's rights (postgres bypasses RLS) unless
  -- security_invoker is set; none is reviewed for client access.
  return query select 'containment', n.nspname || '.' || c.relname,
                      'view / materialized view / foreign table accessible to a client role (not reviewed; may bypass RLS of its base tables)'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any (api_schemas) and c.relkind in ('v','m','f')
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'));
  return query select 'containment', n.nspname || '.' || c.relname, 'client-accessible relation in a schema that is not reviewed'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r','p','v','m','f')
     and n.nspname <> all (api_schemas) and n.nspname <> all (platform_schemas) and n.nspname !~ '^pg_'
     and (has_schema_privilege('anon', n.oid, 'USAGE') or has_schema_privilege('authenticated', n.oid, 'USAGE'))
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'));
  return query select 'containment', x.col, 'authenticated may UPDATE a privileged column'
    from (values ('user_profiles','role'),('user_profiles','is_admin'),('user_profiles','user_id'),
                 ('drivers','status'),('drivers','commission_rate'),('drivers','total_earned'),
                 ('drivers','weekly_earnings'),('drivers','email'),('drivers','national_id'),('drivers','id')) v(t, c)
    cross join lateral (select v.t || '.' || v.c as col) x
   where to_regclass('public.' || v.t) is not null
     and has_column_privilege('authenticated', ('public.' || v.t)::regclass, v.c, 'UPDATE');
  return query select 'containment', 'public.' || t, 'authenticated has access to a retired or service-only table'
    from unnest(array['daily_closings','kiosks','products','stock_movements','admins','bank_accounts',
                      'admin_logs','financial_transactions','platform_settings']) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'));
  return query select 'containment', 'public.' || t, 'authenticated can write a server-managed table'
    from unnest(array['staff_roles','security_audit_log','kitchens','order_status_updates']) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'));
  -- Functions
  return query select 'containment', p.oid::regprocedure::text, 'unsafe function executable by a client role'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_order_transaction','calculate_driver_weekly_earnings','containment_violations')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  return query select 'containment', p.oid::regprocedure::text, 'public function executable by anon'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype);
  return query select 'containment', p.oid::regprocedure::text, 'SECURITY DEFINER function executable by a client role is not reviewed'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or replace(p.oid::regprocedure::text, ' ', '') <> all (client_definer_functions));
  return query select 'containment', p.oid::regprocedure::text, 'SECURITY DEFINER function without a fixed search_path'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%');
  return query select 'containment', split_part(r, '|', 1), 'reviewed function changed (body, SECURITY DEFINER or configuration differ)'
    from unnest(reviewed_functions) r
    join pg_proc p on replace(p.oid::regprocedure::text, ' ', '') = split_part(r, '|', 1)
   where (replace(p.oid::regprocedure::text, ' ', '') || '|' || p.prosecdef::text || '|'
          || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || md5(p.prosrc)) <> r;
  -- Rewrite rules (review 2026-10-26 L3): no table in public has a reviewed
  -- rule. A rule can silently discard or redirect writes (for example
  -- DO INSTEAD NOTHING on security_audit_log), which no policy, grant or
  -- trigger check would show. A view's own _RETURN rule is not a rule here.
  return query select 'containment', 'rule ' || c.relname || '.' || w.rulename, 'unexpected rewrite rule'
    from pg_rewrite w join pg_class c on c.oid = w.ev_class
   where c.relnamespace = 'public'::regnamespace and w.rulename <> '_RETURN';
  -- Guard triggers and constraints
  return query select 'containment', 'trigger ' || x.t || '.' || x.g, 'required guard trigger missing or disabled'
    from (values ('user_profiles','trg_enforce_profile_privilege_guard'),
                 ('drivers','trg_enforce_driver_availability'),
                 ('security_audit_log','security_audit_log_append_only'),
                 ('security_audit_log','security_audit_log_no_truncate'),
                 ('staff_roles','trg_staff_roles_serialize'),
                 ('staff_roles','trg_staff_roles_require_admin'),
                 ('staff_roles','trg_staff_roles_driver_offline'),
                 ('staff_roles','trg_staff_roles_no_truncate')) x(t, g)
   where not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = to_regclass('public.' || x.t) and tg.tgname = x.g and tg.tgenabled <> 'D');
  return query select 'containment', 'public.drivers', 'availability check constraint missing or not the reviewed definition'
   where not exists (select 1 from pg_constraint
                      where conrelid = to_regclass('public.drivers') and conname = 'drivers_status_availability_check'
                        and pg_get_constraintdef(oid) = 'CHECK ((status = ANY (ARRAY[''online''::text, ''offline''::text])))');
  return query select 'containment', 'public.drivers.status', 'drivers.status allows NULL'
    from pg_attribute a
   where a.attrelid = to_regclass('public.drivers') and a.attname = 'status' and not a.attnotnull;
  -- State invariants (dynamic SQL: the tables exist only after the migration)
  if to_regclass('public.staff_roles') is not null then
    return query execute
      $q$select 'containment'::text, 'public.staff_roles'::text, 'no active admin staff role'::text
          where not exists (select 1 from public.staff_roles where role = 'admin' and is_active)$q$;
    return query execute
      $q$select 'containment'::text, 'public.drivers ' || d.id::text, 'driver online without an active driver approval'::text
           from public.drivers d
          where d.status = 'online'
            and not exists (select 1 from public.staff_roles s
                             where s.user_id = d.id and s.role = 'driver' and s.is_active)$q$;
  end if;
  return query select 'containment', 'default privileges ' || coalesce(d.defaclnamespace::regnamespace::text, '(global)')
                    || ' ' || d.defaclobjtype::text, 'migration role default privileges grant client access'
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'));
  return query select 'containment', 'default privileges (global) f', 'built-in default lets PUBLIC execute new functions'
   where not exists (select 1 from pg_default_acl d
                      where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f');

  -- ============================ storage ============================
  if to_regclass('storage.objects') is null then
    return query select 'storage', 'storage.objects', 'storage schema absent: storage containment not verifiable here';
  else
    -- every policy on every storage table (all commands, incl. SELECT /
    -- listing) must match a reviewed definition exactly
    return query select 'storage', 'storage.' || p.tablename || '.' || p.policyname,
                        'storage policy not reviewed, or its command/roles/mode/USING/WITH CHECK differ from the reviewed definition'
      from pg_policies p
     where p.schemaname = 'storage'
       and (p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::text || '|' || p.cmd || '|'
            || coalesce(regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|'
            || coalesce(regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')) <> all (reviewed_storage_policies);
    return query select 'storage', 'storage.' || split_part(r, '|', 1) || '.' || split_part(r, '|', 2), 'reviewed storage policy missing'
      from unnest(reviewed_storage_policies) r
     where not exists (select 1 from pg_policies p where p.schemaname = 'storage'
                          and p.tablename = split_part(r, '|', 1) and p.policyname = split_part(r, '|', 2));
    return query execute
      $q$select 'storage'::text, 'bucket ' || b.id, 'public bucket other than meal-images'::text
           from storage.buckets b where b.public and b.id <> 'meal-images'$q$;
    -- CTO-approved meal-images limits (5 MiB; jpeg/png/webp only)
    return query execute
      $q$select 'storage'::text, 'bucket meal-images',
                ('size/MIME limits not as approved (file_size_limit=' || coalesce(b.file_size_limit::text, 'NULL')
                 || ', allowed_mime_types=' || coalesce(b.allowed_mime_types::text, 'NULL') || ')')::text
           from storage.buckets b
          where b.id = 'meal-images'
            and (b.file_size_limit is distinct from 5242880
                 or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp']::text[])$q$;
    return query execute
      $q$select 'storage'::text, 'bucket meal-images', 'bucket missing'::text
          where not exists (select 1 from storage.buckets where id = 'meal-images')$q$;
  end if;
end
$cv$;
-- END GENERATED MONITOR

-- ---------------------------------------------------------------------
-- 9. Postcondition
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
  f text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 checkout experience postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure) <> '39523bf8d3b37e19078633046313f8eb' then
    raise exception 'V1 checkout experience postcondition failed: the monitor is not the reviewed definition';
  end if;
  if exists (select 1 from public.promotions where audience = 'code') or exists (select 1 from public.meal_option_groups)
     or exists (select 1 from public.user_profiles where phone_verified_at is not null) then
    raise exception 'V1 checkout experience postcondition failed: the migration creates no code, option or verified phone';
  end if;
  foreach f in array array['public.checkout_preview(uuid,jsonb,text)', 'public.create_order(uuid,jsonb,uuid,text,text,numeric)',
                           'public.meal_popularity(uuid)', 'public.phone_otp_verify(uuid,text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'V1 checkout experience postcondition failed: % must be executable by signed-in customers only', f;
    end if;
  end loop;
  foreach f in array array['public.checkout_price(uuid,uuid,jsonb,text,boolean)', 'public.phone_otp_issue(uuid,text)',
                           'public.phone_otp_mark(uuid,boolean,text,text)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'V1 checkout experience postcondition failed: % is not for clients', f;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.user_profiles', 'phone_verified_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_profiles', 'phone_e164', 'UPDATE')
     or has_table_privilege('authenticated', 'public.phone_verifications', 'SELECT')
     or has_table_privilege('authenticated', 'public.promo_code_attempts', 'SELECT') then
    raise exception 'V1 checkout experience postcondition failed: phone verification and promo attempts are server-only';
  end if;
  if to_regprocedure('public.create_order(uuid,jsonb,uuid,text)') is not null then
    raise exception 'V1 checkout experience postcondition failed: the previous create_order() still exists';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 checkout experience: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_checkout_gate_ok values ('postcondition');
end
$post$;

commit;
