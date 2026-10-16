-- L'OPTION Phase 1B — read-only security evidence query.
-- Run in Supabase Dashboard → SQL Editor. It only reads system catalogs:
-- no data rows from your tables, no changes. Output: one JSON cell.
-- Before sharing the result, search it for hard-coded secrets in function
-- definitions (e.g. 'eyJ', 'sk_', 'service_role', 'Bearer').
with
pub_tables as (
  select c.oid, n.nspname as schema, c.relname as name, c.relkind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'v', 'm')
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'server_version', current_setting('server_version'),

  'tables', (select jsonb_agg(jsonb_build_object(
      'schema', t.schema, 'table', t.name, 'kind', t.relkind,
      'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity)
      order by t.schema, t.name)
    from pub_tables t join pg_class c on c.oid = t.oid),

  'effective_table_privileges', (select jsonb_agg(jsonb_build_object(
      'schema', t.schema, 'table', t.name, 'role', r.role,
      'select', has_table_privilege(r.role, t.oid, 'SELECT'),
      'insert', has_table_privilege(r.role, t.oid, 'INSERT'),
      'update', has_table_privilege(r.role, t.oid, 'UPDATE'),
      'delete', has_table_privilege(r.role, t.oid, 'DELETE'))
      order by t.schema, t.name, r.role)
    from pub_tables t cross join (values ('anon'), ('authenticated')) r(role)
    where t.relkind in ('r', 'p', 'v', 'm')),

  'column_level_acls', (select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'column', a.attname, 'acl', a.attacl::text)
      order by c.relname, a.attname)
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and a.attacl is not null and a.attnum > 0),

  'columns', (select jsonb_agg(jsonb_build_object(
      'table', table_name, 'pos', ordinal_position, 'column', column_name,
      'type', data_type, 'udt', udt_name, 'nullable', is_nullable, 'default', column_default)
      order by table_name, ordinal_position)
    from information_schema.columns where table_schema = 'public'),

  'constraints', (select jsonb_agg(jsonb_build_object(
      'table', conrelid::regclass::text, 'name', conname, 'type', contype,
      'definition', pg_get_constraintdef(oid))
      order by conrelid::regclass::text, conname)
    from pg_constraint where connamespace = 'public'::regnamespace),

  'indexes', (select jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', indexname, 'definition', indexdef)
      order by tablename, indexname)
    from pg_indexes where schemaname = 'public'),

  'policies', (select jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname, 'permissive', permissive,
      'roles', roles, 'command', cmd, 'using', qual, 'with_check', with_check)
      order by schemaname, tablename, policyname)
    from pg_policies where schemaname in ('public', 'storage')),

  'functions', (select jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef, 'config', p.proconfig,
      'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'definition', pg_get_functiondef(p.oid))
      order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p')
      and (n.nspname = 'public'
           -- plus any function used by a trigger on public/auth/storage tables
           or p.oid in (select t.tgfoid from pg_trigger t join pg_class c on c.oid = t.tgrelid
                        join pg_namespace tn on tn.oid = c.relnamespace
                        where not t.tgisinternal and tn.nspname in ('public', 'auth', 'storage')))),

  'triggers', (select jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'table', c.relname, 'name', t.tgname, 'enabled', t.tgenabled,
      'definition', pg_get_triggerdef(t.oid))
      order by n.nspname, c.relname, t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')),

  'enums', (select jsonb_agg(jsonb_build_object('schema', x.nspname, 'type', x.typname, 'labels', x.labels))
    from (select n.nspname, t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public' group by 1, 2) x),

  'views', (select jsonb_agg(jsonb_build_object(
      'view', c.relname, 'options', c.reloptions, 'definition', pg_get_viewdef(c.oid)))
    from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace),

  'realtime_publication', (select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename))
    from pg_publication_tables where pubname = 'supabase_realtime'),

  'storage_buckets', (select jsonb_agg(to_jsonb(b) - 'owner' - 'owner_id') from storage.buckets b),

  'default_privileges', (select jsonb_agg(jsonb_build_object(
      'role', defaclrole::regrole::text, 'schema', defaclnamespace::regnamespace::text,
      'object_type', defaclobjtype, 'acl', defaclacl::text))
    from pg_default_acl),

  'roles', (select jsonb_agg(jsonb_build_object(
      'role', rolname, 'superuser', rolsuper, 'bypass_rls', rolbypassrls))
    from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'authenticator')),

  'extensions', (select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion))
    from pg_extension)
)) as evidence;
