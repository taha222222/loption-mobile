-- =====================================================================
-- V1 standalone tracking tests. DISPOSABLE DATABASE ONLY
-- (run_v1_standalone.sh). Runs after Phase 1C core, the V1 onboarding,
-- nutrition, activity and standalone migrations. Acts like PostgREST
-- (SET ROLE + request.jwt.claims). Local PostgreSQL results only.
--
-- Fixture users (created by the runner; time zone Africa/Casablanca):
--   ...0f01 man 30y 70kg 175cm moderate (BMR 1649 -> base 1814)
--   ...0f02 woman 25y 60kg 165cm sedentary
--   ...0f03 sex input 'unspecified' (no BMR/TDEE)
-- Workouts are placed in the 35 minutes before now: run the file outside
-- 00:00-00:40 Casablanca time.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists stests;
create table if not exists stests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate stests.results;

create or replace function stests.act(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;
create or replace function stests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function stests.attempt(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;
create or replace function stests.scalar(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;
create or replace function stests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into stests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
create or replace function stests.d(p_offset int default 0) returns date language sql stable as $$
  select (now() at time zone 'Africa/Casablanca')::date + p_offset
$$;
create or replace function stests.day_start(p_offset int default 0) returns timestamptz language sql stable as $$
  select stests.d(p_offset)::timestamp at time zone 'Africa/Casablanca'
$$;
create or replace function stests.summary(p_user uuid, p_day int default 0) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform stests.act('authenticated', p_user);
  select to_jsonb(s) into r from public.activity_daily_summary(stests.d(p_day), stests.d(p_day), stests.d(0)) s;
  perform stests.reset();
  return r;
end $$;
grant usage on schema stests to anon, authenticated, service_role;
grant execute on all functions in schema stests to anon, authenticated, service_role;

-- A phone day upsert as the app sends it: (day offset, steps, distance, from, to).
create or replace function stests.phone(p_day int, p_steps text, p_dist text, p_from text, p_to text) returns text
language sql stable as $$
  select format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps, distance_m, measured_from, measured_to)
                   values (%L, 'device_motion', 'Africa/Casablanca', %s, %s, %s, %s)
                   on conflict (user_id, local_date, source) do update set
                     local_date = excluded.local_date, source = excluded.source, time_zone = excluded.time_zone,
                     steps = excluded.steps, distance_m = excluded.distance_m,
                     measured_from = excluded.measured_from, measured_to = excluded.measured_to$f$,
                stests.d(p_day), p_steps, p_dist, p_from, p_to)
$$;
grant execute on function stests.phone(int, text, text, text, text) to authenticated;

-- ============================ Phone days ============================
do $$ declare r text; row record; win text; begin
  win := format('%L::timestamptz, now()', stests.day_start(0));
  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(stests.phone(0, '8000', '6000', format('%L::timestamptz', stests.day_start(0)), 'now()'));
  perform stests.reset();
  select * into row from public.activity_daily_totals
   where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = stests.d(0) and source = 'device_motion';
  perform stests.rec('S01', 'phone', 'a phone day with distance and measured window is stored (owner stamped)',
    r = 'ok:1' and row.steps = 8000 and row.distance_m = 6000 and row.measured_from = stests.day_start(0), r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(stests.phone(0, '7000', '5000', format('%L::timestamptz', stests.day_start(0)), 'now()'));
  perform stests.reset();
  select * into row from public.activity_daily_totals
   where user_id = '00000000-0000-0000-0000-000000000f01' and local_date = stests.d(0) and source = 'device_motion';
  perform stests.rec('S02', 'phone', 'a re-sync with a lower count never lowers the stored day', r = 'ok:1' and row.steps = 8000 and row.distance_m = 6000,
    r || ' steps=' || row.steps);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt(stests.phone(0, '9000', 'null', 'now() - interval ''10 minutes''', 'now()'));
  perform stests.reset();
  perform stests.rec('S03', 'phone', 'more than 4 steps per second of measured time is refused', r like 'err:22023:implausible step count%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt(stests.phone(0, '1000', '4000', 'null', 'null'));
  perform stests.reset();
  perform stests.rec('S04', 'phone', 'a distance longer than 2.5 m per step is refused', r like 'err:22023:implausible distance%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt(stests.phone(-1, '1000', 'null', format('%L::timestamptz', stests.day_start(-2)), format('%L::timestamptz', stests.day_start(-1))));
  perform stests.reset();
  perform stests.rec('S05', 'phone', 'a measurement window outside the local day is refused', r like 'err:22023:measurement window%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt(format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps, active_energy_kcal)
                               values (%L, 'device_motion', 'Africa/Casablanca', 100, 50)$f$, stests.d(0)));
  perform stests.reset();
  perform stests.rec('S06', 'phone', 'the phone source still cannot carry an energy value', r like 'err:23514%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt(format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps, measured_from)
                               values (%L, 'device_motion', 'Africa/Casablanca', 100, now())$f$, stests.d(0)));
  perform stests.reset();
  perform stests.rec('S07', 'phone', 'a window needs both ends', r like 'err:23514%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt($f$update public.activity_daily_totals set steps = 1 where user_id = '00000000-0000-0000-0000-000000000f01'$f$);
  perform stests.reset();
  perform stests.rec('S08', 'security', 'another customer''s phone day cannot be changed (RLS)', r = 'ok:0', r);
end $$;

-- ============================ Energy budget ============================
do $$ declare s jsonb; begin
  s := stests.summary('00000000-0000-0000-0000-000000000f01');
  perform stests.rec('E01', 'energy', 'phone steps: method bmr_plus_movement, base = BMR x 1.1 (1814)',
    s ->> 'energy_method' = 'bmr_plus_movement' and (s ->> 'base_kcal')::int = 1814, s::text);
  perform stests.rec('E02', 'energy', 'step energy = 0.5 kcal/kg/km of the measured distance (70 kg, 6 km = 210)',
    (s ->> 'step_kcal')::int = 210 and (s ->> 'energy_estimate_kcal')::int = 2024 and (s ->> 'activity_kcal')::int = 210,
    s ->> 'step_kcal');
  perform stests.rec('E03', 'energy', 'measured distance is not labelled estimated; confidence estimated',
    (s ->> 'walk_distance_m')::int = 6000 and (s ->> 'walk_distance_estimated')::boolean = false and s ->> 'confidence' = 'estimated', s::text);
end $$;

do $$ declare r text; s jsonb; w record; begin
  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt($f$insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, steps)
                         values ('app', '44444444-0000-0000-0000-000000000001', 'walk', now() - interval '35 minutes', now() - interval '5 minutes', 1800, 'Africa/Casablanca', 3000)$f$);
  perform stests.reset();
  select * into w from public.workout_sessions where client_session_id = '44444444-0000-0000-0000-000000000001';
  perform stests.rec('W01', 'workouts', 'an app walk keeps its phone step count; energy = (3.5-1) x 70 x 0.5 h = 88',
    r = 'ok:1' and w.steps = 3000 and w.energy_kcal = 88, r || ' ' || coalesce(w.energy_kcal::text, 'null'));
  s := stests.summary('00000000-0000-0000-0000-000000000f01');
  perform stests.rec('E04', 'energy', 'the walk''s steps are not counted twice: 5000 free steps (131 kcal) + walk 88',
    (s ->> 'step_kcal')::int = 131 and (s ->> 'counted_workout_kcal')::int = 88 and (s ->> 'energy_estimate_kcal')::int = 1814 + 131 + 88
    and (s ->> 'active_minutes')::int = 30, s::text);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt($f$insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, steps)
                         values ('app', '44444444-0000-0000-0000-000000000002', 'run', now() - interval '35 minutes', now() - interval '25 minutes', 600, 'Africa/Casablanca', 9000)$f$);
  perform stests.reset();
  perform stests.rec('W02', 'workouts', 'more than 4 steps per active second is refused', r like 'err:22023:implausible step count%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt($f$insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, intensity)
                         values ('app', '44444444-0000-0000-0000-000000000003', 'run', now() - interval '35 minutes', now() - interval '25 minutes', 600, 'Africa/Casablanca', 'vigorous')$f$);
  perform stests.reset();
  perform stests.rec('W03', 'workouts', 'an intensity on a non-gym session is refused', r like 'err:23514%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt($f$insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, intensity)
                         values ('app', '44444444-0000-0000-0000-000000000004', 'gym', now() - interval '35 minutes', now() - interval '5 minutes', 1800, 'Africa/Casablanca', 'vigorous')$f$);
  perform stests.reset();
  select * into w from public.workout_sessions where client_session_id = '44444444-0000-0000-0000-000000000004';
  perform stests.rec('W04', 'workouts', 'vigorous gym: MET 6.0 (Compendium 02050), (6-1) x 60 kg x 0.5 h = 150, labelled estimate',
    r = 'ok:1' and w.met = 6.0 and w.energy_kcal = 150 and w.energy_source = 'met_estimate', r || ' ' || coalesce(w.energy_kcal::text, 'null'));
  perform stests.rec('W05', 'workouts', 'intensity cannot be inserted as energy: energy_kcal stays server-only',
    not has_column_privilege('authenticated', 'public.workout_sessions', 'energy_kcal', 'INSERT'), null);
end $$;

do $$ declare s jsonb; begin
  s := stests.summary('00000000-0000-0000-0000-000000000f02');
  perform stests.rec('E05', 'energy', 'a gym session alone (no phone steps) does not create a movement budget: TDEE baseline',
    s ->> 'energy_method' = 'tdee_baseline' and s ->> 'step_kcal' is null and s ->> 'confidence' = 'baseline', s::text);
end $$;

do $$ declare r text; s jsonb; begin
  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt(stests.phone(-1, '0', 'null', format('%L::timestamptz', stests.day_start(-1)), format('%L::timestamptz', stests.day_start(0))));
  perform stests.reset();
  s := stests.summary('00000000-0000-0000-0000-000000000f02', -1);
  perform stests.rec('E06', 'energy', 'a measured zero is zero: 0 steps gives step energy 0 (not missing) when a snapshot exists',
    r = 'ok:1' and (s ->> 'steps')::int = 0 and (s ->> 'step_kcal')::int = 0 and s ->> 'energy_method' = 'bmr_plus_movement', r || ' ' || s::text);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f03');
  r := stests.attempt(stests.phone(0, '4000', 'null', format('%L::timestamptz', stests.day_start(0)), 'now()'));
  perform stests.reset();
  s := stests.summary('00000000-0000-0000-0000-000000000f03');
  perform stests.rec('E07', 'energy', 'without a BMR (sex input unspecified) no personalised budget is invented',
    r = 'ok:1' and s ->> 'energy_estimate_kcal' is null and s ->> 'energy_method' is null and s ->> 'confidence' is null, s::text);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(stests.phone(-1, '5000', 'null', format('%L::timestamptz', stests.day_start(-1)), format('%L::timestamptz', stests.day_start(0))));
  perform stests.reset();
  s := stests.summary('00000000-0000-0000-0000-000000000f01', -1);
  perform stests.rec('E09', 'energy', 'Android-style day (steps only): distance = 5000 x 0.726 m, labelled estimated, 127 kcal',
    (s ->> 'walk_distance_m')::int = 3630 and (s ->> 'walk_distance_estimated')::boolean and (s ->> 'step_kcal')::int = 127, s::text);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.activity_daily_totals (local_date, source, time_zone, steps, distance_m, active_energy_kcal)
                               values (%L, 'apple_health', 'Africa/Casablanca', 8100, 6100, 400)$f$, stests.d(0)));
  perform stests.reset();
  s := stests.summary('00000000-0000-0000-0000-000000000f01');
  perform stests.rec('E10', 'energy', 'a connected health platform takes precedence: BMR + its active energy, workouts not added again',
    r = 'ok:1' and s ->> 'energy_method' = 'bmr_plus_active' and (s ->> 'counted_workout_kcal')::int = 0
    and (s ->> 'activity_kcal')::int = 400 and (s ->> 'energy_estimate_kcal')::int = 1649 + 400, s::text);
  delete from public.activity_daily_totals where user_id = '00000000-0000-0000-0000-000000000f01' and source = 'apple_health';

  s := stests.summary('00000000-0000-0000-0000-000000000f02', -5);
  perform stests.rec('E11', 'energy', 'a day without activity data has no step energy (not 0)',
    s ->> 'step_kcal' is null and s ->> 'activity_source' is null, s::text);
