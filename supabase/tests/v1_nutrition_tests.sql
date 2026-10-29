-- =====================================================================
-- V1 nutrition tracking / streak / notification tests. DISPOSABLE DATABASE
-- ONLY (run_v1_nutrition.sh). Runs after Phase 1C core, the V1 onboarding
-- migration and 20261029120000_v1_nutrition_tracking_engagement.sql.
-- Acts like PostgREST (SET ROLE + request.jwt.claims) and checks the
-- resulting state as postgres. Local PostgreSQL results only.
--
-- Fixture users (created by the runner, e-mail confirmed, profiles with
-- onboarding answers and time zone Africa/Casablanca):
--   ...0f01 man 30y 70kg 175cm moderate  (target 2556)
--   ...0f02 woman 25y 60kg 165cm sedentary (target 1614)
--   ...0f03 sex input 'unspecified' (no target)
--   ...0f04 notifications user;   ...0f05 notifications user (inactive)
--   ...0000c1 (Phase 1C fixture) owns order A-1 with one 'Test bowl'
-- Meals: ...aa01 'Test bowl' 500 kcal (fixture), ...aa02 'Sans info' 0 kcal
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists ntests;
create table if not exists ntests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate ntests.results;

create or replace function ntests.act(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;
create or replace function ntests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function ntests.attempt(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;
create or replace function ntests.scalar(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return 'err:' || sqlstate;
end $$;
create or replace function ntests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into ntests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
-- Local "today" for the fixtures' time zone.
create or replace function ntests.d(p_offset int default 0) returns date language sql stable as $$
  select (now() at time zone 'Africa/Casablanca')::date + p_offset
$$;
-- A log insert as the given user (client columns only).
create or replace function ntests.log_sql(p_day int, p_servings numeric, p_req text, p_meal text default '00000000-0000-0000-0000-00000000aa01',
                                          p_tz text default 'Africa/Casablanca', p_order_item text default null)
returns text language sql stable as $$
  select format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                   values (%L, %L, %L, %L, %s, %s)$f$,
                p_req, ntests.d(p_day), p_tz, p_meal, coalesce(quote_literal(p_order_item), 'null'), p_servings)
$$;
-- Casablanca local wall-clock time today (offset in days) as timestamptz.
create or replace function ntests.at_local(p_day int, p_time time) returns timestamptz language sql stable as $$
  select ((ntests.d(p_day) + p_time)::timestamp at time zone 'Africa/Casablanca')
$$;
grant usage on schema ntests to anon, authenticated, service_role;
grant execute on all functions in schema ntests to anon, authenticated, service_role;

-- ============================ Tracking ============================
do $$ declare r text; e record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := ntests.attempt(ntests.log_sql(0, 1.5, '11111111-0000-0000-0000-000000000001'));
  perform ntests.reset();
  select * into e from public.nutrition_log_entries where client_request_id = '11111111-0000-0000-0000-000000000001';
  perform ntests.rec('T01', 'tracking', 'a logged serving takes calories and macros from the meal (server snapshot)',
    r = 'ok:1' and e.user_id = '00000000-0000-0000-0000-000000000f01' and e.kcal_per_serving = 500 and e.kcal = 750
      and e.protein_g = 45.0 and e.meal_name = 'Test bowl',
    r || format(' kcal=%s protein=%s', e.kcal, e.protein_g));
end $$;

do $$ declare r1 text; r2 text; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := ntests.attempt(format($q$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings, kcal)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1, 9999)$q$, ntests.d()));
  r2 := ntests.attempt(format($q$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings, user_id)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1, '00000000-0000-0000-0000-000000000f02')$q$, ntests.d()));
  perform ntests.reset();
  perform ntests.rec('T02', 'tracking', 'a client cannot submit calorie values or log for another user (column privileges)',
    r1 = 'err:42501' and r2 = 'err:42501', concat_ws(' ', r1, r2));
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text, '00000000-0000-0000-0000-00000000aa02'));
  r2 := ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text, '00000000-0000-0000-0000-00000000aa01', 'Mars/Olympus'));
  r3 := ntests.attempt(ntests.log_sql(1, 1, gen_random_uuid()::text));
  r4 := ntests.attempt(ntests.log_sql(-7, 1, gen_random_uuid()::text));
  r5 := ntests.attempt(ntests.log_sql(0, 0.3, gen_random_uuid()::text));
  r6 := ntests.attempt(ntests.log_sql(0, 11, gen_random_uuid()::text));
  perform ntests.reset();
  perform ntests.rec('T03', 'tracking', 'refused: meal without reliable calories, unknown time zone, future day, >6 days back, bad servings',
    r1 = 'err:22023' and r2 = 'err:22023' and r3 = 'err:22023' and r4 = 'err:22023' and r5 = 'err:23514' and r6 = 'err:23514',
    concat_ws(' ', r1, r2, r3, r4, r5, r6));
