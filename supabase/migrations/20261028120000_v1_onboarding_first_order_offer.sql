-- =====================================================================
-- L'OPTION V1 — nutrition onboarding, delivery address and the
-- first-order free-delivery offer.
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on Phase 1C (20261016170000, revision 7), which is itself
-- unapproved and NOT READY FOR STAGING. Applying this file does not
-- authorize deployment and does not enable checkout.
--
-- Role: must run as postgres. One transaction with a deferred commit gate
-- (same pattern as Phase 1C): COMMIT fails unless the precondition AND the
-- postcondition both completed, also under psql ON_ERROR_ROLLBACK=on.
-- Rollback: supabase/rollback/v1_onboarding_offer_rollback.sql.
--
-- What this adds
--  1. user_profiles: server-derived nutrition estimate (bmr_kcal,
--     tdee_kcal, nutrition_formula, nutrition_calculated_at), onboarding
--     completion time, a confirmed default delivery address, and the
--     first-order offer status shown by the app.
--     * BMR/TDEE are computed by a trigger from the stored answers
--       (Mifflin-St Jeor, see public.estimate_energy). Clients have no
--       UPDATE privilege on the derived columns; the trigger overwrites
--       them for every writer anyway.
--     * Client writes of age/weight/height/activity/sex are range-checked.
--     * onboarding_completed_at: a client may set it once, only when all
--       required answers are present; the server stamps now(). It cannot
--       be cleared or moved by a client afterwards.
--  2. The first-order free-delivery offer, enforced on the server:
--     * public.promotions (configuration) and public.promotion_redemptions
--       (one applied redemption per account at most: partial unique index
--       plus a per-account advisory lock). Both tables have RLS enabled,
--       no policies and no client privileges.
--     * public.apply_first_order_offer(order_id): NOT client-executable.
--       To be called by the trusted order-creation function (not built
--       yet; checkout stays disabled) in the same transaction that creates
--       the order. A failed or abandoned checkout rolls back and consumes
--       nothing.
--     * The offer counts as USED when an order carrying it is committed.
--       It is RELEASED (account eligible again) only if that order moves
--       to a status listed in promotions.release_on_order_statuses
--       (default cancelled, rejected; those statuses do not exist in the
--       orders CHECK constraint yet — Phase 2 order state machine).
--     * user_profiles.first_order_offer_status mirrors eligibility for
--       display only (eligible / applied / not_eligible / unavailable). It
--       is maintained by triggers and is never trusted for pricing.
--
-- Phase 1C containment: this file adds no RLS policy, no client-executable
-- SECURITY DEFINER function, no view and no client table privilege, so
-- public.containment_violations() stays at zero rows (checked in the
-- postcondition). It does not modify any Phase 1C object.
--
-- Not decided (kept configurable, nothing invented): minimum order value,
-- expiry, exclusions, stacking, which statuses release the offer, whether
-- an undeliverable order releases it. See docs/v1/V1_ONBOARDING_AUTH_OFFER.md.
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 onboarding/offer: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_offer_gate_ok (step text primary key) on commit drop;
create temp table v1_offer_gate (
  step text constraint v1_offer_guard_did_not_pass references v1_offer_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_offer_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition: Phase 1C core is applied and reports no violations;
--    none of the objects this file creates exists yet (first application
--    only; a re-run is refused rather than silently repaired).
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
begin
  if to_regprocedure('public.containment_violations()') is null
     or to_regprocedure('public.has_staff_role(text)') is null then
    raise exception 'V1 onboarding/offer: Phase 1C core migration (20261016170000) is not applied; aborting';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 onboarding/offer: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  select string_agg(x.o, ', ') into bad
    from (values (to_regclass('public.promotions')::text, 'public.promotions'),
                 (to_regclass('public.promotion_redemptions')::text, 'public.promotion_redemptions'),
                 (to_regprocedure('public.estimate_energy(text,integer,numeric,numeric,text)')::text, 'public.estimate_energy'),
                 (to_regprocedure('public.apply_first_order_offer(uuid)')::text, 'public.apply_first_order_offer'))
         as x(found, o)
   where x.found is not null;
  if bad is not null then
    raise exception 'V1 onboarding/offer: objects already exist (re-run or unknown objects), refusing: %', bad;
  end if;
  select string_agg(c, ', ') into bad
    from unnest(array['bmr_kcal','tdee_kcal','nutrition_formula','nutrition_calculated_at','onboarding_completed_at',
                      'delivery_address','delivery_latitude','delivery_longitude','delivery_address_updated_at',
                      'first_order_offer_status']) c
   where exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_profiles' and column_name = c);
  if bad is not null then
    raise exception 'V1 onboarding/offer: user_profiles already has columns %, refusing', bad;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
              and column_name in ('delivery_fee_before_discount', 'delivery_discount')) then
    raise exception 'V1 onboarding/offer: orders already has the discount columns, refusing';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 onboarding/offer: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_offer_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. Energy estimate (pure function).
