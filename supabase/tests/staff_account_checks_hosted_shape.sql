-- =====================================================================
-- Phase 1C, review 2026-10-26 L2: assign_staff_role checks the account.
-- DISPOSABLE DATABASE ONLY (run_phase1c.sh, scenario B), as supabase_admin,
-- after the core migration with the fixture admin a1.
--
-- The bare image's auth.users has only confirmed_at. Hosted Auth also has
-- email_confirmed_at, deleted_at, banned_until and is_anonymous. This file
-- adds those columns, creates one account per state, attempts the grants
-- as a1 and prints one row per case, all inside ONE transaction that is
-- rolled back at the end: nothing it does remains in the database.
-- Accounts (synthetic): 4a1 eligible, 4a2 e-mail unconfirmed, 4a3 deleted,
-- 4a4 banned, 4a5 ban expired, 4a6 anonymous.
-- =====================================================================
\set ON_ERROR_STOP 1
begin;
alter table auth.users
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists banned_until timestamptz,
  add column if not exists is_anonymous boolean not null default false;
insert into auth.users (id, confirmed_at, email_confirmed_at, deleted_at, banned_until, is_anonymous) values
  ('00000000-0000-0000-0000-0000000004a1', now(), now(), null, null, false),
  ('00000000-0000-0000-0000-0000000004a2', null,  null,  null, null, false),
  ('00000000-0000-0000-0000-0000000004a3', now(), now(), now(), null, false),
  ('00000000-0000-0000-0000-0000000004a4', now(), now(), null, now() + interval '1 day', false),
  ('00000000-0000-0000-0000-0000000004a5', now(), now(), null, now() - interval '1 day', false),
  ('00000000-0000-0000-0000-0000000004a6', now(), now(), null, null, true);

create temp table hs_results (id text primary key, expectation text, outcome text, passed boolean);

-- attempt(user, role): 'ok' or the error message; always back to supabase_admin
create function pg_temp.hs_attempt(p_user uuid, p_role text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.assign_staff_role(p_user, p_role);
    r := 'ok';
  exception when others then
    r := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('role', 'supabase_admin', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end
$f$;
-- nothing of a refused attempt may remain: no role row, no assign record
create function pg_temp.hs_nothing(p_user uuid) returns boolean language sql as $f$
  select not exists (select 1 from public.staff_roles where user_id = p_user)
     and not exists (select 1 from public.security_audit_log where action = 'staff_role.assign' and target_user_id = p_user)
$f$;

do $$
declare
  c record;
  r text;
begin
  for c in select * from (values
      ('H1', '00000000-0000-0000-0000-0000000004a1'::uuid, 'admin',   'ok',               'eligible account: admin granted'),
      ('H2', '00000000-0000-0000-0000-0000000004a2'::uuid, 'admin',   'not confirmed',    'unconfirmed e-mail: admin refused'),
      ('H3', '00000000-0000-0000-0000-0000000004a3'::uuid, 'admin',   'is deleted',       'deleted account: admin refused'),
      ('H4', '00000000-0000-0000-0000-0000000004a4'::uuid, 'admin',   'is banned',        'banned account: admin refused'),
      ('H5', '00000000-0000-0000-0000-0000000004a5'::uuid, 'admin',   'ok',               'expired ban: admin granted'),
      ('H6', '00000000-0000-0000-0000-0000000004a6'::uuid, 'admin',   'anonymous',        'anonymous account: admin refused'),
      ('H7', '00000000-0000-0000-0000-0000000004a3'::uuid, 'support', 'is deleted',       'deleted account: support refused'),
      ('H8', '00000000-0000-0000-0000-0000000004a6'::uuid, 'support', 'anonymous',        'anonymous account: support refused'),
      ('H9', '00000000-0000-0000-0000-0000000004a2'::uuid, 'support', 'ok',               'unconfirmed e-mail: support granted (confirmation is required for admin only)')
    ) v(id, uid, role, want, expectation)
  loop
    r := pg_temp.hs_attempt(c.uid, c.role);
    insert into hs_results values (c.id, c.expectation, r,
      case when c.want = 'ok' then r = 'ok'
                                   and exists (select 1 from public.staff_roles s where s.user_id = c.uid and s.role = c.role and s.is_active)
           else r like '22023 %' || c.want || '%' and (c.role <> 'admin' or pg_temp.hs_nothing(c.uid))
                and not exists (select 1 from public.staff_roles s where s.user_id = c.uid and s.role = c.role) end);
  end loop;

  -- fail closed: without any confirmation column the admin check cannot be
  -- established and the grant is refused. The columns are renamed in a
  -- subtransaction that is rolled back; only the outcome text survives it.
  begin
    alter table auth.users rename column confirmed_at to p1c_confirmed_at_hidden;
    alter table auth.users rename column email_confirmed_at to p1c_email_confirmed_at_hidden;
    r := pg_temp.hs_attempt('00000000-0000-0000-0000-0000000000c2'::uuid, 'admin');
    raise exception using errcode = 'P0099', message = 'undo the renames';
  exception when sqlstate 'P0099' then
    null;
  end;
  insert into hs_results values ('H10', 'no confirmation column in auth.users: admin refused (fail closed)', r,
    r like '22023 cannot verify%' and pg_temp.hs_nothing('00000000-0000-0000-0000-0000000000c2'));
end
$$;

\pset footer off
select id, case when passed then 'PASS' else 'FAIL' end as result, expectation, outcome from hs_results order by length(id), id;
rollback;