end $$;

do $$ declare r1 text; r2 text; n int; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := ntests.attempt(ntests.log_sql(0, 1.5, '11111111-0000-0000-0000-000000000001')
                       || ' on conflict (user_id, client_request_id) do nothing');
  r2 := ntests.attempt(ntests.log_sql(0, 1.5, '11111111-0000-0000-0000-000000000001'));
  perform ntests.reset();
  select count(*) into n from public.nutrition_log_entries where client_request_id = '11111111-0000-0000-0000-000000000001';
  perform ntests.rec('T04', 'tracking', 'a retried request (same idempotency key) never creates a second entry',
    r1 = 'ok:0' and r2 = 'err:23505' and n = 1, concat_ws(' ', r1, r2, 'rows=' || n));
end $$;

do $$ declare id1 uuid; r1 text; r2 text; r3 text; r4 text; r5 text; e record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  perform ntests.attempt(ntests.log_sql(0, 1, '11111111-0000-0000-0000-000000000002'));
  perform ntests.reset();
  select id into id1 from public.nutrition_log_entries where client_request_id = '11111111-0000-0000-0000-000000000002';
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := ntests.attempt(format('update public.nutrition_log_entries set deleted_at = %L where id = %L', '2000-01-01', id1));
  r2 := ntests.attempt(format('update public.nutrition_log_entries set deleted_at = now() where id = %L', id1));
  r3 := ntests.attempt(format('update public.nutrition_log_entries set deleted_at = null where id = %L', id1));
  r4 := ntests.attempt(format('delete from public.nutrition_log_entries where id = %L', id1));
  r5 := ntests.attempt(format('update public.nutrition_log_entries set kcal = 1 where id = %L', id1));
  perform ntests.reset();
  select * into e from public.nutrition_log_entries where id = id1;
  perform ntests.rec('T05', 'tracking', 'removal marks the entry (server time, audit kept); no hard delete, no undo, no edits',
    r1 = 'ok:1' and r2 = 'err:22023' and r3 = 'err:22023' and r4 = 'err:42501' and r5 = 'err:42501'
      and e.deleted_at > now() - interval '1 minute' and e.kcal = 500,
    concat_ws(' ', r1, r2, r3, r4, r5));
end $$;

do $$ declare n_read int; r_upd text; r_sum text; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  select count(*) into n_read from public.nutrition_log_entries where user_id = '00000000-0000-0000-0000-000000000f01';
  r_upd := ntests.attempt($q$update public.nutrition_log_entries set deleted_at = now() where user_id = '00000000-0000-0000-0000-000000000f01'$q$);
  r_sum := ntests.scalar(format('select count(*) from public.nutrition_daily_summary(%L, %L, %L) where has_log', ntests.d(-6), ntests.d(), ntests.d()));
  perform ntests.reset();
  perform ntests.rec('T06', 'access', 'another customer cannot read, remove or summarise someone else''s entries',
    n_read = 0 and r_upd = 'ok:0' and r_sum = '0', format('read=%s update=%s summary_days=%s', n_read, r_upd, r_sum));
