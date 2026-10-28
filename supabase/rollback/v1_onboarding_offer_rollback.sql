-- =====================================================================
-- ROLLBACK of 20261028120000_v1_onboarding_first_order_offer.sql
--
-- Not a migration (lives outside supabase/migrations/). Run only with an
-- approved rollback task, as role postgres, on the database the migration
-- was applied to, after a backup:
--   psql "<connection>" -X -v ON_ERROR_STOP=1 -f supabase/rollback/v1_onboarding_offer_rollback.sql
-- It must run BEFORE any Phase 1C rollback (the Phase 1C rollback refuses
-- while a later migration is recorded).
--
-- Data is ARCHIVED, not destroyed: the new profile columns, the promotion
-- configuration, every redemption and the order discount columns are
-- copied into the private schema v1_onboarding_rollback_archive (no access
-- for anon, authenticated or service_role) before the objects are dropped.
-- Order amounts are NOT changed: orders already committed with free
-- delivery keep delivery_fee = 0 and their total.
--
-- One transaction with a deferred commit gate: COMMIT fails unless the
-- precondition and the postcondition both completed.
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 onboarding/offer rollback: must run as role postgres (current_user=%); aborting before any change',
      current_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_offer_rb_gate_ok (step text primary key) on commit drop;
create temp table v1_offer_rb_gate (
  step text constraint v1_offer_rollback_guard_did_not_pass references v1_offer_rb_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_offer_rb_gate values ('precondition'), ('postcondition');

do $pre$
begin
  if to_regclass('public.promotion_redemptions') is null or to_regclass('public.promotions') is null
     or to_regprocedure('public.apply_first_order_offer(uuid)') is null then
    raise exception 'V1 onboarding/offer rollback: the migration is not applied; nothing to roll back';
  end if;
  if to_regnamespace('v1_onboarding_rollback_archive') is not null then
    raise exception 'V1 onboarding/offer rollback: schema v1_onboarding_rollback_archive already exists; move it away first';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 onboarding/offer rollback: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_offer_rb_gate_ok values ('precondition');
end
$pre$;

-- Archive
create schema v1_onboarding_rollback_archive;
revoke all on schema v1_onboarding_rollback_archive from public;
create table v1_onboarding_rollback_archive.user_profiles_v1 as
  select user_id, bmr_kcal, tdee_kcal, nutrition_formula, nutrition_calculated_at, onboarding_completed_at,
         delivery_address, delivery_latitude, delivery_longitude, delivery_address_updated_at,
         first_order_offer_status, now() as archived_at
    from public.user_profiles;
create table v1_onboarding_rollback_archive.promotions as select *, now() as archived_at from public.promotions;
create table v1_onboarding_rollback_archive.promotion_redemptions as
  select *, now() as archived_at from public.promotion_redemptions;
create table v1_onboarding_rollback_archive.orders_v1 as
  select id as order_id, delivery_fee_before_discount, delivery_discount, now() as archived_at
    from public.orders
   where delivery_fee_before_discount is not null or delivery_discount <> 0;
do $acl$
declare t text;
begin
  foreach t in array array['user_profiles_v1', 'promotions', 'promotion_redemptions', 'orders_v1'] loop
    execute format('revoke all on v1_onboarding_rollback_archive.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$acl$;

-- Drop (triggers first, then functions, tables, columns)
drop trigger trg_first_order_offer_promotion_change on public.promotions;
drop trigger trg_first_order_offer_redemption_change on public.promotion_redemptions;
drop trigger trg_first_order_offer_order_change on public.orders;
drop trigger trg_first_order_offer_profile_guard on public.user_profiles;
drop trigger trg_first_order_offer_profile_insert on public.user_profiles;
drop trigger trg_user_profiles_v1_derive on public.user_profiles;

drop function public.apply_first_order_offer(uuid);
drop function public.first_order_offer_on_promotion_change();
drop function public.first_order_offer_on_redemption_change();
drop function public.first_order_offer_on_order_change();
drop function public.first_order_offer_profile_guard();
drop function public.first_order_offer_profile_insert();
drop function public.first_order_offer_refresh(uuid);
drop function public.first_order_offer_status_for(uuid, uuid);
drop function public.user_profiles_v1_derive();

drop table public.promotion_redemptions;
drop table public.promotions;

alter table public.orders drop constraint orders_delivery_discount_check;
alter table public.orders
  drop column delivery_fee_before_discount,
  drop column delivery_discount;

-- Dropping the columns also removes their column-level UPDATE grants.
alter table public.user_profiles drop constraint user_profiles_first_order_offer_status_check;
alter table public.user_profiles
  drop column bmr_kcal,
  drop column tdee_kcal,
  drop column nutrition_formula,
  drop column nutrition_calculated_at,
  drop column onboarding_completed_at,
  drop column delivery_address,
  drop column delivery_latitude,
  drop column delivery_longitude,
  drop column delivery_address_updated_at,
  drop column first_order_offer_status;

drop function public.estimate_energy(text, integer, numeric, numeric, text);

-- Migration history (Supabase CLI), so later Phase 1C procedures see the right last version.
do $hist$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261028120000';
  end if;
end
$hist$;

do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 onboarding/offer rollback postcondition failed; aborting the rollback transaction: %', bad;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'user_profiles' and column_name in ('bmr_kcal', 'onboarding_completed_at', 'first_order_offer_status'))
                or (table_name = 'orders' and column_name in ('delivery_discount', 'delivery_fee_before_discount')))) then
    raise exception 'V1 onboarding/offer rollback postcondition failed: columns remain';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 onboarding/offer rollback: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_offer_rb_gate_ok values ('postcondition');
end
$post$;

commit;