end $$;

-- ============================ Gym log ============================
do $$ declare r text; n text; sess uuid; begin
  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.scalar($f$select public.save_gym_log('44444444-0000-0000-0000-000000000004',
        '[{"name":"Développé couché","category":"upper_body","sets":[{"reps":10,"weight_kg":40,"rest_seconds":90},{"reps":8,"weight_kg":45,"rest_seconds":120}]},
          {"name":"Squat","category":"lower_body","sets":[{"reps":12,"weight_kg":null,"rest_seconds":null}]}]'::jsonb)$f$);
  perform stests.reset();
  perform stests.rec('G01', 'gym', 'save_gym_log stores the exercises and sets of the owner''s gym session',
    r = '2' and (select count(*) from public.workout_sets s join public.workout_exercises e on e.id = s.exercise_id
                  join public.workout_sessions w on w.id = e.session_id where w.client_session_id = '44444444-0000-0000-0000-000000000004') = 3, r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.scalar($f$select public.save_gym_log('44444444-0000-0000-0000-000000000004',
        '[{"name":"Squat","category":"lower_body","sets":[{"reps":12}]}]'::jsonb)$f$);
  perform stests.reset();
  perform stests.rec('G02', 'gym', 'a second save replaces the log (retries never duplicate)',
    r = '1' and (select count(*) from public.workout_exercises e join public.workout_sessions w on w.id = e.session_id
                  where w.client_session_id = '44444444-0000-0000-0000-000000000004') = 1, r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.scalar($f$select public.save_gym_log('44444444-0000-0000-0000-000000000004', '[]'::jsonb)$f$);
  perform stests.reset();
  perform stests.rec('G03', 'security', 'another customer''s gym session cannot be written through save_gym_log', r like 'err:42501%', r);

  select id into sess from public.workout_sessions where client_session_id = '44444444-0000-0000-0000-000000000004';
  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.workout_exercises (session_id, position, name, category) values (%L, 5, 'X', 'core')$f$, sess));
  n := stests.scalar('select count(*) from public.workout_exercises');
  perform stests.reset();
  perform stests.rec('G04', 'security', 'a direct insert into another customer''s session is refused; their rows are invisible',
    r like 'err:42501%' and n = '0', r || ' visible=' || n);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.workout_exercises (session_id, position, name, category)
                                select id, 0, 'Marche', 'cardio' from public.workout_sessions where client_session_id = '44444444-0000-0000-0000-000000000001'$f$));
  perform stests.reset();
  perform stests.rec('G05', 'gym', 'exercises can only be attached to a gym session', r like 'err:42501%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt('update public.workout_sets set reps = 99');
  perform stests.reset();
  perform stests.rec('G06', 'security', 'sets cannot be updated by clients (replace through save_gym_log)', r like 'err:42501%', r);

  perform stests.act('anon');
  r := stests.attempt('select * from public.workout_exercises');
  perform stests.reset();
  perform stests.rec('G07', 'security', 'anon cannot read the gym log', r like 'err:42501%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.scalar($f$select public.save_gym_log('44444444-0000-0000-0000-000000000004',
        '[{"name":"Squat","category":"lower_body","sets":[{"reps":500}]}]'::jsonb)$f$);
  perform stests.reset();
  perform stests.rec('G08', 'gym', 'impossible repetitions are refused and nothing is replaced',
    r like 'err:23514%' and (select count(*) from public.workout_exercises) = 1, r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.attempt($f$delete from public.workout_sessions where client_session_id = '44444444-0000-0000-0000-000000000004'$f$);
  perform stests.reset();
  perform stests.rec('G09', 'gym', 'deleting the session deletes its gym log', r = 'ok:1' and (select count(*) from public.workout_sets) = 0, r);
end $$;

-- ============================ Manual meals ============================
do $$ declare r text; e record; begin
  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, servings, meal_name, kcal_per_serving, protein_g)
                                values ('55555555-0000-0000-0000-000000000001', %L, 'Africa/Casablanca', 1.5, '  Tajine maison ', 450, 20)$f$, stests.d(0)));
  perform stests.reset();
  select * into e from public.nutrition_log_entries where client_request_id = '55555555-0000-0000-0000-000000000001';
  perform stests.rec('N01', 'meals', 'a manual meal: name trimmed, 1.5 portion of 450 kcal = 675 kcal, labelled manual',
    r = 'ok:1' and e.meal_name = 'Tajine maison' and e.kcal = 675 and e.protein_g = 30 and e.entry_source = 'manual', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, servings, meal_name, kcal_per_serving)
                                values ('55555555-0000-0000-0000-000000000001', %L, 'Africa/Casablanca', 1, 'Tajine maison', 450)$f$, stests.d(0)));
  perform stests.reset();
  perform stests.rec('N02', 'meals', 'a retried manual meal (same idempotency key) is not logged twice', r like 'err:23505%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, servings, meal_name, kcal_per_serving)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', 1, 'Pizza', 5000)$f$, stests.d(0)));
  perform stests.reset();
  perform stests.rec('N03', 'meals', 'implausible calories per portion are refused', r like 'err:22023:calories per portion%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, servings, kcal_per_serving)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', 1, 300)$f$, stests.d(0)));
  perform stests.reset();
  perform stests.rec('N04', 'meals', 'a manual meal needs a name', r like 'err:22023:a manual meal needs a name%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, meal_id, servings, meal_name, kcal_per_serving)
                                values ('55555555-0000-0000-0000-000000000002', %L, 'Africa/Casablanca', '00000000-0000-0000-0000-00000000aa01', 0.5, 'Fake', 1)$f$, stests.d(0)));
  perform stests.reset();
  select * into e from public.nutrition_log_entries where client_request_id = '55555555-0000-0000-0000-000000000002';
  perform stests.rec('N05', 'meals', 'a menu meal ignores client calories: half a 500 kcal bowl = 250, labelled menu',
    r = 'ok:1' and e.meal_name = 'Test bowl' and e.kcal = 250 and e.entry_source = 'menu', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := stests.attempt(format($f$insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, servings, meal_name, kcal_per_serving, entry_source)
                                values (gen_random_uuid(), %L, 'Africa/Casablanca', 1, 'Menu forgé', 100, 'menu')$f$, stests.d(0)));
  perform stests.reset();
  perform stests.rec('N06', 'security', 'the entry source cannot be chosen by the client', r like 'err:42501%', r);

  perform stests.act('authenticated', '00000000-0000-0000-0000-000000000f02');
  r := stests.scalar('select count(*) from public.nutrition_log_entries');
  perform stests.reset();
  perform stests.rec('N07', 'security', 'another customer''s meals are invisible', r = '0', r);
end $$;

do $$ declare s jsonb; begin
  s := stests.summary('00000000-0000-0000-0000-000000000f01');
  perform stests.rec('N08', 'meals', 'manual and menu meals count in the daily balance; remaining = budget - 925 (can go negative)',
    (s ->> 'consumed_kcal')::int = 925 and (s ->> 'remaining_kcal')::int = (s ->> 'energy_estimate_kcal')::int - 925, s::text);
end $$;