end $$;

do $$ declare r1 text; r2 text; r3 text; begin
  perform ntests.act('anon');
  r1 := ntests.scalar('select count(*) from public.nutrition_log_entries');
  r2 := ntests.scalar(format('select count(*) from public.nutrition_daily_summary(%L, %L, null)', ntests.d(), ntests.d()));
  r3 := ntests.scalar(format('select current_streak from public.nutrition_streak(%L)', ntests.d()));
  perform ntests.reset();
  perform ntests.rec('T07', 'access', 'anon has no access to entries, summaries or streaks', r1 = 'err:42501' and r2 = 'err:42501' and r3 = 'err:42501',
    concat_ws(' ', r1, r2, r3));
end $$;

-- Daily summary: totals, remaining, no-log vs logged days.
do $$ declare s record; y record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  select * into s from public.nutrition_daily_summary(ntests.d(), ntests.d(), ntests.d());
  select * into y from public.nutrition_daily_summary(ntests.d(-1), ntests.d(-1), ntests.d());
  perform ntests.reset();
  -- today: 750 (T01) ; the T05 entry was removed
  perform ntests.rec('T08', 'summary', 'today: consumed from non-removed entries; target from the snapshot; a day without entries is NULL, not 0',
    s.consumed_kcal = 750 and s.entry_count = 1 and s.has_log and s.target_kcal = 2556 and s.target_source = 'snapshot'
      and 2556 - s.consumed_kcal = 1806
      and not y.has_log and y.consumed_kcal is null and y.entry_count = 0 and y.target_kcal is null,
    format('today=%s/%s src=%s yesterday has_log=%s consumed=%s', s.consumed_kcal, s.target_kcal, s.target_source, y.has_log, coalesce(y.consumed_kcal::text, 'null')));
end $$;

do $$ declare s record; n int; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f03');
  select * into s from public.nutrition_daily_summary(ntests.d(), ntests.d(), ntests.d());
  select count(*) into n from public.nutrition_daily_summary(ntests.d(-100), ntests.d(), ntests.d());
  perform ntests.reset();
  perform ntests.rec('T09', 'summary', 'no target is invented when the estimate is unavailable; ranges over 92 days return nothing',
    s.target_kcal is null and s.target_source is null and n = 0, format('target=%s range_rows=%s', coalesce(s.target_kcal::text, 'null'), n));
end $$;

-- Historical target preservation.
do $$ declare t_before int; t_old int; t_today int; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  perform ntests.attempt(ntests.log_sql(-1, 1, gen_random_uuid()::text));
  perform ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text));
  perform ntests.reset();
  select target_kcal into t_before from public.nutrition_daily_targets where user_id = '00000000-0000-0000-0000-000000000f02' and local_date = ntests.d();
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  perform ntests.attempt($q$update public.user_profiles set weight = 70 where user_id = auth.uid()$q$);
  perform ntests.reset();
  select target_kcal into t_old from public.nutrition_daily_targets where user_id = '00000000-0000-0000-0000-000000000f02' and local_date = ntests.d(-1);
  select target_kcal into t_today from public.nutrition_daily_targets where user_id = '00000000-0000-0000-0000-000000000f02' and local_date = ntests.d();
  -- woman 25y 165cm sedentary: 60 kg -> 1614 ; 70 kg -> (1345.25+100)*1.2 = 1734
  perform ntests.rec('T10', 'history', 'a profile change updates today''s target and keeps the target that applied to earlier days',
    t_before = 1614 and t_today = 1734 and t_old = 1614, format('before=%s today=%s yesterday=%s', t_before, t_today, t_old));
end $$;