--    Mifflin-St Jeor (1990):
--      BMR = 10*kg + 6.25*cm - 5*age + 5     (sex input 'man')
--      BMR = 10*kg + 6.25*cm - 5*age - 161   (sex input 'woman')
--    TDEE = BMR * activity multiplier:
--      sedentary 1.2, light 1.375, moderate 1.55, active 1.725,
--      very_active 1.9.
--    Both rounded to whole kcal (TDEE from the unrounded BMR). Returns
--    NULLs when an input is missing, out of range, or the sex input is
--    'unspecified' (no estimate is invented). Same rules as the app's
--    src/nutrition/energy.ts. An estimate, not medical advice.
-- ---------------------------------------------------------------------
create function public.estimate_energy(
  p_sex text, p_age integer, p_weight_kg numeric, p_height_cm numeric, p_activity text,
  out bmr_kcal integer, out tdee_kcal integer)
language sql immutable set search_path = ''
as $$
  with i as (
    select case when p_sex in ('man', 'woman')
                 and p_age between 13 and 100
                 and p_weight_kg between 30 and 300
                 and p_height_cm between 100 and 250
                then 10 * p_weight_kg + 6.25 * p_height_cm - 5 * p_age + case p_sex when 'man' then 5 else -161 end
           end as bmr,
           case p_activity when 'sedentary' then 1.2 when 'light' then 1.375 when 'moderate' then 1.55
                           when 'active' then 1.725 when 'very_active' then 1.9 end as factor
  )
  select round(bmr)::integer, round(bmr * factor)::integer from i
