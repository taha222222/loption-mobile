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

-- ============================ Workouts ============================
-- A workout insert as PostgREST sends it (client columns only), relative
-- to now(): started p_ago_min minutes ago, lasting p_len_min minutes.
create or replace function atests.workout_sql(p_source text, p_kind text, p_ago_min int, p_len_min int, p_active_s int,
                                              p_dist text default 'null', p_energy text default 'null',
                                              p_csid text default null, p_ext text default null,
                                              p_tz text default 'Africa/Casablanca')
returns text language sql stable as $$
  select format($f$insert into public.workout_sessions (source, client_session_id, external_id, kind, started_at, ended_at,
                     active_seconds, time_zone, distance_m, distance_source, provider_energy_kcal)
                   values (%L, %s, %s, %L, now() - interval '%s minutes', now() - interval '%s minutes', %s, %L, %s, %s, %s)
                   on conflict do nothing$f$,
                p_source, coalesce(quote_literal(p_csid), 'null'), coalesce(quote_literal(p_ext), 'null'), p_kind,
                p_ago_min, p_ago_min - p_len_min, p_active_s, p_tz, p_dist,
                case when p_dist = 'null' then 'null' when p_source = 'app' then '''gps''' else '''provider''' end, p_energy)
$$;
grant execute on all functions in schema atests to anon, authenticated, service_role;

do $$ declare r text; w record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('app', 'walk', 600, 30, 1800, 'null', 'null', '22222222-0000-0000-0000-000000000001'));
  perform atests.reset();
  select * into w from public.workout_sessions where client_session_id = '22222222-0000-0000-0000-000000000001';
  perform atests.rec('W01', 'workouts', 'an app walk gets a server MET estimate (3.5 MET, net of rest, 70 kg, 30 min = 88 kcal)',
    r = 'ok:1' and w.energy_source = 'met_estimate' and w.met = 3.5 and w.energy_kcal = 88 and w.weight_kg = 70
      and w.local_date = (w.started_at at time zone 'Africa/Casablanca')::date,
    r || ' ' || coalesce(w.energy_kcal::text, 'null') || ' ' || coalesce(w.energy_source, '?'));
end $$;

do $$ declare r text; w record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('app', 'run', 300, 25, 1500, '5000', 'null', '22222222-0000-0000-0000-000000000002'));
  perform atests.reset();
  select * into w from public.workout_sessions where client_session_id = '22222222-0000-0000-0000-000000000002';
  perform atests.rec('W02', 'workouts', 'an app run with GPS distance uses the speed tier (12 km/h = 11.0 MET, 292 kcal)',
    r = 'ok:1' and w.met = 11.0 and w.energy_kcal = 292 and w.distance_source = 'gps',
    r || ' ' || coalesce(w.met::text, 'null') || ' ' || coalesce(w.energy_kcal::text, 'null'));
end $$;

do $$ declare r1 text; r2 text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r1 := atests.attempt(atests.workout_sql('app', 'gym', 900, 45, 2700, 'null', '400', '22222222-0000-0000-0000-000000000003'));
  r2 := atests.attempt($q$insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, energy_kcal)
                          values ('app', gen_random_uuid(), 'gym', now() - interval '20 hours', now() - interval '19 hours', 3600, 'Africa/Casablanca', 999)$q$);
  perform atests.reset();
  perform atests.rec('W03', 'security', 'a client cannot send the energy of an app workout (neither field)',
    r1 like 'err:22023%' and r2 like 'err:42501%', r1 || ' | ' || r2);
end $$;

do $$ declare r text; n int; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('app', 'walk', 600, 30, 1800, 'null', 'null', '22222222-0000-0000-0000-000000000001'));
  perform atests.reset();
  select count(*) into n from public.workout_sessions where client_session_id = '22222222-0000-0000-0000-000000000001';
  perform atests.rec('W04', 'integrity', 'a retried upload of the same session creates no duplicate', r = 'ok:0' and n = 1, r || ' rows=' || n);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('app', 'cycle', 590, 20, 1200, 'null', 'null', '22222222-0000-0000-0000-000000000004'));
  perform atests.reset();
  perform atests.rec('W05', 'integrity', 'an app session overlapping another app session is refused', r like 'err:22023%overlaps%', r);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('app', 'walk', 1200, 20, 1200, '10000', 'null', '22222222-0000-0000-0000-000000000005'));
  perform atests.reset();
  perform atests.rec('W06', 'integrity', 'an implausible distance (a 30 km/h walk) is refused', r like 'err:22023%implausible%', r);