-- Time zone boundaries: "today" is the caller's local day.
do $$ declare r_k text; r_p text; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r_k := ntests.attempt(format($q$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings)
           values (gen_random_uuid(), %L, 'Pacific/Kiritimati', '00000000-0000-0000-0000-00000000aa01', 1)$q$,
           (now() at time zone 'Pacific/Kiritimati')::date));
  r_p := ntests.attempt(format($q$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings)
           values (gen_random_uuid(), %L, 'Pacific/Pago_Pago', '00000000-0000-0000-0000-00000000aa01', 1)$q$,
           (now() at time zone 'Pacific/Kiritimati')::date));
  perform ntests.reset();
  perform ntests.rec('T11', 'timezone', 'the same calendar date is "today" in UTC+14 but still the future in UTC-11',
    r_k = 'ok:1' and r_p = 'err:22023', concat_ws(' ', r_k, r_p));
  -- clean up so streak tests below are not affected
  delete from public.nutrition_log_entries where user_id = '00000000-0000-0000-0000-000000000f01' and time_zone = 'Pacific/Kiritimati';
end $$;

-- Logging an ordered meal.
do $$ declare item uuid; r1 text; r2 text; r3 text; r4 text; begin
  select id into item from public.order_items where order_id = '00000000-0000-0000-0000-00000000a001' limit 1;
  perform ntests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r1 := ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text, '00000000-0000-0000-0000-00000000aa01', 'Africa/Casablanca', item::text));
  r2 := ntests.attempt(ntests.log_sql(0, 0.5, gen_random_uuid()::text, '00000000-0000-0000-0000-00000000aa01', 'Africa/Casablanca', item::text));
  r3 := ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text, '00000000-0000-0000-0000-00000000aa02', 'Africa/Casablanca', item::text));
  perform ntests.reset();
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r4 := ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text, '00000000-0000-0000-0000-00000000aa01', 'Africa/Casablanca', item::text));
  perform ntests.reset();
  perform ntests.rec('T12', 'tracking', 'an ordered meal can be logged explicitly, never beyond the ordered quantity, only by its customer',
    r1 = 'ok:1' and r2 = 'err:22023' and r3 = 'err:22023' and r4 = 'err:42501', concat_ws(' ', r1, r2, r3, r4));
end $$;

-- ============================ Streaks ============================
do $$ declare s record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  select * into s from public.nutrition_streak(ntests.d());
  perform ntests.reset();
  perform ntests.rec('S01', 'streak', 'one logged day = streak 1, next milestone 7', s.current_streak = 1 and s.longest_streak = 1
    and s.today_logged and s.next_milestone = 7, format('cur=%s longest=%s next=%s', s.current_streak, s.longest_streak, s.next_milestone));
end $$;

do $$ declare s record; s2 record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  for i in 1..6 loop
    perform ntests.attempt(ntests.log_sql(-i, 1, gen_random_uuid()::text));
  end loop;
  perform ntests.attempt(ntests.log_sql(-3, 1, gen_random_uuid()::text));  -- second entry on one day
  perform ntests.attempt(format($q$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings)
     values (gen_random_uuid(), %L, 'Europe/Paris', '00000000-0000-0000-0000-00000000aa01', 1)$q$, ntests.d(-2)));  -- same day, other zone
  select * into s from public.nutrition_streak(ntests.d());
  select * into s2 from public.nutrition_streak(ntests.d(1));
  perform ntests.reset();
  perform ntests.rec('S02', 'streak', 'seven consecutive days = 7 (multiple entries and time zones per day count once); next milestone 14',
    s.current_streak = 7 and s.longest_streak = 7 and s.next_milestone = 14 and public.nutrition_is_milestone(s.current_streak),
    format('cur=%s longest=%s next=%s', s.current_streak, s.longest_streak, s.next_milestone));
  perform ntests.rec('S03', 'streak', 'the streak is kept while the next day has no entry yet (the day is not over)',
    s2.current_streak = 7 and not s2.today_logged, format('tomorrow cur=%s', s2.current_streak));
end $$;