$$;
revoke all on function public.estimate_energy(text, integer, numeric, numeric, text) from public, anon;
grant execute on function public.estimate_energy(text, integer, numeric, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. user_profiles columns (derived values are not client-writable).
-- ---------------------------------------------------------------------
alter table public.user_profiles
  add column bmr_kcal integer,
  add column tdee_kcal integer,
  add column nutrition_formula text,
  add column nutrition_calculated_at timestamptz,
  add column onboarding_completed_at timestamptz,
  add column delivery_address text,
  add column delivery_latitude numeric,
  add column delivery_longitude numeric,
  add column delivery_address_updated_at timestamptz,
  add column first_order_offer_status text;

alter table public.user_profiles
  add constraint user_profiles_first_order_offer_status_check
  check (first_order_offer_status in ('eligible', 'applied', 'not_eligible', 'unavailable'));

-- Client-writable additions only. bmr_kcal, tdee_kcal, nutrition_*,
-- delivery_address_updated_at and first_order_offer_status stay
-- server-managed (no UPDATE privilege for authenticated).
grant update (onboarding_completed_at, delivery_address, delivery_latitude, delivery_longitude)
  on public.user_profiles to authenticated;

-- Validation and derived values. SECURITY INVOKER: current_user is the API
-- role of the caller, so client writes are validated while trusted roles
-- (migrations, service_role, the definer functions below) are not
-- restricted. Validation applies only to values that change, so legacy rows
-- with out-of-range data are not blocked from unrelated updates.
create function public.user_profiles_v1_derive()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  is_client boolean := current_user in ('anon', 'authenticated');
  est record;
  addr text;
begin
  if is_client then
    if new.gender is not null and (tg_op = 'INSERT' or new.gender is distinct from old.gender)
       and new.gender not in ('man', 'woman', 'unspecified') then
      raise exception 'gender must be man, woman or unspecified' using errcode = '22023';
    end if;
    if new.age is not null and (tg_op = 'INSERT' or new.age is distinct from old.age)
       and new.age not between 13 and 100 then
      raise exception 'age must be between 13 and 100 years' using errcode = '22023';
    end if;
    if new.weight is not null and (tg_op = 'INSERT' or new.weight is distinct from old.weight)
       and new.weight not between 30 and 300 then
      raise exception 'weight must be between 30 and 300 kg' using errcode = '22023';
    end if;
    if new.height is not null and (tg_op = 'INSERT' or new.height is distinct from old.height)
       and new.height not between 100 and 250 then
      raise exception 'height must be between 100 and 250 cm' using errcode = '22023';
    end if;
    if new.activity_level is not null and (tg_op = 'INSERT' or new.activity_level is distinct from old.activity_level)
       and new.activity_level not in ('sedentary', 'light', 'moderate', 'active', 'very_active') then
      raise exception 'unknown activity level' using errcode = '22023';
    end if;

    -- Onboarding completion: set once, stamped by the server, never cleared by a client.
    if tg_op = 'UPDATE' and old.onboarding_completed_at is not null then
      new.onboarding_completed_at := old.onboarding_completed_at;
    elsif new.onboarding_completed_at is not null then
      if new.gender is null or new.age is null or new.weight is null or new.height is null
         or new.activity_level is null then
        raise exception 'onboarding cannot be completed: sex input, age, weight, height and activity level are required'
          using errcode = '22023';
      end if;
      new.onboarding_completed_at := now();
    end if;

    -- Delivery address: a confirmed text address; coordinates optional, both or neither.
    if tg_op = 'INSERT'
       or new.delivery_address is distinct from old.delivery_address
       or new.delivery_latitude is distinct from old.delivery_latitude
       or new.delivery_longitude is distinct from old.delivery_longitude then
      addr := nullif(btrim(new.delivery_address), '');
      if addr is not null and char_length(addr) not between 5 and 300 then
        raise exception 'delivery address must be 5 to 300 characters' using errcode = '22023';
      end if;
      if (new.delivery_latitude is null) <> (new.delivery_longitude is null)
         or new.delivery_latitude not between -90 and 90
         or new.delivery_longitude not between -180 and 180
         or (addr is null and new.delivery_latitude is not null) then
        raise exception 'delivery coordinates must be a valid pair attached to an address' using errcode = '22023';
      end if;
      new.delivery_address := addr;
    end if;
  end if;

  if tg_op = 'INSERT'
     or new.delivery_address is distinct from old.delivery_address
     or new.delivery_latitude is distinct from old.delivery_latitude
     or new.delivery_longitude is distinct from old.delivery_longitude then
    new.delivery_address_updated_at := case when new.delivery_address is null then null else now() end;
  elsif is_client then
    new.delivery_address_updated_at := old.delivery_address_updated_at;
  end if;

  select e.bmr_kcal, e.tdee_kcal into est
    from public.estimate_energy(new.gender, new.age, new.weight, new.height, new.activity_level) e;
  if tg_op = 'INSERT' or est.bmr_kcal is distinct from old.bmr_kcal or est.tdee_kcal is distinct from old.tdee_kcal then
    new.nutrition_calculated_at := case when est.bmr_kcal is null then null else now() end;
  else
    new.nutrition_calculated_at := old.nutrition_calculated_at;
  end if;
  new.bmr_kcal := est.bmr_kcal;
  new.tdee_kcal := est.tdee_kcal;
  new.nutrition_formula := case when est.bmr_kcal is null then null else 'mifflin_st_jeor_1990' end;
  return new;
end;
$$;
revoke all on function public.user_profiles_v1_derive() from public, anon, authenticated;
create trigger trg_user_profiles_v1_derive
  before insert or update on public.user_profiles
  for each row execute function public.user_profiles_v1_derive();

-- ---------------------------------------------------------------------
-- 3. Orders: record the delivery discount applied by the server.
-- ---------------------------------------------------------------------
alter table public.orders
  add column delivery_fee_before_discount numeric,
  add column delivery_discount numeric not null default 0;
alter table public.orders
  add constraint orders_delivery_discount_check check (delivery_discount >= 0);

-- ---------------------------------------------------------------------
-- 4. Promotions (configuration) and redemptions. Server-only tables.
-- ---------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('free_delivery')),
  audience text not null check (audience in ('first_order')),
  is_active boolean not null default false,
  -- Undecided business rules stay NULL (= no such rule) until approved.
  starts_at timestamptz,
  ends_at timestamptz,
  min_order_subtotal numeric check (min_order_subtotal >= 0),
  release_on_order_statuses text[] not null default array['cancelled', 'rejected'],
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.promotions enable row level security;
revoke all on public.promotions from public, anon, authenticated;
grant select, insert, update, delete on public.promotions to service_role;

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- SET NULL keeps the redemption (and its "used" effect) if an order row is
  -- deleted, so deleting an order never re-grants the benefit.
  order_id uuid references public.orders(id) on delete set null,
  status text not null check (status in ('applied', 'released')),
  discount_amount numeric not null check (discount_amount >= 0),
  applied_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  check ((status = 'released') = (released_at is not null))
);
create unique index promotion_redemptions_one_applied_per_user
  on public.promotion_redemptions (promotion_id, user_id) where status = 'applied';
