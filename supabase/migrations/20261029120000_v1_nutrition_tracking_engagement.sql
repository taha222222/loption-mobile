-- =====================================================================
-- L'OPTION V1 — calorie tracking, daily targets, streaks and engagement
-- notifications.
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on Phase 1C core (20261016170000, revision 7, NOT READY FOR
-- STAGING) and 20261028120000_v1_onboarding_first_order_offer.sql.
-- Rollback: supabase/rollback/v1_nutrition_tracking_rollback.sql (run it
-- BEFORE the onboarding/offer rollback and any Phase 1C rollback).
--
-- Role postgres only; one transaction with a deferred commit gate (same
-- pattern as Phase 1C). Refuses unless the Phase 1C monitor is exactly the
-- reviewed revision-7 function and reports zero violations.
--
-- What this adds
--  * nutrition_log_entries: meals a customer says they actually ate. The
--    client sends only meal, servings, local date, time zone and an
--    idempotency key; calories and macros are copied from public.meals by
--    a trigger (clients cannot submit calorie values). Entries are never
--    deleted by clients, only marked deleted (audit trail).
--  * nutrition_daily_targets: the target that applied to each day
--    (snapshot of BMR/TDEE/target and the profile inputs), written by
--    triggers only, so history stays explainable after profile changes.
--  * nutrition_daily_summary(), nutrition_streak(): read-only functions
--    (SECURITY INVOKER, RLS applies) used by the app.
--  * Daily target policy: target = TDEE ("tdee_baseline_v1"). No deficit or
--    surplus is applied: that needs an approved product decision.
--  * notification_preferences (owner-managed, opt-in, off by default),
--    notification_settings (server config: caps, cooldowns, milestones),
--    notification_deliveries + notification_delivery_tickets (server-only
--    outbox and provider outcomes), planning and dispatch functions that
--    only service_role may execute (Edge Function
--    supabase/functions/dispatch-notifications).
--  * register_push_token()/deactivate_push_token(): bind an Expo push token
--    to the signed-in account (moving it from a previous account on the
--    same device) and deactivate it at sign-out.
--
-- Phase 1C containment: the new client policies and the two client-callable
-- SECURITY DEFINER functions are added to containment_violations()'s
-- reviewed lists (section 9, generated from the Phase 1C function by
-- supabase/tools/generate_nutrition_monitor.py). Nothing else in the
-- monitor changes. The postcondition requires zero violations.
-- After this migration the monitor fingerprint is the one recorded in
-- supabase/tests/postdeploy_verify_nutrition_readonly.sql.
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 nutrition: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_nutrition_gate_ok (step text primary key) on commit drop;
create temp table v1_nutrition_gate (
  step text constraint v1_nutrition_guard_did_not_pass references v1_nutrition_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_nutrition_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
begin
  if to_regprocedure('public.containment_violations()') is null
     or to_regprocedure('public.estimate_energy(text,integer,numeric,numeric,text)') is null
     or to_regprocedure('public.apply_first_order_offer(uuid)') is null then
    raise exception 'V1 nutrition: Phase 1C core and the V1 onboarding/offer migration must be applied first; aborting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure)
     <> '86b0dca96f9664cccf571684bb03562c' then
    raise exception 'V1 nutrition: containment_violations() is not the reviewed Phase 1C revision-7 monitor; refusing to extend it';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 nutrition: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  select string_agg(t, ', ') into bad
    from unnest(array['public.nutrition_log_entries', 'public.nutrition_daily_targets', 'public.notification_preferences',
                      'public.notification_settings', 'public.notification_deliveries',
                      'public.notification_delivery_tickets']) t
   where to_regclass(t) is not null;
  if bad is not null then
    raise exception 'V1 nutrition: objects already exist (re-run or unknown objects), refusing: %', bad;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'time_zone') then
    raise exception 'V1 nutrition: user_profiles.time_zone already exists, refusing';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 nutrition: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_nutrition_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------
-- True when p_tz is an IANA time zone name PostgreSQL knows.
create function public.is_valid_time_zone(p_tz text)
returns boolean
language sql stable set search_path = ''
as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz)
$$;
revoke all on function public.is_valid_time_zone(text) from public, anon;
grant execute on function public.is_valid_time_zone(text) to authenticated, service_role;