do $$ declare s record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  perform ntests.attempt(format('update public.nutrition_log_entries set deleted_at = now() where local_date = %L and deleted_at is null', ntests.d(-3)));
  select * into s from public.nutrition_streak(ntests.d());
  perform ntests.reset();
  perform ntests.rec('S04', 'streak', 'removing a day''s entries breaks the streak; current and longest are recomputed from records',
    s.current_streak = 3 and s.longest_streak = 3, format('cur=%s longest=%s', s.current_streak, s.longest_streak));
end $$;

do $$ declare s record; begin
  select * into s from public.nutrition_streak_for('00000000-0000-0000-0000-000000000f01', ntests.d(2));
  perform ntests.rec('S05', 'streak', 'a missed day ends the current streak (longest kept)', s.current_streak = 0 and s.longest_streak = 3,
    format('cur=%s longest=%s', s.current_streak, s.longest_streak));
end $$;

-- ============================ Push tokens ============================
do $$ declare r1 text; r2 text; r3 text; owner uuid; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  r1 := ntests.attempt($q$select public.register_push_token('ExponentPushToken[shared-device-0001]', 'ios')$q$);
  perform ntests.reset();
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f05');
  r2 := ntests.attempt($q$select public.register_push_token('ExponentPushToken[shared-device-0001]', 'ios')$q$);
  r3 := ntests.attempt($q$select public.register_push_token('not-a-token', 'ios')$q$);
  perform ntests.reset();
  select user_id into owner from public.user_push_tokens where push_token = 'ExponentPushToken[shared-device-0001]';
  perform ntests.rec('P01', 'push', 'a device token belongs to the account signed in on it now; malformed tokens refused',
    r1 = 'ok:1' and r2 = 'ok:1' and r3 = 'err:22023' and owner = '00000000-0000-0000-0000-000000000f05', concat_ws(' ', r1, r2, r3, owner::text));
end $$;

do $$ declare r1 text; r2 text; active boolean; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  r1 := ntests.attempt($q$select public.deactivate_push_token('ExponentPushToken[shared-device-0001]')$q$);  -- not the owner any more
  perform ntests.reset();
  select is_active into active from public.user_push_tokens where push_token = 'ExponentPushToken[shared-device-0001]';
  perform ntests.act('anon');
  r2 := ntests.attempt($q$select public.register_push_token('ExponentPushToken[anon-device-00001]', 'ios')$q$);
  perform ntests.reset();
  perform ntests.rec('P02', 'push', 'only the owner can deactivate a token; anon cannot register', active and r2 = 'err:42501', concat_ws(' ', r1, r2, active::text));
end $$;

-- ============================ Preferences ============================
do $$ declare r1 text; r2 text; r3 text; r4 text; p record; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  r1 := ntests.attempt($q$insert into public.notification_preferences (reminders_enabled, daily_time, time_zone) values (true, '23:00', 'Africa/Casablanca')$q$);
  r2 := ntests.attempt($q$insert into public.notification_preferences (reminders_enabled, time_zone) values (true, 'Nowhere/Here')$q$);
  r3 := ntests.attempt($q$insert into public.notification_preferences (reminders_enabled, time_zone, user_id) values (true, 'Africa/Casablanca', '00000000-0000-0000-0000-000000000f05')$q$);
  r4 := ntests.attempt($q$insert into public.notification_preferences (reminders_enabled, progress_enabled, evening_enabled, time_zone)
                         values (true, true, true, 'Africa/Casablanca')$q$);
  perform ntests.reset();
  select * into p from public.notification_preferences where user_id = '00000000-0000-0000-0000-000000000f04';
  perform ntests.rec('R01', 'prefs', 'preferences are the owner''s; reminders inside quiet hours and unknown zones refused; defaults applied',
    r1 = 'err:22023' and r2 = 'err:22023' and r3 = 'err:42501' and r4 = 'ok:1' and p.daily_time = '12:00' and p.quiet_start = '22:00'
      and p.milestones_enabled and not p.reengagement_enabled,
    concat_ws(' ', r1, r2, r3, r4));
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  r1 := ntests.scalar('select count(*) from public.notification_deliveries');
  r2 := ntests.scalar('select count(*) from public.notification_settings');
  r3 := ntests.attempt('select public.nutrition_plan_notifications(now())');
  r4 := ntests.attempt('select public.nutrition_claim_deliveries(10)');
  r5 := ntests.scalar($q$select count(*) from public.notification_preferences where user_id <> auth.uid()$q$);
  perform ntests.reset();
  perform ntests.rec('R02', 'access', 'customers cannot read deliveries/settings, run the planner or claim sends, or see others'' preferences',
    r1 = 'err:42501' and r2 = 'err:42501' and r3 = 'err:42501' and r4 = 'err:42501' and r5 = '0', concat_ws(' ', r1, r2, r3, r4, r5));