create unique index promotion_redemptions_order_unique
  on public.promotion_redemptions (order_id) where order_id is not null;
create index promotion_redemptions_user on public.promotion_redemptions (user_id);
alter table public.promotion_redemptions enable row level security;
revoke all on public.promotion_redemptions from public, anon, authenticated;
grant select on public.promotion_redemptions to service_role;

insert into public.promotions (code, kind, audience, is_active, description)
values ('FIRST_ORDER_FREE_DELIVERY', 'free_delivery', 'first_order', true,
        'Free delivery on the first order of an account. No minimum order, expiry, exclusions or stacking rules have been approved; they stay unset until decided.');

-- ---------------------------------------------------------------------
-- 5. Eligibility (server-side, the only source of truth).
--    eligible     promotion active and in its window; the account has no
--                 applied redemption and no order other than p_ignore_order
--                 outside release_on_order_statuses.
--    applied      the account holds an applied redemption.
--    not_eligible the account already has an order.
--    unavailable  promotion missing, inactive or outside its window.
--    min_order_subtotal is enforced in apply_first_order_offer only.
-- ---------------------------------------------------------------------
create function public.first_order_offer_status_for(p_user_id uuid, p_ignore_order uuid default null)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  promo public.promotions%rowtype;
begin
  select * into promo from public.promotions where code = 'FIRST_ORDER_FREE_DELIVERY';
  if not found or not promo.is_active
     or (promo.starts_at is not null and now() < promo.starts_at)
     or (promo.ends_at is not null and now() >= promo.ends_at) then
    return 'unavailable';
  end if;
  if exists (select 1 from public.promotion_redemptions r
              where r.promotion_id = promo.id and r.user_id = p_user_id and r.status = 'applied') then
    return 'applied';
  end if;
  if exists (select 1 from public.orders o
              where o.user_id = p_user_id
                and o.id is distinct from p_ignore_order
                and coalesce(o.status, '') <> all (promo.release_on_order_statuses)) then
    return 'not_eligible';
  end if;
  return 'eligible';
end;
$$;
revoke all on function public.first_order_offer_status_for(uuid, uuid) from public, anon, authenticated;