end $$;

do $$ declare r text; w record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('apple_health', 'run', 302, 27, 1600, '5100', '330', null, 'HK-RUN-1'));
  perform atests.reset();
  select * into w from public.workout_sessions where external_id = 'HK-RUN-1';
  perform atests.rec('W07', 'workouts', 'an imported run keeps the provider''s measured energy',
    r = 'ok:1' and w.energy_source = 'provider_measured' and w.energy_kcal = 330 and w.met is null and w.distance_source = 'provider',
    r || ' ' || coalesce(w.energy_source, '?'));
end $$;

do $$ declare r text; n int; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('apple_health', 'run', 302, 27, 1600, '5100', '330', null, 'HK-RUN-1'));
  perform atests.reset();
  select count(*) into n from public.workout_sessions where external_id = 'HK-RUN-1';
  perform atests.rec('W08', 'integrity', 're-importing the same provider workout creates no duplicate', r = 'ok:0' and n = 1, r || ' rows=' || n);
end $$;

do $$ declare app record; imp record; n int; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  select * into app from public.activity_workouts(atests.d(-2), atests.d(0)) where source = 'app' and kind = 'run';
  select * into imp from public.activity_workouts(atests.d(-2), atests.d(0)) where source = 'apple_health';
  select count(*) into n from public.activity_workouts(atests.d(-2), atests.d(0)) where duplicate_of is null and kind = 'run';
  perform atests.reset();
  perform atests.rec('W09', 'deduplication', 'the app run and the same run imported from Apple Health count once (the measured one)',
    app.duplicate_of = imp.id and imp.duplicate_of is null and n = 1,
    coalesce(app.duplicate_of::text, 'null') || ' counted=' || n);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(atests.workout_sql('apple_health', 'gym', 1500, 40, 2400, '300', 'null', null, 'HK-GYM-1'));
  perform atests.reset();
  perform atests.rec('W10', 'integrity', 'a gym session cannot carry a distance', r like 'err:23514%' or r like 'err:22023%', r);
end $$;

do $$ declare r text; w record; begin
  update public.user_profiles set weight = null where user_id = '00000000-0000-0000-0000-000000000f04';
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f04');
  r := atests.attempt(atests.workout_sql('app', 'gym', 120, 50, 3000, 'null', 'null', '22222222-0000-0000-0000-000000000006'));
  perform atests.reset();
  select * into w from public.workout_sessions where client_session_id = '22222222-0000-0000-0000-000000000006';
  perform atests.rec('W11', 'workouts', 'without a valid body weight no calories are invented (energy unavailable)',
    r = 'ok:1' and w.energy_kcal is null and w.energy_source = 'none', r || ' ' || coalesce(w.energy_source, '?'));
end $$;

do $$ declare n text; r text; left_n int; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  n := atests.scalar('select count(*) from public.workout_sessions');
  r := atests.attempt('delete from public.workout_sessions');
  perform atests.reset();
  select count(*) into left_n from public.workout_sessions where user_id = '00000000-0000-0000-0000-000000000f01';
  perform atests.rec('W12', 'security', 'another customer can neither see nor delete these workouts', n = '0' and r = 'ok:0' and left_n >= 3,
    n || ' | ' || r || ' left=' || left_n);
end $$;

do $$ declare r1 text; r2 text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r1 := atests.attempt(atests.workout_sql('app', 'walk', 32 * 1440, 30, 1800, 'null', 'null', '22222222-0000-0000-0000-000000000007'));
  r2 := atests.attempt(atests.workout_sql('app', 'walk', 10, 20, 600, 'null', 'null', '22222222-0000-0000-0000-000000000008'));
  perform atests.reset();
  perform atests.rec('W13', 'integrity', 'sessions older than 30 days or ending in the future are refused',
    r1 like 'err:22023%' and r2 like 'err:22023%', r1 || ' | ' || r2);
end $$;

do $$ declare r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := atests.attempt(atests.workout_sql('app', 'walk', 100, 10, 1800, 'null', 'null', '22222222-0000-0000-0000-000000000009'));
  perform atests.reset();
  perform atests.rec('W14', 'integrity', 'active time longer than the session is refused', r like 'err:22023%active time%', r);
