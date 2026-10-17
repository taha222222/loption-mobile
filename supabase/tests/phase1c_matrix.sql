-- =====================================================================
-- Read-only policy / grant / function matrix. Safe on any database
-- (it only reads catalogs). Deterministic text output, used for the
-- BEFORE / AFTER / AFTER-ROLLBACK comparison in run_phase1c.sh and in
-- docs/v1/PHASE1C_POLICY_GRANT_MATRIX.md.
-- =====================================================================
\pset footer off
\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
\echo '## policies (public): table | name | command | roles | using | with check'
select tablename, policyname, cmd, array_to_string(roles, ','),
       coalesce(regexp_replace(qual, '\s+', ' ', 'g'), '-'),
       coalesce(regexp_replace(with_check, '\s+', ' ', 'g'), '-')
  from pg_policies where schemaname = 'public'
 order by tablename, policyname;

\echo '## table privileges (public): table | anon | authenticated   (s=select i=insert u=update d=delete t=truncate r=references g=trigger)'
select c.relname,
  coalesce(string_agg(case when has_table_privilege('anon', c.oid, p) then k end, '' order by k), '-'),
  coalesce(string_agg(case when has_table_privilege('authenticated', c.oid, p) then k end, '' order by k), '-')
  from pg_class c
  cross join (values ('SELECT','s'),('INSERT','i'),('UPDATE','u'),('DELETE','d'),
                     ('TRUNCATE','t'),('REFERENCES','r'),('TRIGGER','g')) v(p, k)
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
 group by c.relname order by c.relname;

\echo '## column UPDATE privilege for authenticated on sensitive columns'
select t || '.' || c, has_column_privilege('authenticated', 'public.' || t, c, 'UPDATE')
  from (values ('user_profiles','role'),('user_profiles','is_admin'),('user_profiles','user_id'),
               ('user_profiles','weight'),('drivers','status'),('drivers','commission_rate'),
               ('drivers','total_earned'),('drivers','current_latitude'),
               ('orders','total'),('orders','payment_method')) x(t, c)
 where to_regclass('public.' || t) is not null
 order by 1;

\echo '## functions (public): signature | security definer | config | anon exec | authenticated exec'
select p.oid::regprocedure::text, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '-'),
       has_function_privilege('anon', p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
  from pg_proc p where p.pronamespace = 'public'::regnamespace
 order by 1;

\echo '## triggers (public, non-internal)'
select c.relname, t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
 order by 1, 2;

\echo '## check constraints on drivers'
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.drivers'::regclass and contype = 'c' order by 1;

\echo '## default privileges (migration role postgres)'
select coalesce(defaclnamespace::regnamespace::text, '(global)'), defaclobjtype, defaclacl::text
  from pg_default_acl where defaclrole = 'postgres'::regrole
 order by 1, 2;

\echo '## policies (storage): table | name | command | roles | using | with check'
select tablename, policyname, cmd, array_to_string(roles, ','),
       coalesce(regexp_replace(qual, '\s+', ' ', 'g'), '-'),
       coalesce(regexp_replace(with_check, '\s+', ' ', 'g'), '-')
  from pg_policies where schemaname = 'storage'
 order by tablename, policyname;