-- Display mirror on the profile. Definer so it can read the server-only
-- tables when the triggering write comes from a client.
create function public.first_order_offer_refresh(p_user_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.user_profiles p
     set first_order_offer_status = public.first_order_offer_status_for(p.user_id)
   where p.user_id = p_user_id
     and p.first_order_offer_status is distinct from public.first_order_offer_status_for(p.user_id);
$$;
revoke all on function public.first_order_offer_refresh(uuid) from public, anon, authenticated;

create function public.first_order_offer_profile_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.first_order_offer_status := case when new.user_id is null then null
                                       else public.first_order_offer_status_for(new.user_id) end;
  return new;
end;
$$;
revoke all on function public.first_order_offer_profile_insert() from public, anon, authenticated;
create trigger trg_first_order_offer_profile_insert
  before insert on public.user_profiles
  for each row execute function public.first_order_offer_profile_insert();

-- A client may not change the mirror through any path; definer writes may.
create function public.first_order_offer_profile_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.first_order_offer_status is distinct from old.first_order_offer_status then
    new.first_order_offer_status := old.first_order_offer_status;
  end if;
  return new;
end;
$$;
revoke all on function public.first_order_offer_profile_guard() from public, anon, authenticated;
create trigger trg_first_order_offer_profile_guard
  before update on public.user_profiles
  for each row execute function public.first_order_offer_profile_guard();

-- Order changes: release a redemption when its order reaches a release
-- status, then refresh the affected accounts. Only status/user_id changes
-- fire it (driver location updates do not).
create function public.first_order_offer_on_order_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  promo public.promotions%rowtype;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    select * into promo from public.promotions where code = 'FIRST_ORDER_FREE_DELIVERY';
    if found and coalesce(new.status, '') = any (promo.release_on_order_statuses) then
      update public.promotion_redemptions
         set status = 'released', released_at = now(), release_reason = 'order status ' || new.status
       where order_id = new.id and status = 'applied';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.user_id is not null then
    perform public.first_order_offer_refresh(old.user_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    perform public.first_order_offer_refresh(new.user_id);
  end if;
  return null;
end;
$$;
revoke all on function public.first_order_offer_on_order_change() from public, anon, authenticated;
create trigger trg_first_order_offer_order_change
  after insert or delete or update of status, user_id on public.orders
  for each row execute function public.first_order_offer_on_order_change();

create function public.first_order_offer_on_redemption_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.first_order_offer_refresh(coalesce(new.user_id, old.user_id));
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    perform public.first_order_offer_refresh(old.user_id);
  end if;
  return null;
end;
$$;
revoke all on function public.first_order_offer_on_redemption_change() from public, anon, authenticated;
create trigger trg_first_order_offer_redemption_change
  after insert or update or delete on public.promotion_redemptions
  for each row execute function public.first_order_offer_on_redemption_change();

-- Configuration changes (activation, window, release statuses) refresh every profile.
create function public.first_order_offer_on_promotion_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.user_profiles p
     set first_order_offer_status = public.first_order_offer_status_for(p.user_id)
   where p.user_id is not null
     and p.first_order_offer_status is distinct from public.first_order_offer_status_for(p.user_id);
  return null;
end;
$$;
revoke all on function public.first_order_offer_on_promotion_change() from public, anon, authenticated;
create trigger trg_first_order_offer_promotion_change
  after insert or update or delete on public.promotions
  for each statement execute function public.first_order_offer_on_promotion_change();

-- ---------------------------------------------------------------------
-- 6. Enforcement: apply the offer to an order, in the order's transaction.
--    Contract for the future trusted order-creation function:
--      1. insert the order (status, subtotal, delivery_fee, total computed
--         on the server) and its items;
--      2. call public.apply_first_order_offer(order_id) in the SAME
--         transaction; it returns the discount (0 when not eligible);
--      3. commit. A rollback anywhere also removes the redemption.
--    Concurrency: a per-account transaction advisory lock serialises
--    concurrent checkouts of one account; the partial unique index is the
--    last line of defence (a lost race, e.g. under REPEATABLE READ, applies
--    no discount instead of a second one). Calling it twice for the same
--    order is idempotent.
-- ---------------------------------------------------------------------
create function public.apply_first_order_offer(p_order_id uuid)
returns numeric
language plpgsql security definer set search_path = ''
as $$
declare
  ord record;
  promo public.promotions%rowtype;
  fee numeric;
  existing numeric;
begin
  select o.id, o.user_id, o.status, o.subtotal, o.delivery_fee, o.delivery_discount, o.total
    into ord from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'apply_first_order_offer: order % not found', p_order_id using errcode = 'P0002';
  end if;
  if ord.user_id is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('v1.first_order_offer:' || ord.user_id::text, 0));

  select r.discount_amount into existing from public.promotion_redemptions r
   where r.order_id = p_order_id and r.status = 'applied';
  if found then
    return existing;  -- already applied to this order (idempotent)
  end if;

  if public.first_order_offer_status_for(ord.user_id, p_order_id) <> 'eligible' then
    return 0;
  end if;
  select * into promo from public.promotions where code = 'FIRST_ORDER_FREE_DELIVERY';
  if promo.min_order_subtotal is not null and coalesce(ord.subtotal, 0) < promo.min_order_subtotal then
    return 0;
  end if;

  fee := coalesce(ord.delivery_fee, 0);
  begin
    insert into public.promotion_redemptions (promotion_id, user_id, order_id, status, discount_amount)
    values (promo.id, ord.user_id, p_order_id, 'applied', fee);
  exception when unique_violation then
    return 0;  -- another transaction applied the offer for this account first
  end;

  update public.orders
     set delivery_fee_before_discount = fee,
         delivery_discount = fee,
         delivery_fee = 0,
         total = total - fee,
         updated_at = now()
   where id = p_order_id;
  return fee;
end;
$$;
revoke all on function public.apply_first_order_offer(uuid) from public, anon, authenticated;
grant execute on function public.apply_first_order_offer(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 7. Backfill.
--    * Accounts the app already treated as onboarded (weight, height and
--      age set) are marked complete, so they are not sent back through
--      onboarding. Values are not changed; out-of-range legacy values get
--      no estimate (NULL) instead of an error.
--    * Derived nutrition values and the offer mirror for every profile.
-- ---------------------------------------------------------------------
update public.user_profiles
   set onboarding_completed_at = coalesce(updated_at::timestamptz, created_at::timestamptz, now())
 where onboarding_completed_at is null
   and weight is not null and weight <> 0
   and height is not null and height <> 0
   and age is not null and age <> 0;
update public.user_profiles p
   set first_order_offer_status = public.first_order_offer_status_for(p.user_id)
 where p.user_id is not null;

-- ---------------------------------------------------------------------
-- 8. Postcondition: Phase 1C containment unchanged (zero drift and
--    containment rows), and the new tables hold no client privilege.
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 onboarding/offer postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  if has_table_privilege('authenticated', 'public.promotions', 'SELECT')
     or has_table_privilege('authenticated', 'public.promotion_redemptions', 'SELECT')
     or has_table_privilege('anon', 'public.promotions', 'SELECT')
     or has_table_privilege('anon', 'public.promotion_redemptions', 'SELECT')
     or exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename in ('promotions', 'promotion_redemptions')) then
    raise exception 'V1 onboarding/offer postcondition failed: promotion tables are client-accessible';
  end if;
  if has_function_privilege('authenticated', 'public.apply_first_order_offer(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.apply_first_order_offer(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.first_order_offer_status_for(uuid,uuid)', 'EXECUTE') then
    raise exception 'V1 onboarding/offer postcondition failed: offer functions are client-executable';
  end if;
  if has_column_privilege('authenticated', 'public.user_profiles', 'bmr_kcal', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_profiles', 'tdee_kcal', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_profiles', 'first_order_offer_status', 'UPDATE') then
    -- (orders: authenticated keeps its legacy table grant, but Phase 1C leaves
    -- no client INSERT/UPDATE policy, so RLS refuses every client write; the
    -- reviewed-policy check above would report a new one.)
    raise exception 'V1 onboarding/offer postcondition failed: a server-managed column is client-writable';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 onboarding/offer: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_offer_gate_ok values ('postcondition');
end
$post$;

commit;
