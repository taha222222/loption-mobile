-- =====================================================================
-- V1 account deletion tests. DISPOSABLE DATABASE ONLY
-- (run_v1_account_deletion.sh). Runs after every V1 migration including
-- 20261104120000_v1_account_deletion.sql. Acts like PostgREST.
--
-- Fixture users (created by the runner): ...0f01 customer with data,
-- ...0f02 customer (must stay untouched), ...0f05 support staff,
-- ...00a1 initial admin.
-- =====================================================================
\set ON_ERROR_STOP 1
create schema if not exists dtests;
create table if not exists dtests.results (id text primary key, area text, expectation text, passed boolean, detail text);
truncate dtests.results;

create or replace function dtests.act(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('role', p_role, true);
end $$;
create or replace function dtests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function dtests.attempt(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;
create or replace function dtests.rec(p_id text, p_area text, p_exp text, p_ok boolean, p_detail text)
returns void language sql as $$
  insert into dtests.results values (p_id, p_area, p_exp, coalesce(p_ok, false), p_detail)
  on conflict (id) do update set passed = excluded.passed, detail = excluded.detail;
$$;
create or replace function dtests.counts(p_user uuid) returns text language sql as $$
  select concat_ws(':',
    (select count(*) from auth.users where id = p_user),
    (select count(*) from public.user_profiles where user_id = p_user),
    (select count(*) from public.activity_daily_totals where user_id = p_user),
    (select count(*) from public.workout_sessions where user_id = p_user),
    (select count(*) from public.workout_exercises where user_id = p_user),
    (select count(*) from public.nutrition_log_entries where user_id = p_user),
    (select count(*) from public.nutrition_daily_targets where user_id = p_user))
$$;
grant usage on schema dtests to anon, authenticated, service_role;
grant execute on all functions in schema dtests to anon, authenticated, service_role;

-- Data for ...0f01 (customer) and ...0f02 (another customer), written as
-- the app would.
do $$ declare u uuid; begin
  foreach u in array array['00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-000000000f02']::uuid[] loop
    perform dtests.act('authenticated', u);
    insert into public.activity_daily_totals (local_date, source, time_zone, steps, measured_from, measured_to)
    values ((now() at time zone 'Africa/Casablanca')::date, 'device_motion', 'Africa/Casablanca', 3000,
            ((now() at time zone 'Africa/Casablanca')::date)::timestamp at time zone 'Africa/Casablanca', now());
    insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, intensity)
    values ('app', gen_random_uuid(), 'gym', now() - interval '3 hours', now() - interval '150 minutes', 1800, 'Africa/Casablanca', 'light');
    insert into public.nutrition_log_entries (client_request_id, local_date, time_zone, servings, meal_name, kcal_per_serving)
    values (gen_random_uuid(), (now() at time zone 'Africa/Casablanca')::date, 'Africa/Casablanca', 1, 'Repas maison', 500);
    perform dtests.reset();
  end loop;
  insert into public.workout_exercises (user_id, session_id, position, name, category)
  select user_id, id, 0, 'Squat', 'lower_body' from public.workout_sessions where kind = 'gym';
  insert into public.orders (order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
  values ('DEL-1', 60, 60, 0, 'served', 'cash', '00000000-0000-0000-0000-000000000f01');
end $$;

do $$ declare r text; before text; begin
  before := dtests.counts('00000000-0000-0000-0000-000000000f01');

  perform dtests.act('anon');
  r := dtests.attempt($q$select public.delete_my_account('SUPPRIMER')$q$);
  perform dtests.reset();
  perform dtests.rec('D01', 'security', 'anon cannot call delete_my_account', r like 'err:42501%', r);

  perform dtests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := dtests.attempt($q$select public.delete_my_account('oui')$q$);
  perform dtests.reset();
  perform dtests.rec('D02', 'deletion', 'without the typed confirmation nothing is deleted',
    r like 'err:22023:confirmation required%' and dtests.counts('00000000-0000-0000-0000-000000000f01') = before, r || ' ' || before);

  perform dtests.act('authenticated', '00000000-0000-0000-0000-0000000000a1');
  r := dtests.attempt($q$select public.delete_my_account('SUPPRIMER')$q$);
  perform dtests.reset();
  perform dtests.rec('D03', 'deletion', 'the administrator account is refused (closed by support)',
    r like 'err:42501:staff, driver and partner accounts%' and (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000a1') = 1, r);

  perform dtests.act('authenticated', '00000000-0000-0000-0000-000000000f05');
  r := dtests.attempt($q$select public.delete_my_account('SUPPRIMER')$q$);
  perform dtests.reset();
  perform dtests.rec('D04', 'deletion', 'a staff account (support role) is refused',
    r like 'err:42501:staff, driver and partner accounts%', r);
end $$;

do $$ declare r text; other text; begin
  other := dtests.counts('00000000-0000-0000-0000-000000000f02');
  perform dtests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := dtests.attempt($q$select public.delete_my_account('SUPPRIMER')$q$);
  perform dtests.reset();
  perform dtests.rec('D05', 'deletion', 'a customer deletes the account: Auth user, profile, activity, workouts, gym log, meals and targets gone',
    r = 'ok' and dtests.counts('00000000-0000-0000-0000-000000000f01') = '0:0:0:0:0:0:0', r || ' ' || dtests.counts('00000000-0000-0000-0000-000000000f01'));
  perform dtests.rec('D06', 'deletion', 'orders are kept for accounting but detached from the account',
    (select user_id is null from public.orders where order_number = 'DEL-1'), null);
  perform dtests.rec('D07', 'deletion', 'the deletion is audited (account id and counts only)',
    exists (select 1 from public.security_audit_log where action = 'account.deleted'
             and target_user_id = '00000000-0000-0000-0000-000000000f01' and (details ->> 'orders_detached')::int = 1), null);
  perform dtests.rec('D08', 'security', 'another customer''s data is untouched',
    dtests.counts('00000000-0000-0000-0000-000000000f02') = other and other like '1:1:1:1:1:1:%', other);

  perform dtests.act('authenticated', '00000000-0000-0000-0000-000000000f01');
  r := dtests.attempt($q$select public.delete_my_account('SUPPRIMER')$q$);
  perform dtests.reset();
  perform dtests.rec('D09', 'deletion', 'a second call with the old token finds no account and changes nothing', r like 'err:22023:account not found%', r);

  perform dtests.rec('D10', 'security', 'SECURITY DEFINER with a fixed search_path, executable by authenticated only',
    (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.delete_my_account(text)'::regprocedure)
    and not has_function_privilege('anon', 'public.delete_my_account(text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.delete_my_account(text)', 'EXECUTE'), null);
end $$;
