-- =====================================================================
-- V1 activity tests. DISPOSABLE DATABASE ONLY (run_v1_activity.sh). Runs
-- after Phase 1C core, the V1 onboarding, nutrition and activity
-- migrations. Acts like PostgREST (SET ROLE + request.jwt.claims) and
-- checks the resulting state as postgres. Local PostgreSQL results only.
--
-- Fixture users (created by the runner; time zone Africa/Casablanca):
--   ...0f01 man 30y 70kg 175cm moderate (BMR 1649, TDEE 2556)
--   ...0f02 woman 25y 60kg 165cm sedentary (BMR 1345, TDEE 1614)
--   ...0f03 sex input 'unspecified' (no BMR/TDEE)
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists atests;
create table if not exists atests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate atests.results;

create or replace function atests.act(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;
create or replace function atests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function atests.attempt(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;
create or replace function atests.scalar(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return 'err:' || sqlstate;
end $$;
create or replace function atests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into atests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
create or replace function atests.d(p_offset int default 0, p_tz text default 'Africa/Casablanca') returns date language sql stable as $$
  select (now() at time zone p_tz)::date + p_offset
$$;
-- A day upsert as PostgREST sends it (client columns only).
create or replace function atests.day_sql(p_day int, p_source text, p_steps text, p_dist text, p_active text, p_total text,
                                          p_tz text default 'Africa/Casablanca')
returns text language sql stable as $$
  select format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps, distance_m, active_energy_kcal, total_energy_kcal)
                   values (%L, %L, %L, %s, %s, %s, %s)
                   on conflict (user_id, local_date, source) do update set
                     local_date = excluded.local_date, source = excluded.source, time_zone = excluded.time_zone,
                     steps = excluded.steps, distance_m = excluded.distance_m,
                     active_energy_kcal = excluded.active_energy_kcal, total_energy_kcal = excluded.total_energy_kcal$f$,
                atests.d(p_day, p_tz), p_source, p_tz, p_steps, p_dist, p_active, p_total)
$$;
grant usage on schema atests to anon, authenticated, service_role;
grant execute on all functions in schema atests to anon, authenticated, service_role;

-- ============================ Activity days ============================
do $$ declare r text; row record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.day_sql(0, 'apple_health', '6230', '4500', '310', '2100'));
  perform atests.reset();
  select * into row from public.activity_daily_totals where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = atests.d(0);
  perform atests.rec('A01', 'days', 'owner sync of today: owner and sync time stamped by the server, coverage partial',
    r = 'ok:1' and row.steps = 6230 and row.coverage = 'partial' and abs(extract(epoch from now() - row.synced_at)) < 5, r);
  perform atests.rec('A02', 'days', 'a total energy value for an unfinished day is dropped', row.total_energy_kcal is null,
    coalesce(row.total_energy_kcal::text, 'null'));
end $$;

do $$ declare r text; row record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.day_sql(-1, 'apple_health', '9100', '6800', '420', '2290'));
  perform atests.reset();
  select * into row from public.activity_daily_totals where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = atests.d(-1);
  perform atests.rec('A03', 'days', 'a finished day is complete and keeps its total energy',
    r = 'ok:1' and row.coverage = 'complete' and row.total_energy_kcal = 2290, r || ' ' || coalesce(row.coverage, '?'));
end $$;

do $$ declare r text; v text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.day_sql(-2, 'apple_health', '100', 'null', '900', '500'));
  perform atests.reset();
  v := atests.scalar($q$select coalesce(total_energy_kcal::text, 'null') from public.activity_daily_totals
                        where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = (now() at time zone 'Africa/Casablanca')::date - 2$q$);
  perform atests.rec('A04', 'days', 'a total lower than the active energy is dropped (implausible)', r = 'ok:1' and v = 'null', r || ' ' || v);
end $$;

do $$ declare r1 text; r2 text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := atests.attempt(atests.day_sql(1, 'apple_health', '1', 'null', 'null', 'null'));
  r2 := atests.attempt(atests.day_sql(-31, 'apple_health', '1', 'null', 'null', 'null'));
  perform atests.reset();
  perform atests.rec('A05', 'days', 'future dates and dates older than 30 days are refused',
    r1 like 'err:22023%' and r2 like 'err:22023%', r1 || ' | ' || r2);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps)
                                values (%L, 'apple_health', 'Mars/Olympus', 1)$f$, atests.d(0)));
  perform atests.reset();
  perform atests.rec('A06', 'days', 'an unknown time zone is refused', r like 'err:%', r);
end $$;

