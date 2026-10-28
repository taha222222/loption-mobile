-- =====================================================================
-- TEST-ONLY BOOTSTRAP for the disposable supabase/postgres image.
-- Never run against staging or production.
--
-- The bare supabase/postgres image ships an older auth.uid()/auth.role()
-- that read only `request.jwt.claim.*`, and no auth.jwt(). On a hosted
-- project the Auth service (GoTrue) migrations replace them with the
-- definitions below, which read the `request.jwt.claims` JSON that
-- PostgREST sets. The staging policies call auth.uid(), auth.role() and
-- auth.jwt(), so the tests need the hosted behaviour.
-- Run as supabase_admin (owner of the auth schema in the image).
-- =====================================================================
\set ON_ERROR_STOP 1

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role, postgres;
grant usage on schema auth to anon, authenticated, service_role, postgres;
-- The baseline creates foreign keys to auth.users as the migration role.
grant references, select on auth.users to postgres;