end $$;

-- ============================ Planner ============================
-- f04: opted in, token active, target 2556-equivalent profile; nothing logged today.
do $$ declare n_before int; n_due int; n_again int; n_late int; begin
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  perform public.register_push_token('ExponentPushToken[device-f04-000001]', 'android');
  perform ntests.reset();
  select count(*) into n_before from public.nutrition_plan_notifications(ntests.at_local(0, '11:59'));
  select count(*) into n_due from public.nutrition_plan_notifications(ntests.at_local(0, '12:30')) where kind = 'daily_target';
  select count(*) into n_again from public.nutrition_plan_notifications(ntests.at_local(0, '12:45'));
  select count(*) into n_late from public.nutrition_plan_notifications(ntests.at_local(-1, '15:00'));
  perform ntests.rec('N01', 'schedule', 'daily target reminder at the user''s local time, once per day; nothing before it or after the send window',
    n_before = 0 and n_due = 1 and n_again = 0 and n_late = 0, format('before=%s due=%s again=%s late=%s', n_before, n_due, n_again, n_late));
end $$;

do $$ declare n_progress_empty int; n_evening int; n_progress int; body text; n_quiet int; begin
  select count(*) into n_progress_empty from public.nutrition_plan_notifications(ntests.at_local(0, '16:10')) where kind = 'progress';
  select count(*) into n_evening from public.nutrition_plan_notifications(ntests.at_local(0, '20:40')) where kind = 'evening';
  perform ntests.rec('N02', 'schedule', 'no progress message without logged meals; evening reminder only when nothing is logged',
    n_progress_empty = 0 and n_evening = 1, format('progress=%s evening=%s', n_progress_empty, n_evening));
  -- daily cap (2) reached for f04 today: daily_target + evening
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  perform ntests.attempt(ntests.log_sql(0, 1, gen_random_uuid()::text));
  perform ntests.reset();
  select count(*) into n_progress from public.nutrition_plan_notifications(ntests.at_local(0, '16:20'));
  perform ntests.rec('N03', 'frequency', 'at most 2 notifications per user per local day', n_progress = 0, 'after cap: ' || n_progress);
  select count(*) into n_quiet from public.nutrition_plan_notifications(ntests.at_local(0, '23:30'));
  perform ntests.rec('N04', 'quiet', 'nothing during quiet hours', n_quiet = 0 and public.in_quiet_hours('23:30', '22:00', '08:00')
    and public.in_quiet_hours('07:59', '22:00', '08:00') and not public.in_quiet_hours('08:00', '22:00', '08:00'), 'quiet=' || n_quiet);
end $$;

-- Progress with genuine data (f04 tomorrow: log, then progress at 16:10 shows the real total).
do $$ declare b text; n int; begin
  update public.notification_deliveries set local_date = local_date - 10, dedupe_key = dedupe_key || ':moved' where user_id = '00000000-0000-0000-0000-000000000f04';
  perform ntests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  perform ntests.attempt(ntests.log_sql(0, 2, gen_random_uuid()::text));
  perform ntests.reset();
  select body into b from public.nutrition_plan_notifications(ntests.at_local(0, '16:10')) where kind = 'progress';
  perform ntests.rec('N05', 'content', 'progress message uses the real logged total', b like '%1500 kcal%', coalesce(b, 'none'));