-- Daily target policy v1: the target is the TDEE estimate; NULL when no
-- estimate exists (missing inputs or sex input 'unspecified').
create function public.nutrition_target_from_tdee(p_tdee integer)
returns integer
language sql immutable set search_path = ''
as $$ select p_tdee $$;
revoke all on function public.nutrition_target_from_tdee(integer) from public, anon;
grant execute on function public.nutrition_target_from_tdee(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Profile time zone (used for "today", targets and reminders)
-- ---------------------------------------------------------------------
alter table public.user_profiles add column time_zone text;
grant update (time_zone) on public.user_profiles to authenticated;

create function public.user_profiles_time_zone_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.time_zone is not null
     and (tg_op = 'INSERT' or new.time_zone is distinct from old.time_zone)
     and not public.is_valid_time_zone(new.time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.user_profiles_time_zone_guard() from public, anon, authenticated;
create trigger trg_user_profiles_time_zone_guard
  before insert or update of time_zone on public.user_profiles
  for each row execute function public.user_profiles_time_zone_guard();

-- ---------------------------------------------------------------------
-- 3. Daily target snapshots (server-written only)
-- ---------------------------------------------------------------------
create table public.nutrition_daily_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  target_kcal integer check (target_kcal > 0),
  bmr_kcal integer check (bmr_kcal > 0),
  tdee_kcal integer check (tdee_kcal > 0),
  target_policy text not null default 'tdee_baseline_v1',
  formula text,
  inputs jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table public.nutrition_daily_targets enable row level security;
revoke all on public.nutrition_daily_targets from public, anon, authenticated;
grant select on public.nutrition_daily_targets to authenticated;
grant select, insert, update, delete on public.nutrition_daily_targets to service_role;
create policy nutrition_targets_owner_read on public.nutrition_daily_targets
  for select to authenticated using (user_id = (select auth.uid()));

-- Records the target that applies to p_date from the current profile.
-- p_overwrite: replace an existing snapshot (used for "today" when the
-- profile changes); past days are never overwritten by callers.
create function public.nutrition_capture_target(p_user_id uuid, p_date date, p_overwrite boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
begin
  select gender, age, weight, height, activity_level, bmr_kcal, tdee_kcal, nutrition_formula
    into p from public.user_profiles where user_id = p_user_id;
  if not found then
    return;
  end if;
  insert into public.nutrition_daily_targets as t
    (user_id, local_date, target_kcal, bmr_kcal, tdee_kcal, target_policy, formula, inputs, captured_at)
  values (p_user_id, p_date, public.nutrition_target_from_tdee(p.tdee_kcal), p.bmr_kcal, p.tdee_kcal,
          'tdee_baseline_v1', p.nutrition_formula,
          jsonb_build_object('sex', p.gender, 'age', p.age, 'weight_kg', p.weight, 'height_cm', p.height,
                             'activity', p.activity_level),
          now())
  on conflict (user_id, local_date) do update
     set target_kcal = excluded.target_kcal, bmr_kcal = excluded.bmr_kcal, tdee_kcal = excluded.tdee_kcal,
         target_policy = excluded.target_policy, formula = excluded.formula, inputs = excluded.inputs,
         captured_at = excluded.captured_at
   where p_overwrite;
end;
$$;
revoke all on function public.nutrition_capture_target(uuid, date, boolean) from public, anon, authenticated;

-- Profile changes update TODAY's snapshot (in the profile's time zone) if
-- one exists; earlier days keep the target that applied to them.
create function public.nutrition_profile_target_refresh()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  today date;
begin
  if new.user_id is null or new.time_zone is null or not public.is_valid_time_zone(new.time_zone) then
    return null;
  end if;
  if new.bmr_kcal is distinct from old.bmr_kcal or new.tdee_kcal is distinct from old.tdee_kcal then
    today := (now() at time zone new.time_zone)::date;
    if exists (select 1 from public.nutrition_daily_targets where user_id = new.user_id and local_date = today) then
      perform public.nutrition_capture_target(new.user_id, today, true);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.nutrition_profile_target_refresh() from public, anon, authenticated;
create trigger trg_nutrition_profile_target_refresh
  after update on public.user_profiles
  for each row execute function public.nutrition_profile_target_refresh();

-- ---------------------------------------------------------------------
-- 4. Consumption log
-- ---------------------------------------------------------------------
create table public.nutrition_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  local_date date not null,
  time_zone text not null,
  meal_id uuid references public.meals(id) on delete set null,
  order_item_id uuid references public.order_items(id) on delete set null,
  servings numeric(4,2) not null check (servings > 0 and servings <= 10 and servings * 4 = trunc(servings * 4)),
  meal_name text not null,
  kcal_per_serving integer not null check (kcal_per_serving > 0),
  kcal integer not null check (kcal > 0),
  protein_g numeric(6,1),
  carbs_g numeric(6,1),
  fat_g numeric(6,1),
  logged_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, client_request_id)
);
create index nutrition_log_entries_user_day on public.nutrition_log_entries (user_id, local_date) where deleted_at is null;
create index nutrition_log_entries_order_item on public.nutrition_log_entries (order_item_id) where order_item_id is not null;
alter table public.nutrition_log_entries enable row level security;
revoke all on public.nutrition_log_entries from public, anon, authenticated;
grant select on public.nutrition_log_entries to authenticated;
-- Clients provide only these columns; everything else is set by the trigger.
grant insert (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
  on public.nutrition_log_entries to authenticated;
grant update (deleted_at) on public.nutrition_log_entries to authenticated;
grant select, insert, update, delete on public.nutrition_log_entries to service_role;
create policy nutrition_entries_owner_read on public.nutrition_log_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy nutrition_entries_owner_insert on public.nutrition_log_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy nutrition_entries_owner_delete_mark on public.nutrition_log_entries
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- SECURITY INVOKER: meals and the customer's own order items are read
-- with the caller's rights (RLS), so an order item of another customer is
-- invisible and refused.
create function public.nutrition_log_entry_prepare()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  m record;
  oi record;
  today date;
  already numeric;
begin
  if current_user in ('anon', 'authenticated') then
    if auth.uid() is null then
      raise exception 'not signed in' using errcode = '42501';
    end if;
    new.user_id := auth.uid();
  end if;
  if not public.is_valid_time_zone(new.time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  today := (now() at time zone new.time_zone)::date;
  if new.local_date > today or new.local_date < today - 6 then
    raise exception 'meals can be logged for today and the previous 6 days only' using errcode = '22023';
  end if;
  if new.meal_id is null then
    raise exception 'a meal is required' using errcode = '22023';
  end if;
  select name, calories, protein, carbs, fat into m from public.meals where id = new.meal_id;
  if not found then
    raise exception 'unknown meal' using errcode = '22023';
  end if;
  if m.calories is null or m.calories <= 0 then
    raise exception 'this meal has no reliable calorie value' using errcode = '22023';
  end if;
  if new.order_item_id is not null then
    select i.meal_id, i.quantity into oi
      from public.order_items i join public.orders o on o.id = i.order_id
     where i.id = new.order_item_id and o.user_id = new.user_id;
    if not found then
      raise exception 'order item not found for this account' using errcode = '42501';
    end if;
    if oi.meal_id is distinct from new.meal_id then
      raise exception 'order item and meal do not match' using errcode = '22023';
    end if;
    -- Serialise concurrent logs of the same order item.
    perform pg_advisory_xact_lock(hashtextextended('nutrition.order_item:' || new.order_item_id::text, 0));
    select coalesce(sum(servings), 0) into already from public.nutrition_log_entries
     where order_item_id = new.order_item_id and deleted_at is null;
    if already + new.servings > oi.quantity then
      raise exception 'more servings logged than were ordered' using errcode = '22023';
    end if;
  end if;
  new.meal_name := m.name;
  new.kcal_per_serving := m.calories;
  new.kcal := round(m.calories * new.servings)::integer;
  new.protein_g := case when m.protein is null then null else round(m.protein * new.servings, 1) end;
  new.carbs_g := case when m.carbs is null then null else round(m.carbs * new.servings, 1) end;
  new.fat_g := case when m.fat is null then null else round(m.fat * new.servings, 1) end;
  new.logged_at := now();
  new.deleted_at := null;
  return new;
end;
$$;
revoke all on function public.nutrition_log_entry_prepare() from public, anon, authenticated;
create trigger trg_nutrition_log_entry_prepare
  before insert on public.nutrition_log_entries
  for each row execute function public.nutrition_log_entry_prepare();

-- Clients may only mark an entry deleted, once; the server stamps the time.
create function public.nutrition_log_entry_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if old.deleted_at is not null then
      raise exception 'entry already removed' using errcode = '22023';
    end if;
    if new.deleted_at is null then
      raise exception 'entries can only be removed' using errcode = '22023';
    end if;
    new.deleted_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.nutrition_log_entry_guard() from public, anon, authenticated;
create trigger trg_nutrition_log_entry_guard
  before update on public.nutrition_log_entries
  for each row execute function public.nutrition_log_entry_guard();

-- The first entry of a day fixes that day's target snapshot.
create function public.nutrition_log_entry_capture_target()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.nutrition_capture_target(new.user_id, new.local_date, false);
  return null;
end;
$$;
revoke all on function public.nutrition_log_entry_capture_target() from public, anon, authenticated;
create trigger trg_nutrition_log_entry_capture_target
  after insert on public.nutrition_log_entries
  for each row execute function public.nutrition_log_entry_capture_target();

-- ---------------------------------------------------------------------
-- 5. Read functions (SECURITY INVOKER: RLS limits them to the caller)
-- ---------------------------------------------------------------------
-- One row per day in [p_from, p_to] (at most 92 days).
--   has_log = false and consumed_kcal = NULL: nothing logged that day
--   (never reported as 0). target_kcal: the snapshot for that day, or for
--   p_today only, the current profile target (target_source 'current').
create function public.nutrition_daily_summary(p_from date, p_to date, p_today date default null)
returns table (local_date date, entry_count integer, consumed_kcal integer, protein_g numeric, carbs_g numeric,
               fat_g numeric, has_log boolean, target_kcal integer, target_source text)
language sql stable set search_path = ''
as $$
  with days as (
    select d::date as local_date
      from generate_series(p_from, p_to, interval '1 day') d
     where p_from <= p_to and p_to - p_from <= 91
  ),
  e as (
    select n.local_date, count(*)::integer as entry_count, sum(n.kcal)::integer as kcal,
           sum(n.protein_g) as protein_g, sum(n.carbs_g) as carbs_g, sum(n.fat_g) as fat_g
      from public.nutrition_log_entries n
     where n.user_id = auth.uid() and n.deleted_at is null and n.local_date between p_from and p_to
     group by n.local_date
  ),
  current_target as (
    select public.nutrition_target_from_tdee(p.tdee_kcal) as target_kcal
      from public.user_profiles p where p.user_id = auth.uid()
  )
  select days.local_date,
         coalesce(e.entry_count, 0),
         e.kcal,
         e.protein_g, e.carbs_g, e.fat_g,
         e.entry_count is not null,
         coalesce(t.target_kcal, case when days.local_date = p_today then (select target_kcal from current_target) end),
         case when t.user_id is not null then 'snapshot'
              when days.local_date = p_today and (select target_kcal from current_target) is not null then 'current'
              else null end
    from days
    left join e on e.local_date = days.local_date
    left join public.nutrition_daily_targets t on t.user_id = auth.uid() and t.local_date = days.local_date
   order by days.local_date
$$;
revoke all on function public.nutrition_daily_summary(date, date, date) from public, anon;
grant execute on function public.nutrition_daily_summary(date, date, date) to authenticated;

-- Milestones: 7, 14, 30, then every 30 days.
create function public.nutrition_next_milestone(p_streak integer)
returns integer
language sql immutable set search_path = ''
as $$
  select case when p_streak < 7 then 7 when p_streak < 14 then 14 when p_streak < 30 then 30
              else (p_streak / 30 + 1) * 30 end
$$;
revoke all on function public.nutrition_next_milestone(integer) from public, anon;
grant execute on function public.nutrition_next_milestone(integer) to authenticated, service_role;

create function public.nutrition_is_milestone(p_streak integer)
returns boolean
language sql immutable set search_path = ''
as $$ select p_streak in (7, 14) or (p_streak >= 30 and p_streak % 30 = 0) $$;
revoke all on function public.nutrition_is_milestone(integer) from public, anon;
grant execute on function public.nutrition_is_milestone(integer) to authenticated, service_role;

-- Streak over distinct local dates with at least one non-deleted entry.
-- The current streak ends today, or yesterday while today has no entry yet
-- (the day is not over). Used by the app (invoker, own rows) and by the
-- planner (definer wrapper below).
create function public.nutrition_streak_for(p_user_id uuid, p_today date)
returns table (current_streak integer, longest_streak integer, last_logged_date date, today_logged boolean,
               streak_start date, next_milestone integer)
language sql stable set search_path = ''
as $$
  with d as (
    select distinct n.local_date from public.nutrition_log_entries n
     where n.user_id = p_user_id and n.deleted_at is null and n.local_date <= p_today
  ),
  g as (
    select local_date, local_date - (row_number() over (order by local_date))::integer as grp from d
  ),
  runs as (
    select min(local_date) as start_date, max(local_date) as end_date, count(*)::integer as len from g group by grp
  ),
  cur as (
    select len, start_date from runs where end_date >= p_today - 1 order by end_date desc limit 1
  )
  select coalesce((select len from cur), 0),
         coalesce((select max(len) from runs), 0),
         (select max(local_date) from d),
         exists (select 1 from d where local_date = p_today),
         (select start_date from cur),
         public.nutrition_next_milestone(coalesce((select len from cur), 0))
$$;
revoke all on function public.nutrition_streak_for(uuid, date) from public, anon;
-- SECURITY INVOKER: for a client, RLS limits it to the caller's own entries
-- (another user's id yields an empty history).
grant execute on function public.nutrition_streak_for(uuid, date) to authenticated, service_role;

create function public.nutrition_streak(p_today date)
returns table (current_streak integer, longest_streak integer, last_logged_date date, today_logged boolean,
               streak_start date, next_milestone integer)
language sql stable set search_path = ''
as $$ select * from public.nutrition_streak_for(auth.uid(), p_today) $$;
revoke all on function public.nutrition_streak(date) from public, anon;
grant execute on function public.nutrition_streak(date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Push tokens (bind to the signed-in account; deactivate at sign-out)
-- ---------------------------------------------------------------------
create function public.register_push_token(p_token text, p_device_type text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$' then
    raise exception 'invalid push token' using errcode = '22023';
  end if;
  if p_device_type is not null and p_device_type not in ('ios', 'android', 'web') then
    raise exception 'invalid device type' using errcode = '22023';
  end if;
  -- A device token belongs to whoever is signed in on that device now.
  insert into public.user_push_tokens (user_id, push_token, device_type, is_active, created_at, updated_at)
  values (auth.uid(), p_token, p_device_type, true, now(), now())
  on conflict (push_token) do update
     set user_id = excluded.user_id, device_type = excluded.device_type, is_active = true, updated_at = now();
end;
$$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

create function public.deactivate_push_token(p_token text)
returns void
language sql security definer set search_path = ''
as $$
  update public.user_push_tokens set is_active = false, updated_at = now()
   where push_token = p_token and user_id = auth.uid()
$$;
revoke all on function public.deactivate_push_token(text) from public, anon;
grant execute on function public.deactivate_push_token(text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Notification preferences (owner) and settings (server)
-- ---------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  reminders_enabled boolean not null default false,
  daily_target_enabled boolean not null default true,
  progress_enabled boolean not null default false,
  evening_enabled boolean not null default false,
  milestones_enabled boolean not null default true,
  reengagement_enabled boolean not null default false,
  daily_time time not null default '12:00',
  progress_time time not null default '16:00',
  evening_time time not null default '20:30',
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  time_zone text not null,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;
grant insert (reminders_enabled, daily_target_enabled, progress_enabled, evening_enabled, milestones_enabled,
              reengagement_enabled, daily_time, progress_time, evening_time, quiet_start, quiet_end, time_zone)
  on public.notification_preferences to authenticated;
grant update (reminders_enabled, daily_target_enabled, progress_enabled, evening_enabled, milestones_enabled,
              reengagement_enabled, daily_time, progress_time, evening_time, quiet_start, quiet_end, time_zone)
  on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.notification_preferences to service_role;
create policy notification_prefs_owner_read on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy notification_prefs_owner_insert on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy notification_prefs_owner_update on public.notification_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- True when p_time falls inside the quiet period [start, end) (may wrap midnight).
create function public.in_quiet_hours(p_time time, p_start time, p_end time)
returns boolean
language sql immutable set search_path = ''
as $$
  select case when p_start = p_end then false
              when p_start < p_end then p_time >= p_start and p_time < p_end
              else p_time >= p_start or p_time < p_end end
$$;
revoke all on function public.in_quiet_hours(time, time, time) from public, anon;
grant execute on function public.in_quiet_hours(time, time, time) to authenticated, service_role;

create function public.notification_preferences_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.user_id := auth.uid();
  end if;
  if not public.is_valid_time_zone(new.time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  if public.in_quiet_hours(new.daily_time, new.quiet_start, new.quiet_end)
     or public.in_quiet_hours(new.progress_time, new.quiet_start, new.quiet_end)
     or public.in_quiet_hours(new.evening_time, new.quiet_start, new.quiet_end) then
    raise exception 'reminder times must be outside quiet hours' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.notification_preferences_guard() from public, anon, authenticated;
create trigger trg_notification_preferences_guard
  before insert or update on public.notification_preferences
  for each row execute function public.notification_preferences_guard();

-- Server configuration (one row). Not readable or writable by clients.
create table public.notification_settings (
  id boolean primary key default true check (id),
  sending_enabled boolean not null default true,
  max_per_user_per_day integer not null default 2 check (max_per_user_per_day between 0 and 5),
  send_window_minutes integer not null default 120 check (send_window_minutes between 15 and 360),
  reengagement_inactive_days integer not null default 3 check (reengagement_inactive_days >= 2),
  reengagement_cooldown_days integer not null default 7 check (reengagement_cooldown_days >= 3),
  reengagement_max_per_30_days integer not null default 2 check (reengagement_max_per_30_days between 0 and 4),
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from public, anon, authenticated;
grant select, update on public.notification_settings to service_role;
insert into public.notification_settings default values;

-- ---------------------------------------------------------------------
-- 8. Outbox and provider outcomes (server-only)
-- ---------------------------------------------------------------------
create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('daily_target', 'progress', 'evening', 'milestone', 'reengagement')),
  local_date date not null,
  dedupe_key text not null unique,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'no_device')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_deliveries_user_day on public.notification_deliveries (user_id, local_date);
create index notification_deliveries_pending on public.notification_deliveries (status) where status in ('queued', 'sending');
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public, anon, authenticated;
grant select on public.notification_deliveries to service_role;

create table public.notification_delivery_tickets (
  id bigint generated always as identity primary key,
  delivery_id bigint not null references public.notification_deliveries(id) on delete cascade,
  push_token text not null,
  ticket_id text,
  ticket_status text not null check (ticket_status in ('ok', 'error')),
  ticket_error text,
  receipt_status text check (receipt_status in ('ok', 'error')),
  receipt_error text,
  created_at timestamptz not null default now(),
  receipt_checked_at timestamptz
);
create index notification_delivery_tickets_receipts on public.notification_delivery_tickets (created_at)
  where ticket_status = 'ok' and receipt_checked_at is null;
alter table public.notification_delivery_tickets enable row level security;
revoke all on public.notification_delivery_tickets from public, anon, authenticated;
grant select on public.notification_delivery_tickets to service_role;

create function public.nutrition_notification_text(p_kind text, p_params jsonb)
returns table (title text, body text)
language sql immutable set search_path = ''
as $$
  select case p_kind
           when 'daily_target' then 'Votre objectif du jour est prêt 🎯'
           when 'progress' then 'Votre suivi du jour'
           when 'evening' then 'Votre journal du jour'
           when 'milestone' then '🔥 ' || (p_params ->> 'streak') || ' jours de suivi d’affilée !'
           when 'reengagement' then 'Votre suivi vous attend'
         end,
         case p_kind
           when 'daily_target' then 'Ouvrez L’OPTION pour consulter votre objectif calorique d’aujourd’hui.'
           when 'progress' then 'Vous avez enregistré ' || (p_params ->> 'consumed_kcal')
                                || ' kcal aujourd’hui. Consultez les calories restantes dans L’OPTION.'
           when 'evening' then 'Avant la fin de la journée, pensez à enregistrer les repas que vous avez réellement consommés. Vos progrès se construisent jour après jour.'
           when 'milestone' then 'Bravo pour votre régularité. Jetez un œil à vos progrès de la semaine.'
           when 'reengagement' then 'Votre journal nutritionnel est prêt quand vous l’êtes. Revenez sur L’OPTION pour continuer.'
         end
$$;
revoke all on function public.nutrition_notification_text(text, jsonb) from public, anon, authenticated;
grant execute on function public.nutrition_notification_text(text, jsonb) to service_role;

-- Plans the notifications due at p_now. Idempotent: every notification has
-- a dedupe key (one per user, kind and local day; one per streak milestone),
-- so repeated or concurrent runs queue nothing twice. Rules (configurable
-- in notification_settings and per user in notification_preferences):
--   * only users who opted in (reminders_enabled) and have an active token;
--   * never inside the user's quiet hours; each reminder only within
--     send_window_minutes after its local time (a late run sends nothing);
--   * at most max_per_user_per_day notifications per local day;
--   * daily_target: needs a target; suppressed while the user is inactive
--     (re-engagement rules apply instead);
--   * progress: needs a target and at least one logged meal today;
--   * evening: only when nothing is logged today;
--   * milestone: when today's entry completes a 7/14/30/… day streak;
--   * reengagement: user has logged before, nothing for
--     reengagement_inactive_days, none sent in the cooldown, and at most
--     reengagement_max_per_30_days in 30 days.
create function public.nutrition_plan_notifications(p_now timestamptz default now())
returns setof public.notification_deliveries
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.notification_settings%rowtype;
  u record;
  lnow timestamp;
  ldate date;
  ltime time;
  sent_today integer;
  target integer;
  entries integer;
  consumed integer;
  s record;
  last_log date;
  inactive boolean;
  wnd interval;
  candidates jsonb;
  c jsonb;
  txt record;
  queued public.notification_deliveries%rowtype;
begin
  select * into cfg from public.notification_settings where id;
  if not found or not cfg.sending_enabled then
    return;
  end if;
  wnd := make_interval(mins => cfg.send_window_minutes);
  for u in
    select np.*, p.tdee_kcal
      from public.notification_preferences np
      left join public.user_profiles p on p.user_id = np.user_id
     where np.reminders_enabled
       and public.is_valid_time_zone(np.time_zone)
       and exists (select 1 from public.user_push_tokens t where t.user_id = np.user_id and t.is_active)
  loop
    lnow := p_now at time zone u.time_zone;
    ldate := lnow::date;
    ltime := lnow::time;
    continue when public.in_quiet_hours(ltime, u.quiet_start, u.quiet_end);
    select count(*) into sent_today from public.notification_deliveries
     where user_id = u.user_id and local_date = ldate and status in ('queued', 'sending', 'sent');
    continue when sent_today >= cfg.max_per_user_per_day;

    select coalesce(t.target_kcal, public.nutrition_target_from_tdee(u.tdee_kcal)) into target
      from (select 1) x left join public.nutrition_daily_targets t on t.user_id = u.user_id and t.local_date = ldate;
    select count(*), coalesce(sum(kcal), 0) into entries, consumed from public.nutrition_log_entries
     where user_id = u.user_id and local_date = ldate and deleted_at is null;
    select max(local_date) into last_log from public.nutrition_log_entries
     where user_id = u.user_id and deleted_at is null and local_date <= ldate;
    inactive := last_log is not null and ldate - last_log >= cfg.reengagement_inactive_days;
    select * into s from public.nutrition_streak_for(u.user_id, ldate);

    candidates := '[]'::jsonb;
    if u.milestones_enabled and s.today_logged and public.nutrition_is_milestone(s.current_streak) then
      candidates := candidates || jsonb_build_object('kind', 'milestone',
        'key', 'milestone:' || u.user_id || ':' || s.streak_start || ':' || s.current_streak,
        'params', jsonb_build_object('streak', s.current_streak));
    end if;
    if u.daily_target_enabled and target is not null and not inactive
       and ltime >= u.daily_time and lnow < ldate + u.daily_time + wnd then
      candidates := candidates || jsonb_build_object('kind', 'daily_target',
        'key', 'daily_target:' || u.user_id || ':' || ldate, 'params', '{}'::jsonb);
    end if;
    if u.progress_enabled and target is not null and entries > 0 and consumed > 0
       and ltime >= u.progress_time and lnow < ldate + u.progress_time + wnd then
      candidates := candidates || jsonb_build_object('kind', 'progress',
        'key', 'progress:' || u.user_id || ':' || ldate, 'params', jsonb_build_object('consumed_kcal', consumed));
    end if;
    if u.evening_enabled and entries = 0 and not inactive
       and ltime >= u.evening_time and lnow < ldate + u.evening_time + wnd then
      candidates := candidates || jsonb_build_object('kind', 'evening',
        'key', 'evening:' || u.user_id || ':' || ldate, 'params', '{}'::jsonb);
    end if;
    if u.reengagement_enabled and inactive
       and ltime >= u.daily_time and lnow < ldate + u.daily_time + wnd
       and not exists (select 1 from public.notification_deliveries d
                        where d.user_id = u.user_id and d.kind = 'reengagement'
                          and d.local_date > ldate - cfg.reengagement_cooldown_days)
       and (select count(*) from public.notification_deliveries d
             where d.user_id = u.user_id and d.kind = 'reengagement' and d.local_date > ldate - 30)
           < cfg.reengagement_max_per_30_days then
      candidates := candidates || jsonb_build_object('kind', 'reengagement',
        'key', 'reengagement:' || u.user_id || ':' || ldate, 'params', '{}'::jsonb);
    end if;

    for c in select * from jsonb_array_elements(candidates) loop
      exit when sent_today >= cfg.max_per_user_per_day;
      select * into txt from public.nutrition_notification_text(c ->> 'kind', c -> 'params');
      insert into public.notification_deliveries (user_id, kind, local_date, dedupe_key, title, body, data)
      values (u.user_id, c ->> 'kind', ldate, c ->> 'key', txt.title, txt.body,
              jsonb_build_object('url', 'loption://nutrition', 'screen', 'nutrition', 'kind', c ->> 'kind'))
      on conflict (dedupe_key) do nothing
      returning * into queued;
      if queued.id is not null then
        sent_today := sent_today + 1;
        return next queued;
        queued := null;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.nutrition_plan_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.nutrition_plan_notifications(timestamptz) to service_role;

-- Claims queued deliveries for sending (concurrent dispatchers never claim
-- the same row; a crashed claim is retried after 10 minutes, at most 3
-- attempts). Returns each delivery with the user's active tokens.
create function public.nutrition_claim_deliveries(p_limit integer default 100)
returns table (delivery_id bigint, title text, body text, data jsonb, tokens text[])
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with picked as (
    select d.id from public.notification_deliveries d
     where (d.status = 'queued' or (d.status = 'sending' and d.claimed_at < now() - interval '10 minutes'))
       and d.attempts < 3
     order by d.id
     limit least(greatest(p_limit, 1), 500)
     for update skip locked
  ),
  claimed as (
    update public.notification_deliveries d
       set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
      from picked where d.id = picked.id
    returning d.id, d.user_id, d.title, d.body, d.data
  )
  select c.id, c.title, c.body, c.data,
         coalesce((select array_agg(t.push_token order by t.updated_at desc)
                     from public.user_push_tokens t where t.user_id = c.user_id and t.is_active), '{}')
    from claimed c;
end;
$$;
revoke all on function public.nutrition_claim_deliveries(integer) from public, anon, authenticated;
grant execute on function public.nutrition_claim_deliveries(integer) to service_role;

-- Records the provider outcome of one delivery. p_tickets: array of
-- {token, status ('ok'|'error'), id, error}. Tokens reported as
-- DeviceNotRegistered are deactivated.
create function public.nutrition_record_delivery(p_delivery_id bigint, p_tickets jsonb, p_error text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t jsonb;
  ok integer := 0;
  n integer := 0;
begin
  for t in select * from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) loop
    n := n + 1;
    insert into public.notification_delivery_tickets (delivery_id, push_token, ticket_id, ticket_status, ticket_error)
    values (p_delivery_id, t ->> 'token', t ->> 'id', t ->> 'status', t ->> 'error');
    if t ->> 'status' = 'ok' then
      ok := ok + 1;
    elsif t ->> 'error' = 'DeviceNotRegistered' then
      update public.user_push_tokens set is_active = false, updated_at = now() where push_token = t ->> 'token';
    end if;
  end loop;
  update public.notification_deliveries
     set status = case when n = 0 and p_error is null then 'no_device'
                       when ok > 0 then 'sent'
                       when attempts >= 3 or p_error is null then 'failed'
                       else 'queued' end,
         sent_at = case when ok > 0 then now() else sent_at end,
         error = coalesce(p_error, case when ok = 0 and n > 0 then 'all tickets failed' end)
   where id = p_delivery_id and status = 'sending';
end;
$$;
revoke all on function public.nutrition_record_delivery(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.nutrition_record_delivery(bigint, jsonb, text) to service_role;

create function public.nutrition_pending_receipts(p_limit integer default 300)
returns table (ticket_row_id bigint, ticket_id text, push_token text)
language sql stable security definer set search_path = ''
as $$
  select id, ticket_id, push_token from public.notification_delivery_tickets
   where ticket_status = 'ok' and receipt_checked_at is null and ticket_id is not null
     and created_at < now() - interval '15 minutes'
   order by id limit least(greatest(p_limit, 1), 1000)
$$;
revoke all on function public.nutrition_pending_receipts(integer) from public, anon, authenticated;
grant execute on function public.nutrition_pending_receipts(integer) to service_role;

-- p_receipts: array of {ticket_id, status, error}.
create function public.nutrition_record_receipts(p_receipts jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  tok text;
begin
  for r in select * from jsonb_array_elements(coalesce(p_receipts, '[]'::jsonb)) loop
    update public.notification_delivery_tickets
       set receipt_status = r ->> 'status', receipt_error = r ->> 'error', receipt_checked_at = now()
     where ticket_id = r ->> 'ticket_id'
    returning push_token into tok;
    if r ->> 'error' = 'DeviceNotRegistered' and tok is not null then
      update public.user_push_tokens set is_active = false, updated_at = now() where push_token = tok;
    end if;
  end loop;
end;
$$;
revoke all on function public.nutrition_record_receipts(jsonb) from public, anon, authenticated;
grant execute on function public.nutrition_record_receipts(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 9. Phase 1C monitor: reviewed lists extended with this migration's
--    client policies and client-callable SECURITY DEFINER functions.
--    GENERATED by supabase/tools/generate_nutrition_monitor.py from the
--    Phase 1C migration; do not edit by hand.
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
    'nutrition_log_entries|nutrition_entries_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-'];
  reviewed_storage_policies text[] := array[
    'objects|staff_admin_delete_meal_images|PERMISSIVE|{authenticated}|DELETE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_insert_meal_images|PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))',
    'objects|staff_admin_select_meal_images|PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_update_meal_images|PERMISSIVE|{authenticated}|UPDATE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))'];
  -- SECURITY DEFINER functions a client role may execute (authenticated only).
  client_definer_functions text[] := array[
    'public.has_staff_role(text)','public.assign_staff_role(uuid,text,uuid)',
    'public.revoke_staff_role(uuid,text,uuid)','public.set_driver_availability(boolean)',
    'public.register_push_token(text,text)','public.deactivate_push_token(text)'];
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
-- 10. Postcondition
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 nutrition postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  if exists (select 1 from unnest(array['public.notification_settings', 'public.notification_deliveries',
                                        'public.notification_delivery_tickets']) t
              where has_table_privilege('authenticated', t::regclass, 'SELECT')
                 or has_table_privilege('anon', t::regclass, 'SELECT')) then
    raise exception 'V1 nutrition postcondition failed: server-only notification tables are client-readable';
  end if;
  if exists (select 1 from unnest(array['public.nutrition_plan_notifications(timestamp with time zone)',
                                        'public.nutrition_claim_deliveries(integer)',
                                        'public.nutrition_record_delivery(bigint,jsonb,text)',
                                        'public.nutrition_record_receipts(jsonb)',
                                        'public.nutrition_capture_target(uuid,date,boolean)']) f
              where has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
                 or has_function_privilege('anon', f::regprocedure, 'EXECUTE')) then
    raise exception 'V1 nutrition postcondition failed: a server-only function is client-executable';
  end if;
  if has_column_privilege('authenticated', 'public.nutrition_log_entries', 'kcal', 'INSERT')
     or has_column_privilege('authenticated', 'public.nutrition_log_entries', 'kcal', 'UPDATE')
     or has_column_privilege('authenticated', 'public.nutrition_log_entries', 'user_id', 'UPDATE')
     or has_table_privilege('authenticated', 'public.nutrition_daily_targets', 'INSERT')
     or has_table_privilege('authenticated', 'public.nutrition_log_entries', 'DELETE') then
    raise exception 'V1 nutrition postcondition failed: a server-derived column or table is client-writable';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 nutrition: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_nutrition_gate_ok values ('postcondition');
end
$post$;

commit;