end $$;

do $$ declare r text; w record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := atests.attempt(atests.workout_sql('app', 'cycle', 200, 60, 3600, '18000', 'null', '22222222-0000-0000-0000-00000000000a', null, 'Pacific/Kiritimati'));
  perform atests.reset();
  select * into w from public.workout_sessions where client_session_id = '22222222-0000-0000-0000-00000000000a';
  perform atests.rec('W15', 'time zones', 'a session belongs to the local date of its start in the zone it was recorded in (18 km/h ride = 6.8 MET)',
    r = 'ok:1' and w.local_date = (w.started_at at time zone 'Pacific/Kiritimati')::date and w.met = 6.8,
    r || ' ' || coalesce(w.local_date::text, '?'));
end $$;

do $$ begin
  perform atests.rec('W16', 'workouts', 'MET tiers per kind and speed',
    public.activity_met('walk', null) = 3.5 and public.activity_met('walk', 1.7) = 4.3 and public.activity_met('run', 4.5) = 14.5
      and public.activity_met('cycle', 7.0) = 10.0 and public.activity_met('gym', null) = 3.5, 'tiers');
end $$;

-- ============================ Energy model ============================
do $$ declare a record; b record; c record; d record; e record; f record; begin
  select * into a from public.activity_energy_estimate(1649, 2556, 400, 2300, 'complete');
  select * into b from public.activity_energy_estimate(1649, 2556, 400, null, 'partial');
  select * into c from public.activity_energy_estimate(1649, 2556, null, null, null);
  select * into d from public.activity_energy_estimate(null, null, 400, null, 'partial');
  select * into e from public.activity_energy_estimate(null, 2556, 400, null, 'partial');
  select * into f from public.activity_energy_estimate(1649, 2556, 400, 1200, 'complete');
  perform atests.rec('E01', 'energy', 'platform total for a finished day; else BMR + active; else TDEE; nothing without inputs',
    a.estimate_kcal = 2300 and a.method = 'platform_total' and b.estimate_kcal = 2049 and b.method = 'bmr_plus_active'
      and c.estimate_kcal = 2556 and c.method = 'tdee_baseline' and d.estimate_kcal is null and d.method is null,
    format('%s/%s %s/%s %s/%s %s/%s', a.estimate_kcal, a.method, b.estimate_kcal, b.method, c.estimate_kcal, c.method, d.estimate_kcal, d.method));
  perform atests.rec('E02', 'energy', 'missing BMR: active energy cannot be used, the TDEE baseline remains; a total below BMR is ignored',
    e.estimate_kcal = 2556 and e.method = 'tdee_baseline' and f.estimate_kcal = 2049 and f.method = 'bmr_plus_active',
    format('%s/%s %s/%s', e.estimate_kcal, e.method, f.estimate_kcal, f.method));
end $$;

do $$ declare s record; r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1)$f$, atests.d(0)));
  select * into s from public.activity_daily_summary(atests.d(0), atests.d(0), atests.d(0));
  perform atests.reset();
  perform atests.rec('E03', 'energy', 'today: budget = BMR 1649 + active 350 so far; consumed 500 from the meal record; remaining 1499',
    r = 'ok:1' and s.energy_estimate_kcal = 1999 and s.energy_method = 'bmr_plus_active' and s.consumed_kcal = 500
      and s.remaining_kcal = 1499 and s.steps = 7000 and s.activity_source = 'apple_health',
    format('%s %s/%s consumed=%s remaining=%s', r, s.energy_estimate_kcal, s.energy_method, s.consumed_kcal, s.remaining_kcal));
end $$;

do $$ declare s record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  select * into s from public.activity_daily_summary(atests.d(-1), atests.d(-1), atests.d(0));
  perform atests.reset();
  perform atests.rec('E04', 'energy', 'a finished day with a platform total uses it (2290); no meal logged stays NULL, not 0',
    s.energy_estimate_kcal = 2290 and s.energy_method = 'platform_total' and s.consumed_kcal is null and not s.has_meal_log
      and s.remaining_kcal = 2290,
    format('%s/%s consumed=%s', s.energy_estimate_kcal, s.energy_method, coalesce(s.consumed_kcal::text, 'null')));
end $$;