end $$;

-- No target, no target/progress messages (f03 has 'unspecified').
do $$ declare n int; begin
  insert into public.user_push_tokens (user_id, push_token, device_type, is_active) values ('00000000-0000-0000-0000-000000000f03', 'ExponentPushToken[device-f03-000001]', 'ios', true);
  insert into public.notification_preferences (user_id, reminders_enabled, progress_enabled, time_zone) values ('00000000-0000-0000-0000-000000000f03', true, true, 'Africa/Casablanca');
  insert into public.nutrition_log_entries (user_id, client_request_id, local_date, time_zone, meal_id, servings)
  values ('00000000-0000-0000-0000-000000000f03', gen_random_uuid(), ntests.d(), 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1);
  select count(*) into n from public.nutrition_plan_notifications(ntests.at_local(0, '12:30')) p where p.user_id = '00000000-0000-0000-0000-000000000f03';
  select n + count(*) into n from public.nutrition_plan_notifications(ntests.at_local(0, '16:10')) p where p.user_id = '00000000-0000-0000-0000-000000000f03';
  perform ntests.rec('N06', 'eligibility', 'no daily-target or progress message when no estimate exists', n = 0, 'queued=' || n);
end $$;

-- Opt-out and revoked tokens.
do $$ declare n1 int; n2 int; begin
  update public.notification_deliveries set local_date = local_date - 20, dedupe_key = dedupe_key || ':old' where user_id = '00000000-0000-0000-0000-000000000f04';
  update public.notification_preferences set reminders_enabled = false where user_id = '00000000-0000-0000-0000-000000000f04';
  select count(*) into n1 from public.nutrition_plan_notifications(ntests.at_local(0, '12:30')) p where p.user_id = '00000000-0000-0000-0000-000000000f04';
  update public.notification_preferences set reminders_enabled = true where user_id = '00000000-0000-0000-0000-000000000f04';
  update public.user_push_tokens set is_active = false where user_id = '00000000-0000-0000-0000-000000000f04';
  select count(*) into n2 from public.nutrition_plan_notifications(ntests.at_local(0, '12:30')) p where p.user_id = '00000000-0000-0000-0000-000000000f04';
  update public.user_push_tokens set is_active = true where user_id = '00000000-0000-0000-0000-000000000f04';
  perform ntests.rec('N07', 'consent', 'opted-out users and users without an active token receive nothing', n1 = 0 and n2 = 0, format('%s %s', n1, n2));
end $$;

-- Milestone (f01 had a 7-day run before S04 removed a day; rebuild it for f05).
do $$ declare n int; again int; begin
  insert into public.notification_preferences (user_id, reminders_enabled, daily_target_enabled, time_zone)
  values ('00000000-0000-0000-0000-000000000f05', true, false, 'Africa/Casablanca')
  on conflict (user_id) do update set reminders_enabled = true, daily_target_enabled = false;
  for i in 0..6 loop
    insert into public.nutrition_log_entries (user_id, client_request_id, local_date, time_zone, meal_id, servings)
    values ('00000000-0000-0000-0000-000000000f05', gen_random_uuid(), ntests.d(-i), 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1);
  end loop;
  select count(*) into n from public.nutrition_plan_notifications(ntests.at_local(0, '13:00')) p
   where p.user_id = '00000000-0000-0000-0000-000000000f05' and p.kind = 'milestone' and p.title like '%7 jours%';
  select count(*) into again from public.nutrition_plan_notifications(ntests.at_local(0, '17:00')) p
   where p.user_id = '00000000-0000-0000-0000-000000000f05' and p.kind = 'milestone';
  perform ntests.rec('N08', 'milestone', 'a genuine 7-day streak queues one milestone message, never twice', n = 1 and again = 0, format('%s %s', n, again));
end $$;