do $$ declare r text; n int; s int; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.day_sql(0, 'apple_health', '7000', '5100', '350', 'null'));
  perform atests.reset();
  select count(*), max(steps) into n, s from public.activity_daily_totals
   where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = atests.d(0) and source = 'apple_health';
  perform atests.rec('A07', 'sync', 'a re-sync of the same day and source updates the one row (no duplicate)', r = 'ok:1' and n = 1 and s = 7000,
    r || ' rows=' || n || ' steps=' || s);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(format($f$insert into public.activity_daily_totals (user_id, local_date, source, time_zone, steps)
                                 values ('00000000-0000-0000-0000-000000000f02', %L, 'apple_health', 'Africa/Casablanca', 5)$f$, atests.d(0)));
  perform atests.reset();
  perform atests.rec('A08', 'security', 'a client cannot write a row for another account (user_id not insertable)', r like 'err:42501%', r);
end $$;

do $$ declare n text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  n := atests.scalar('select count(*) from public.activity_daily_totals');
  perform atests.reset();
  perform atests.rec('A09', 'security', 'another customer sees none of these health rows (RLS)', n = '0', n);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(format($f$update public.activity_daily_totals set local_date = %L
                                 where local_date = %L and source = 'apple_health'$f$, atests.d(-3), atests.d(0)));
  perform atests.reset();
  perform atests.rec('A10', 'security', 'the key columns of a row cannot be changed', r like 'err:22023%', r);
end $$;

do $$ declare r1 text; r2 text; begin
  perform atests.act('anon');
  r1 := atests.attempt('select * from public.activity_daily_totals');
  r2 := atests.attempt(atests.day_sql(0, 'apple_health', '1', 'null', 'null', 'null'));
  perform atests.reset();
  perform atests.rec('A11', 'security', 'anon can neither read nor write health data', r1 like 'err:42501%' and r2 like 'err:42501%', r1 || ' | ' || r2);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.day_sql(0, 'device_motion', '4000', '3000', 'null', 'null'));
  perform atests.reset();
  perform atests.rec('A12', 'days', 'the iPhone motion source carries steps only (no distance or energy)', r like 'err:23514%', r);
end $$;

do $$ declare r1 text; r2 text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := atests.attempt(atests.day_sql(-4, 'apple_health', '250000', 'null', 'null', 'null'));
  r2 := atests.attempt(atests.day_sql(-4, 'apple_health', '-1', 'null', 'null', 'null'));
  perform atests.reset();
  perform atests.rec('A13', 'days', 'out-of-range values are refused', r1 like 'err:23514%' and r2 like 'err:23514%', r1 || ' | ' || r2);
end $$;

do $$ declare r1 text; r2 text; n int; begin
  -- f02 syncs a day, then f01 tries to delete it, then f02 disconnects.
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  perform atests.attempt(atests.day_sql(0, 'health_connect', '3000', '2000', '120', 'null'));
  perform atests.reset();
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := atests.attempt($q$delete from public.activity_daily_totals where source = 'health_connect'$q$);
  perform atests.reset();
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r2 := atests.attempt($q$delete from public.activity_daily_totals where source = 'health_connect'$q$);
  perform atests.reset();
  select count(*) into n from public.activity_daily_totals where user_id = '00000000-0000-0000-0000-000000000f02';
  perform atests.rec('A14', 'privacy', 'disconnect deletes only the caller''s own imported days', r1 = 'ok:0' and r2 = 'ok:1' and n = 0,
    r1 || ' | ' || r2 || ' left=' || n);
end $$;

do $$ declare t record; begin
  select * into t from public.nutrition_daily_targets where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = atests.d(-1);
  perform atests.rec('A15', 'history', 'the first activity sync of a day records that day''s BMR/TDEE snapshot',
    t.bmr_kcal = 1649 and t.tdee_kcal = 2556, coalesce(t.bmr_kcal::text, 'none') || '/' || coalesce(t.tdee_kcal::text, 'none'));
end $$;

do $$ declare r1 text; r2 text; begin
  -- Kiritimati (UTC+14) is always at least one calendar day ahead of Pago Pago (UTC-11).
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r1 := atests.attempt(format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps)
                                  values (%L, 'apple_health', 'Pacific/Kiritimati', 10)$f$, atests.d(0, 'Pacific/Kiritimati')));
  r2 := atests.attempt(format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps)
                                  values (%L, 'apple_health', 'Pacific/Pago_Pago', 10)$f$, atests.d(0, 'Pacific/Kiritimati')));
  perform atests.reset();
  perform atests.rec('A16', 'time zones', 'a local date is accepted in the zone where it is today and refused where it is still tomorrow',
    r1 = 'ok:1' and r2 like 'err:22023%', r1 || ' | ' || r2);
  delete from public.activity_daily_totals where user_id = '00000000-0000-0000-0000-000000000f02';
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(format($f$update public.activity_daily_totals set synced_at = now() - interval '1 day'
                                where local_date = %L$f$, atests.d(0)));
  perform atests.reset();
  perform atests.rec('A17', 'security', 'the sync time cannot be set by a client', r like 'err:42501%', r);
end $$;
