-- Read-only snapshot used for the before/after matrix. Safe on any database.
\pset footer off
\echo '--- policies (table · name · command · roles)'
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public'
   and tablename in ('orders','order_items','user_profiles','drivers','daily_closings',
                     'order_status_updates','meals','staff_roles')
 order by tablename, policyname;
\echo '--- client table privileges (anon / authenticated)'
select c.relname as table,
  string_agg(distinct case when has_table_privilege('anon', c.oid, p) then 'anon:' || lower(left(p, 3)) end, ' ') as anon,
  string_agg(distinct case when has_table_privilege('authenticated', c.oid, p) then 'auth:' || lower(left(p, 3)) end, ' ') as authenticated
from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) v(p)
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relname in ('orders','order_items','user_profiles','drivers','daily_closings','order_status_updates','meals','staff_roles')
group by c.relname order by c.relname;
\echo '--- column-level UPDATE on privileged columns'
select 'user_profiles.' || a as col,
       has_column_privilege('authenticated', 'public.user_profiles', a, 'UPDATE') as authenticated_can_update
  from unnest(array['role','is_admin','user_id','weight']) a
union all
select 'drivers.' || a, has_column_privilege('authenticated', 'public.drivers', a, 'UPDATE')
  from unnest(array['commission_rate','total_earned','status','current_latitude']) a;
\echo '--- function execute'
select p.proname, p.prosecdef as security_definer, coalesce(array_to_string(p.proconfig, ','), '(none)') as config,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p where p.pronamespace = 'public'::regnamespace
 order by p.proname;