do $$ declare before record; after record; r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  select * into before from public.activity_daily_summary(atests.d(0), atests.d(0), atests.d(0));
  r := atests.attempt($q$insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone)
                         values ('app', '22222222-0000-0000-0000-0000000000e5', 'run',
                                 greatest(now() - interval '40 minutes', (now() at time zone 'Africa/Casablanca')::date::timestamp at time zone 'Africa/Casablanca'),
                                 greatest(now() - interval '40 minutes', (now() at time zone 'Africa/Casablanca')::date::timestamp at time zone 'Africa/Casablanca') + interval '30 minutes',
                                 1800, 'Africa/Casablanca')$q$);
  select * into after from public.activity_daily_summary(atests.d(0), atests.d(0), atests.d(0));
  perform atests.reset();
  perform atests.rec('E05', 'double counting', 'a workout never changes the daily budget or remaining calories (already in active energy)',
    r = 'ok:1' and after.energy_estimate_kcal = before.energy_estimate_kcal and after.remaining_kcal = before.remaining_kcal
      and after.workout_count = before.workout_count + 1 and after.workout_kcal > coalesce(before.workout_kcal, 0) and after.workout_kcal_estimated,
    format('%s budget %s->%s workouts %s->%s', r, before.energy_estimate_kcal, after.energy_estimate_kcal, before.workout_count, after.workout_count));
end $$;

do $$ declare ok boolean := true; detail text := ''; s record; n_all int; n_counted int; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  for s in select * from public.activity_daily_summary(atests.d(-1), atests.d(0), atests.d(0)) loop
    select count(*), count(*) filter (where duplicate_of is null) into n_all, n_counted
      from public.activity_workouts(s.local_date, s.local_date);
    ok := ok and s.workout_count = n_counted;
    detail := detail || format('%s: %s of %s; ', s.local_date, s.workout_count, n_all);
  end loop;
  select count(*) into n_all from public.activity_workouts(atests.d(-1), atests.d(0)) where duplicate_of is not null;
  perform atests.reset();
  perform atests.rec('E06', 'double counting', 'the daily workout count excludes a session imported and recorded twice',
    ok and n_all >= 1, detail || 'duplicates=' || n_all);
end $$;

do $$ declare s record; r text; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f03');
  r := atests.attempt(atests.day_sql(0, 'apple_health', '5000', '3500', '200', 'null'));
  perform atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings)
                                   values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 1)$f$, atests.d(0)));
  select * into s from public.activity_daily_summary(atests.d(0), atests.d(0), atests.d(0));
  perform atests.reset();
  perform atests.rec('E07', 'energy', 'without BMR/TDEE no budget is invented, but consumed calories and steps are still shown',
    r = 'ok:1' and s.energy_estimate_kcal is null and s.energy_method is null and s.remaining_kcal is null
      and s.consumed_kcal = 500 and s.steps = 5000,
    format('%s budget=%s consumed=%s steps=%s', r, coalesce(s.energy_estimate_kcal::text, 'null'), s.consumed_kcal, s.steps));
end $$;

do $$ declare s record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  perform atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings)
                                   values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 4)$f$, atests.d(0)));
  select * into s from public.activity_daily_summary(atests.d(0), atests.d(0), atests.d(0));
  perform atests.reset();
  perform atests.rec('E08', 'energy', 'over budget is reported as a negative remaining value (TDEE 1614 - 2000 = -386), not clamped',
    s.energy_method = 'tdee_baseline' and s.consumed_kcal = 2000 and s.remaining_kcal = -386,
    format('%s/%s remaining=%s', s.energy_estimate_kcal, s.energy_method, s.remaining_kcal));
end $$;

do $$ declare d1 record; d2 record; begin
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  perform atests.attempt(atests.day_sql(-1, 'health_connect', '0', '0', '0', 'null'));
  perform atests.attempt(atests.day_sql(-1, 'device_motion', '500', 'null', 'null', 'null'));
  select * into d1 from public.activity_daily_summary(atests.d(-1), atests.d(-1), atests.d(0));
  select * into d2 from public.activity_daily_summary(atests.d(-2), atests.d(-2), atests.d(0));
  perform atests.reset();
  perform atests.rec('E09', 'history', 'a measured zero (0 steps) differs from a day without data (NULL source and steps)',
    d1.steps = 0 and d1.activity_source = 'health_connect' and d2.activity_source is null and d2.steps is null,
    format('d-1 %s/%s d-2 %s/%s', d1.activity_source, d1.steps, coalesce(d2.activity_source, 'null'), coalesce(d2.steps::text, 'null')));
  perform atests.rec('E10', 'double counting', 'one source per day: the health platform wins over the iPhone sensor, never a sum',
    d1.steps = 0 and d1.activity_source = 'health_connect', format('%s steps from %s', d1.steps, d1.activity_source));