-- Re-engagement: inactive >= 3 days, cooldown 7 days, daily target suppressed.
do $$ declare n_re int; n_daily int; n_cool int; begin
  insert into public.notification_preferences (user_id, reminders_enabled, reengagement_enabled, time_zone)
  values ('00000000-0000-0000-0000-000000000f02', true, true, 'Africa/Casablanca');
  insert into public.user_push_tokens (user_id, push_token, device_type, is_active) values ('00000000-0000-0000-0000-000000000f02', 'ExponentPushToken[device-f02-000001]', 'ios', true);
  update public.nutrition_log_entries set deleted_at = now() where user_id = '00000000-0000-0000-0000-000000000f02';
  insert into public.nutrition_log_entries (user_id, client_request_id, local_date, time_zone, meal_id, servings)
  values ('00000000-0000-0000-0000-000000000f02', gen_random_uuid(), ntests.d(-4), 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1);
  select count(*) filter (where kind = 'reengagement'), count(*) filter (where kind = 'daily_target') into n_re, n_daily
    from public.nutrition_plan_notifications(ntests.at_local(0, '12:10')) p where p.user_id = '00000000-0000-0000-0000-000000000f02';
  select count(*) into n_cool from public.nutrition_plan_notifications(ntests.at_local(1, '12:10')) p
   where p.user_id = '00000000-0000-0000-0000-000000000f02' and p.kind = 'reengagement';
  perform ntests.rec('N09', 'reengagement', 'inactive user: one gentle re-engagement (no daily reminder), then a cooldown',
    n_re = 1 and n_daily = 0 and n_cool = 0, format('re=%s daily=%s next_day=%s', n_re, n_daily, n_cool));
end $$;

-- Dispatch: claim, provider outcomes, invalid token deactivation, no double send.
do $$ declare c record; n_claim int; n_again int; st text; active boolean; begin
  select count(*) into n_claim from public.nutrition_claim_deliveries(500);
  select * into c from public.notification_deliveries where status = 'sending' and user_id = '00000000-0000-0000-0000-000000000f02' limit 1;
  perform public.nutrition_record_delivery(c.id, jsonb_build_array(
    jsonb_build_object('token', 'ExponentPushToken[device-f02-000001]', 'status', 'error', 'error', 'DeviceNotRegistered')), null);
  select status into st from public.notification_deliveries where id = c.id;
  select is_active into active from public.user_push_tokens where push_token = 'ExponentPushToken[device-f02-000001]';
  select count(*) into n_again from public.nutrition_claim_deliveries(500);
  perform ntests.rec('D01', 'dispatch', 'claimed once; DeviceNotRegistered deactivates the token and fails the delivery; nothing re-claimed',
    n_claim > 0 and st = 'failed' and not active and n_again = 0, format('claimed=%s status=%s active=%s again=%s', n_claim, st, active, n_again));
end $$;

do $$ declare c record; st text; n int; begin
  select * into c from public.notification_deliveries where status = 'sending' and user_id = '00000000-0000-0000-0000-000000000f05' limit 1;
  perform public.nutrition_record_delivery(c.id, jsonb_build_array(
    jsonb_build_object('token', 'ExponentPushToken[shared-device-0001]', 'status', 'ok', 'id', 'ticket-1')), null);
  select status into st from public.notification_deliveries where id = c.id;
  perform public.nutrition_record_receipts('[{"ticket_id":"ticket-1","status":"error","error":"DeviceNotRegistered"}]'::jsonb);
  select count(*) into n from public.user_push_tokens where push_token = 'ExponentPushToken[shared-device-0001]' and is_active;
  perform ntests.rec('D02', 'dispatch', 'a sent ticket is recorded; a DeviceNotRegistered receipt deactivates the token', st = 'sent' and n = 0,
    format('status=%s active_tokens=%s', st, n));
end $$;

select id, case when passed then 'PASS' else 'FAIL' end, area, expectation, detail from ntests.results order by id;