end $$;

-- ============================ Meals from orders ============================
do $$ declare item uuid; r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; n int; req uuid := gen_random_uuid(); begin
  select id into item from public.order_items where order_id = '00000000-0000-0000-0000-00000000a001' limit 1;
  update public.orders set status = 'confirmed' where id = '00000000-0000-0000-0000-00000000a001';
  perform atests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r1 := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                 values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', %L, 1)$f$, atests.d(0), item));
  perform atests.reset();
  update public.orders set status = 'served' where id = '00000000-0000-0000-0000-00000000a001';
  perform atests.act('authenticated', '00000000-0000-0000-0000-0000000000c1');
  r2 := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                 values (%L, %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', %L, 0.5)$f$, req, atests.d(0), item));
  r3 := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                 values (%L, %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', %L, 0.5)
                                 on conflict (user_id, client_request_id) do nothing$f$, req, atests.d(0), item));
  r4 := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                 values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', %L, 0.5)$f$, atests.d(0), item));
  r5 := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                 values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', %L, 0.25)$f$, atests.d(0), item));
  r6 := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                 values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa02', %L, 0.25)$f$, atests.d(0), item));
  perform atests.reset();
  select count(*) into n from public.nutrition_log_entries where order_item_id = item and deleted_at is null;
  perform atests.rec('M01', 'meals', 'an order that was not delivered yet cannot be logged as eaten', r1 like 'err:22023%not been delivered%', r1);
  perform atests.rec('M02', 'meals', 'after delivery: partial portions (0.5 + 0.5 of 1), a retried request counts once, never beyond the quantity',
    r2 = 'ok:1' and r3 = 'ok:0' and r4 = 'ok:1' and r5 like 'err:22023%more servings%' and n = 2,
    concat_ws(' | ', r2, r3, r4, r5, 'entries=' || n));
  perform atests.rec('M03', 'meals', 'a meal without a reliable calorie value is refused (never invented)', r6 like 'err:22023%', r6);
  perform atests.rec('M04', 'meals', 'portion calories come from the meal record (0.5 x 500 = 250)',
    (select bool_and(kcal = 250) from public.nutrition_log_entries where order_item_id = item and deleted_at is null), 'kcal per half portion');
end $$;

do $$ declare item uuid; r text; begin
  select id into item from public.order_items where order_id = '00000000-0000-0000-0000-00000000a001' limit 1;
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := atests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, order_item_id, servings)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', %L, 0.25)$f$, atests.d(0), item));
  perform atests.reset();
  perform atests.rec('M05', 'security', 'another customer cannot log someone else''s delivered order', r like 'err:42501%', r);
  perform atests.rec('M06', 'meals', 'received statuses are delivered (app) and served (counter); others are not',
    public.order_received('delivered') and public.order_received('served') and not public.order_received('confirmed')
      and not public.order_received('on_the_way') and not coalesce(public.order_received(null), false), 'order_received()');
end $$;

-- ============================ History snapshots ============================
do $$ declare y record; t record; begin
  update public.user_profiles set weight = 80 where user_id = '00000000-0000-0000-0000-000000000f01';
  perform atests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  select * into y from public.activity_daily_summary(atests.d(-1), atests.d(-1), atests.d(0));
  select * into t from public.activity_daily_summary(atests.d(0), atests.d(0), atests.d(0));
  perform atests.reset();
  update public.user_profiles set weight = 70 where user_id = '00000000-0000-0000-0000-000000000f01';
  perform atests.rec('E11', 'history', 'after a profile change, past days keep their BMR snapshot and method; today is recalculated',
    y.bmr_kcal = 1649 and y.energy_method = 'platform_total' and t.bmr_kcal = 1749 and t.energy_estimate_kcal = 1749 + 350,
    format('yesterday bmr=%s today bmr=%s budget=%s', y.bmr_kcal, t.bmr_kcal, t.energy_estimate_kcal));
end $$;
