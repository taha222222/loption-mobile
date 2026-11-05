-- =====================================================================
-- L'OPTION V1 — trusted order creation: public.create_order().
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on 20261105120000_v1_order_workflow.sql (not modified here).
-- Rollback: supabase/rollback/v1_create_order_rollback.sql (archiving).
--
-- The customer sends WHAT they order (meal ids, quantities, notes), the
-- kitchen and a request id. The server decides everything else:
--   * prices are read from public.meals (snapshot on each order line);
--     inactive meals cannot be ordered; a price sent by the client is never
--     read;
--   * delivery fee, service fee and minimum order come from the owner-approved
--     public.pricing_policies row of the kitchen. NO row exists until the
--     owner approves pricing (checklist H1-H3): until then create_order()
--     refuses and creates nothing. No fee value is defined in this file;
--   * TVA: the only supported treatment is "menu prices include TVA"; the
--     policy must state it explicitly (no rate is computed here);
--   * the delivery address is the customer's server-validated confirmed
--     address (user_profiles), copied onto the order;
--   * cash on delivery only; the order starts as workflow order 'pending'
--     with payment 'pending' and then follows public.order_transitions();
--   * the first-order free delivery is applied by the existing
--     apply_first_order_offer() inside the same transaction;
--   * the same client_request_id returns the same order (retries, double
--     taps; serialized by an advisory lock);
--   * timeline row 'pending' and audit row 'order_created' (no duplicate on
--     retry).
-- Staff accounts (any active staff role) cannot place orders.
-- Order notifications are not part of this migration (DECISIONS #32).
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 create_order: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_create_gate_ok (step text primary key) on commit drop;
create temp table v1_create_gate (
  step text constraint v1_create_order_guard_did_not_pass references v1_create_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_create_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
begin
  if to_regprocedure('public.order_transitions()') is null then
    raise exception 'V1 create_order: the V1 order workflow migration must be applied first; aborting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure)
     <> 'be70f09b095844cf186059ed347cae04' then
    raise exception 'V1 create_order: containment_violations() is not the reviewed monitor of the order workflow migration; refusing to extend it';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 create_order: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  if to_regprocedure('public.create_order(uuid,jsonb,uuid,text)') is not null
     or to_regclass('public.pricing_policies') is not null
     or to_regclass('public.order_number_seq') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'client_request_id') then
    raise exception 'V1 create_order: already applied (re-run or unknown objects), refusing';
  end if;
  if to_regprocedure('public.apply_first_order_offer(uuid)') is null then
    raise exception 'V1 create_order: apply_first_order_offer() is missing; the onboarding/offer migration must be applied';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 create_order: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_create_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. Owner-approved pricing (empty until approval)
-- ---------------------------------------------------------------------
create table public.pricing_policies (
  id                 uuid primary key default gen_random_uuid(),
  kitchen_id         uuid not null references public.kitchens(id),
  delivery_fee       numeric(8,2) not null check (delivery_fee >= 0 and delivery_fee <= 500),
  service_fee        numeric(8,2) not null check (service_fee >= 0 and service_fee <= 500),
  minimum_subtotal   numeric(8,2) not null check (minimum_subtotal >= 0 and minimum_subtotal <= 5000),
  tva_treatment      text not null check (tva_treatment = 'included_in_menu_prices'),
  approved_by        text not null check (char_length(btrim(approved_by)) between 2 and 120),
  approval_reference text not null check (char_length(btrim(approval_reference)) between 3 and 300),
  approved_at        timestamptz not null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create unique index pricing_policies_one_active on public.pricing_policies (kitchen_id) where active;
alter table public.pricing_policies enable row level security;
revoke all on public.pricing_policies from public, anon, authenticated, service_role;
grant select on public.pricing_policies to authenticated;   -- the active rows, to show the fees before ordering
create policy pricing_policies_read_active on public.pricing_policies
  for select to authenticated using (active);

-- A policy is never edited or deleted: a change is a new row (the old one is
-- deactivated). Every insert and deactivation is audited.
create function public.pricing_policies_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pricing policies are never deleted; deactivate the row instead' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') or (old.active = false and new.active = true) then
      raise exception 'a pricing policy is never edited: insert a new approved row and deactivate this one' using errcode = '42501';
    end if;
  end if;
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), case when tg_op = 'INSERT' then 'pricing_policy_approved' else 'pricing_policy_deactivated' end, null,
          jsonb_build_object('policy_id', new.id, 'kitchen_id', new.kitchen_id, 'delivery_fee', new.delivery_fee,
                             'service_fee', new.service_fee, 'minimum_subtotal', new.minimum_subtotal,
                             'approved_by', new.approved_by, 'approval_reference', new.approval_reference));
  return new;
end;
$$;
revoke all on function public.pricing_policies_guard() from public, anon, authenticated, service_role;
create trigger trg_pricing_policies_guard
  before insert or update or delete on public.pricing_policies
  for each row execute function public.pricing_policies_guard();
create trigger trg_pricing_policies_no_truncate
  before truncate on public.pricing_policies
  for each statement execute function public.pricing_policies_guard();

-- ---------------------------------------------------------------------
-- 2. Orders: idempotency key and server order numbers
-- ---------------------------------------------------------------------
alter table public.orders add column client_request_id uuid;
create unique index orders_client_request_once on public.orders (user_id, client_request_id) where client_request_id is not null;
create sequence public.order_number_seq;
revoke all on sequence public.order_number_seq from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. create_order
-- ---------------------------------------------------------------------
-- p_items: [{"meal_id": uuid, "quantity": 1..20, "notes": text <= 200}], 1..30 lines,
-- each meal at most once. Returns the order id (the same id for a repeated request).
create function public.create_order(p_kitchen uuid, p_items jsonb, p_client_request_id uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing uuid;
  pol public.pricing_policies%rowtype;
  addr text;
  line jsonb;
  m record;
  qty integer;
  sub numeric := 0;
  n_lines integer;
  oid uuid := gen_random_uuid();
  onum text;
  discount numeric;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  -- One request at a time per customer and request id: a retry waits, then
  -- finds the order the first call created.
  perform pg_advisory_xact_lock(hashtextextended('v1.create_order:' || uid::text || ':' || p_client_request_id::text, 0));
  select o.id into existing from public.orders o where o.user_id = uid and o.client_request_id = p_client_request_id;
  if found then
    return existing;
  end if;

  if exists (select 1 from public.staff_roles s where s.user_id = uid and s.is_active) then
    raise exception 'staff accounts cannot place customer orders' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kitchens k where k.id = p_kitchen and k.is_active) then
    raise exception 'unknown or inactive kitchen' using errcode = '22023';
  end if;
  select * into pol from public.pricing_policies p where p.kitchen_id = p_kitchen and p.active;
  if not found then
    raise exception 'ordering is not open: pricing is not approved for this kitchen' using errcode = '55000';
  end if;
  select nullif(btrim(p.delivery_address), '') into addr from public.user_profiles p where p.user_id = uid;
  if addr is null then
    raise exception 'a confirmed delivery address is required' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a list' using errcode = '22023';
  end if;
  n_lines := jsonb_array_length(p_items);
  if n_lines < 1 or n_lines > 30 then
    raise exception 'an order has 1 to 30 lines' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'meal_id') from jsonb_array_elements(p_items) x) <> n_lines then
    raise exception 'each meal appears once per order (use the quantity)' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'the order note is too long' using errcode = '22023';
  end if;

  perform set_config('loption.order_service', 'on', true);
  onum := 'LO-' || to_char(now() at time zone 'Africa/Casablanca', 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 5, '0');
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method,
                             user_id, client_request_id, delivery_address, subtotal, delivery_fee, platform_service_fee,
                             total, status_changed_at, created_at, updated_at)
  values (oid, onum, 'pending', 1, p_kitchen, 'pending', 'cash',
          uid, p_client_request_id, addr, 0, pol.delivery_fee, pol.service_fee, 0, now(), now(), now());

  for line in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(line) <> 'object' or (line ->> 'meal_id') is null
       or (line ->> 'meal_id') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'invalid order line' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(line -> 'quantity'), '') <> 'number' or coalesce(line ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;
    qty := (line ->> 'quantity')::integer;
    if qty < 1 or qty > 20 then
      raise exception 'a quantity is 1 to 20' using errcode = '22023';
    end if;
    if (line -> 'notes') is not null and (jsonb_typeof(line -> 'notes') not in ('string', 'null') or char_length(line ->> 'notes') > 200) then
      raise exception 'a line note is too long' using errcode = '22023';
    end if;
    select me.id, me.name, me.price into m from public.meals me
     where me.id = (line ->> 'meal_id')::uuid and coalesce(me.available, false);
    if not found or m.price is null or m.price < 0 then
      raise exception 'meal % is not available', line ->> 'meal_id' using errcode = '22023';
    end if;
    insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes)
    values (oid, m.id, m.name, qty, m.price, nullif(btrim(line ->> 'notes'), ''));
    sub := sub + m.price * qty;
  end loop;

  if sub < pol.minimum_subtotal then
    raise exception 'the minimum order is % MAD', pol.minimum_subtotal using errcode = '22023';
  end if;
  update public.orders
     set subtotal = sub, total = sub + pol.delivery_fee + pol.service_fee
   where id = oid;

  -- First-order free delivery (existing, idempotent, per account).
  discount := public.apply_first_order_offer(oid);

  insert into public.order_status_updates (order_id, status, message) values (oid, 'pending', null);
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (uid, 'order_created', uid,
          jsonb_build_object('order_id', oid, 'kitchen_id', p_kitchen, 'lines', n_lines, 'subtotal', sub,
                             'delivery_fee', pol.delivery_fee, 'service_fee', pol.service_fee,
                             'delivery_discount', discount, 'pricing_policy_id', pol.id));
  perform set_config('loption.order_service', 'off', true);
  return oid;
end;
$$;
revoke all on function public.create_order(uuid, jsonb, uuid, text) from public, anon, service_role;
grant execute on function public.create_order(uuid, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Phase 1C monitor: reviewed policies and client definer functions
--    extended with this migration's. GENERATED by
--    supabase/tools/generate_nutrition_monitor.py; do not edit by hand.
-- ---------------------------------------------------------------------
-- BEGIN GENERATED MONITOR
create or replace function public.containment_violations()
returns table (category text, object text, problem text)
language plpgsql stable set search_path = ''
as $cv$
declare
  -- Supabase platform roles (image) + documented hosted-only roles.
  -- cli_login_postgres is created by the Supabase CLI itself (link/db push).
  allowed_roles text[] := array[
    'anon','authenticated','authenticator','dashboard_user','pgbouncer','postgres',
    'service_role','supabase_admin','supabase_auth_admin','supabase_etl_admin',
    'supabase_privileged_role','supabase_read_only_user','supabase_replication_admin',
    'supabase_storage_admin','supabase_functions_admin','supabase_realtime_admin',
    'cli_login_postgres','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker'];
  allowed_superusers text[] := array['supabase_admin'];
  allowed_bypassrls  text[] := array['postgres','service_role','supabase_admin',
    'supabase_etl_admin','supabase_read_only_user'];
  -- (group, member) pairs observed in the image, plus the CLI login role.
  allowed_members text[] := array[
    'anon<-authenticator','anon<-postgres','authenticated<-authenticator',
    'authenticated<-postgres','authenticator<-postgres','authenticator<-supabase_storage_admin',
    'service_role<-authenticator','service_role<-postgres',
    'supabase_privileged_role<-postgres','supabase_privileged_role<-supabase_etl_admin',
    'postgres<-cli_login_postgres'];
  privileged_groups text[] := array['anon','authenticated','service_role','authenticator',
    'postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin',
    'supabase_privileged_role','supabase_functions_admin','supabase_realtime_admin'];
  -- Event-trigger functions shipped by Supabase, plus the staging RLS
  -- auto-enable helper (it only runs ALTER TABLE ... ENABLE ROW LEVEL SECURITY).
  allowed_evt_functions text[] := array[
    'extensions.grant_pg_cron_access()','extensions.grant_pg_graphql_access()',
    'extensions.grant_pg_net_access()','extensions.set_graphql_placeholder()',
    'extensions.pgrst_ddl_watch()','extensions.pgrst_drop_watch()','public.rls_auto_enable()'];
  -- Schemas that hold Supabase platform objects (their grants are the
  -- platform's). Any OTHER schema a client role can use, and every view,
  -- materialized view or foreign table in the API schemas, is reported.
  platform_schemas text[] := array['auth','storage','extensions','graphql','realtime','vault',
    'pgsodium','pgsodium_masks','net','cron','supabase_functions','supabase_migrations',
    'pgbouncer','information_schema'];
  api_schemas text[] := array['public','graphql_public'];
  -- REVIEWED POLICY DEFINITIONS. Every policy in schema public (and, for
  -- the storage category, in schema storage) must match one entry exactly:
  --   table|name|PERMISSIVE or RESTRICTIVE|roles|command|USING|WITH CHECK
  -- (expressions as PostgreSQL 17 prints them in pg_policies, whitespace
  -- collapsed; '-' = none). A changed expression, command, role list or
  -- mode is reported even when the policy name is unchanged. Extend only
  -- through a reviewed commit.
  reviewed_public_policies text[] := array[
    'collaborator_analytics|staff_admin_all_collaborator_analytics|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborator_orders|collaborators_view_own_orders|PERMISSIVE|{public}|SELECT|(collaborator_id IN ( SELECT collaborators.id FROM public.collaborators WHERE (collaborators.user_id = auth.uid())))|-',
    'collaborator_orders|staff_admin_all_collaborator_orders|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborator_payouts|staff_admin_all_collaborator_payouts|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'collaborators|collaborators_view_own|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'collaborators|staff_admin_all_collaborators|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'driver_push_tokens|Drivers can insert own push tokens|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'driver_push_tokens|Drivers can view own push tokens|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'drivers|Users can view own driver record|PERMISSIVE|{public}|SELECT|(auth.uid() = id)|-',
    'drivers|drivers_self_update_profile_location|PERMISSIVE|{authenticated}|UPDATE|(id = ( SELECT auth.uid() AS uid))|(id = ( SELECT auth.uid() AS uid))',
    'drivers|staff_admin_all_drivers|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'kitchens|kitchens_read_authenticated|PERMISSIVE|{authenticated}|SELECT|true|-',
    'meals|Anyone can view meals|PERMISSIVE|{public}|SELECT|true|-',
    'meals|Enable read access for all users|PERMISSIVE|{public}|SELECT|true|-',
    'meals|staff_admin_write_meals|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'order_items|Service role full access order_items|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'order_items|Users can view their own order items|PERMISSIVE|{public}|SELECT|(EXISTS ( SELECT 1 FROM public.orders WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid()))))|-',
    'order_items|staff_admin_all_order_items|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'order_status_updates|order_owner_read_status|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE ((o.id = order_status_updates.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)))))|-',
    'order_status_updates|staff_admin_read_status|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'orders|drivers_read_assigned_orders|PERMISSIVE|{authenticated}|SELECT|((driver_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.has_staff_role(''driver''::text) AS has_staff_role))|-',
    'orders|Service role full access|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'orders|Users can view their own orders|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'orders|staff_admin_all_orders|PERMISSIVE|{authenticated}|ALL|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)',
    'security_audit_log|security_audit_log_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'staff_roles|staff_roles_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'staff_roles|staff_roles_self_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'user_profiles|Service role has full access|PERMISSIVE|{public}|ALL|(auth.role() = ''service_role''::text)|-',
    'user_profiles|Users can insert their own profile|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'user_profiles|Users can update their own profile|PERMISSIVE|{public}|UPDATE|(auth.uid() = user_id)|-',
    'user_profiles|Users can view their own profile|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'user_push_tokens|Users can insert own push tokens|PERMISSIVE|{public}|INSERT|-|(auth.uid() = user_id)',
    'user_push_tokens|Users can view own push tokens|PERMISSIVE|{public}|SELECT|(auth.uid() = user_id)|-',
    'notification_preferences|notification_prefs_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'notification_preferences|notification_prefs_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'notification_preferences|notification_prefs_owner_update|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))',
    'nutrition_daily_targets|nutrition_targets_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'nutrition_log_entries|nutrition_entries_owner_delete_mark|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))',
    'nutrition_log_entries|nutrition_entries_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'nutrition_log_entries|nutrition_entries_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'activity_daily_totals|activity_days_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'activity_daily_totals|activity_days_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'activity_daily_totals|activity_days_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'activity_daily_totals|activity_days_owner_update|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_sessions|workouts_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_sessions|workouts_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_sessions|workouts_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_exercises|gym_exercises_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_exercises|gym_exercises_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_exercises|gym_exercises_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_sets|gym_sets_owner_delete|PERMISSIVE|{authenticated}|DELETE|(user_id = ( SELECT auth.uid() AS uid))|-',
    'workout_sets|gym_sets_owner_insert|PERMISSIVE|{authenticated}|INSERT|-|(user_id = ( SELECT auth.uid() AS uid))',
    'workout_sets|gym_sets_owner_read|PERMISSIVE|{authenticated}|SELECT|(user_id = ( SELECT auth.uid() AS uid))|-',
    'driver_location_points|driver_locations_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-',
    'order_items|order_items_read_with_order|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE (o.id = order_items.order_id)))|-',
    'order_status_updates|order_status_read_with_order|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE (o.id = order_status_updates.order_id)))|-',
    'orders|orders_cashier_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''cashier''::text, kitchen_id))|-',
    'orders|orders_kitchen_staff_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''kitchen_staff''::text, kitchen_id))|-',
    'pricing_policies|pricing_policies_read_active|PERMISSIVE|{authenticated}|SELECT|active|-'];
  reviewed_storage_policies text[] := array[
    'objects|staff_admin_delete_meal_images|PERMISSIVE|{authenticated}|DELETE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_insert_meal_images|PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))',
    'objects|staff_admin_select_meal_images|PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_update_meal_images|PERMISSIVE|{authenticated}|UPDATE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))'];
  -- SECURITY DEFINER functions a client role may execute (authenticated only).
  client_definer_functions text[] := array[
    'public.has_staff_role(text)','public.assign_staff_role(uuid,text,uuid)',
    'public.revoke_staff_role(uuid,text,uuid)','public.set_driver_availability(boolean)',
    'public.register_push_token(text,text)','public.deactivate_push_token(text)','public.delete_my_account(text)','public.order_confirm(uuid)','public.order_kitchen_update(uuid,text)','public.order_assign_driver(uuid,uuid)','public.order_driver_update(uuid,text)','public.order_cancel(uuid,text)','public.order_set_payment(uuid,text)','public.driver_report_location(uuid,doubleprecision,doubleprecision,real,timestampwithtimezone)','public.create_order(uuid,jsonb,uuid,text)'];
  -- Functions created by the Phase 1C migrations, fingerprinted as
  --   signature|security definer|configuration|md5(body)
  -- so a CREATE OR REPLACE that weakens one is reported.
  reviewed_functions text[] := array[
    'public.assign_staff_role(uuid,text,uuid)|true|search_path=""|554f8a3f6bba9e6a3bc9c4ced7938cca',
    'public.enforce_driver_availability()|true|search_path=""|da0e53b932e051e9a371cb9fb2e64ce0',
    'public.enforce_profile_privilege_guard()|false|search_path=""|777cbb1b279b251dbb5380675638c1eb',
    'public.has_staff_role(text)|true|search_path=""|f44b74472038a40e54a5875a1ad1a835',
    'public.revoke_staff_role(uuid,text,uuid)|true|search_path=""|33bdc8cefd5a08a7c32c5ad9a2883b7f',
    'public.security_audit_log_append_only()|false|search_path=""|9283a0cd3cd689131cb43161db1f0c1e',
    'public.set_driver_availability(boolean)|true|search_path=""|387497cf2e12e33c2a3e528dfec585b7',
    'public.staff_roles_driver_offline()|true|search_path=""|6c92d893f56587ae443a911badcfd922',
    'public.staff_roles_no_truncate()|false|search_path=""|5b001f4e82a1558a7fb36fb7f42d64e5',
    'public.staff_roles_require_admin()|true|search_path=""|44a2aecd08c07582112b0e65beb07aa5',
    'public.staff_roles_serialize()|false|search_path=""|cf5ff3a87980a74d971b17c7fa89a16a'];
begin
  -- ============================ drift (U3) ============================
  return query select 'drift'::text, r.rolname::text, 'unexpected database role'::text
    from pg_roles r where r.rolname !~ '^pg_' and r.rolname <> all (allowed_roles);
  return query select 'drift', r.rolname::text, 'unexpected SUPERUSER role'
    from pg_roles r where r.rolsuper and r.rolname <> all (allowed_superusers);
  return query select 'drift', r.rolname::text, 'unexpected BYPASSRLS role'
    from pg_roles r where r.rolbypassrls and r.rolname <> all (allowed_bypassrls);
  return query select 'drift', r.rolname::text, 'client role has elevated attributes (superuser/bypassrls/createrole/createdb/login)'
    from pg_roles r where r.rolname in ('anon','authenticated')
     and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolcanlogin);
  return query select 'drift', g.rolname || '<-' || m.rolname, 'unexpected membership in a privileged or client role'
    from pg_auth_members a join pg_roles g on g.oid = a.roleid join pg_roles m on m.oid = a.member
   where (g.rolname = any (privileged_groups) or m.rolname in ('anon','authenticated','service_role'))
     and (g.rolname || '<-' || m.rolname) <> all (allowed_members);
  -- ============================ drift (U4) ============================
  -- schema-qualified name built explicitly (independent of search_path)
  return query select 'drift', e.evtname::text, 'unexpected event trigger function ' || f.fn
    from pg_event_trigger e
    cross join lateral (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = e.evtfoid) as f(fn)
   where f.fn <> all (allowed_evt_functions);
  -- ============================ drift (U5) ============================
  return query select 'drift', 'authenticator', 'authenticator must be NOSUPERUSER, NOBYPASSRLS, NOINHERIT'
    from pg_roles r where r.rolname = 'authenticator' and (r.rolsuper or r.rolbypassrls or r.rolinherit);
  return query select 'drift', 'authenticator', 'authenticator role missing'
   where not exists (select 1 from pg_roles where rolname = 'authenticator');
  -- ============================ drift (U6) ============================
  return query select 'drift', 'schema ' || n.nspname || ' / ' || x.grantee, 'client or PUBLIC can CREATE in schema'
    from pg_namespace n
    cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
                          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                         where a.privilege_type = 'CREATE') x
   where n.nspname in ('public','extensions','graphql_public','auth','storage','realtime','vault')
     and x.grantee in ('PUBLIC','anon','authenticated','authenticator');
  -- Auth hooks: a custom access-token hook could rewrite the JWT role
  -- claim (e.g. to service_role). Hooks are functions the Auth service
  -- (supabase_auth_admin) executes. Reported: (1) any non-auth function
  -- explicitly granted to supabase_auth_admin; (2) any non-auth function
  -- with the hook signature (one jsonb argument, returns jsonb) that
  -- supabase_auth_admin can EFFECTIVELY execute (incl. through PUBLIC).
  -- The hosted Auth hook configuration itself is not visible in SQL.
  if to_regrole('supabase_auth_admin') is not null then
    return query select 'drift', p.oid::regprocedure::text, 'function explicitly executable by supabase_auth_admin (possible Auth hook)'
      from pg_proc p cross join lateral aclexplode(p.proacl) a
     where p.proacl is not null and a.privilege_type = 'EXECUTE'
       and a.grantee = 'supabase_auth_admin'::regrole
       and p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema');
    return query select 'drift', p.oid::regprocedure::text, 'hook-shaped function (jsonb -> jsonb) effectively executable by supabase_auth_admin (possible Auth hook)'
      from pg_proc p
     where p.pronamespace::regnamespace::text not in ('auth','pg_catalog','information_schema')
       and p.pronargs = 1 and p.proargtypes[0] = 'jsonb'::regtype and p.prorettype = 'jsonb'::regtype
       and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
       and not exists (select 1 from aclexplode(coalesce(p.proacl, '{}')) a
                        where a.privilege_type = 'EXECUTE' and a.grantee = 'supabase_auth_admin'::regrole);
  end if;
  -- API-schema relations: owner, RLS, unexpected grantees
  return query select 'drift', n.nspname || '.' || c.relname, 'relation not owned by postgres (owner ' || c.relowner::regrole::text || ')'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
     and c.relowner <> 'postgres'::regrole;
  return query select 'drift', 'public.' || c.relname, 'row level security disabled'
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
     and not c.relrowsecurity;
  return query select distinct 'drift', 'public.' || c.relname || ' / ' || a.grantee::regrole::text, 'unexpected table grantee'
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and c.relacl is not null
     and a.grantee <> 0
     and a.grantee::regrole::text not in ('postgres','anon','authenticated','service_role');
  return query select distinct 'drift', 'public.' || c.relname || ' / PUBLIC', 'table privilege granted to PUBLIC'
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and c.relacl is not null
     and a.grantee = 0;

  -- ========================= containment =========================
  -- Policies: exact reviewed definitions (command, roles, mode, USING,
  -- WITH CHECK), not names.
  return query select 'containment', 'public.' || p.tablename || '.' || p.policyname,
                      'policy not reviewed, or its command/roles/mode/USING/WITH CHECK differ from the reviewed definition'
    from pg_policies p
   where p.schemaname = 'public'
     and (p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::text || '|' || p.cmd || '|'
          || coalesce(regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|'
          || coalesce(regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')) <> all (reviewed_public_policies);
  return query select 'containment', 'public.' || split_part(r, '|', 1) || '.' || split_part(r, '|', 2), 'reviewed policy missing'
    from unnest(reviewed_public_policies) r
   where not exists (select 1 from pg_policies p where p.schemaname = 'public'
                        and p.tablename = split_part(r, '|', 1) and p.policyname = split_part(r, '|', 2));
  return query select 'containment', 'public.' || c.relname || ' / anon ' || v.p, 'anon privilege other than SELECT on meals'
    from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('anon', c.oid, v.p)
     and not (c.relname = 'meals' and v.p = 'SELECT');
  return query select 'containment', 'public.' || c.relname || ' / authenticated ' || v.p, 'authenticated holds a privilege that RLS does not govern'
    from pg_class c cross join (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(p)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('authenticated', c.oid, v.p);
  return query select 'containment', 'public.' || t || ' / ' || r || ' TRUNCATE', 'TRUNCATE on an authority or append-only table'
    from unnest(array['staff_roles','security_audit_log','kitchens']) t cross join unnest(array['service_role','anon','authenticated']) r
   where to_regclass('public.' || t) is not null and has_table_privilege(r, ('public.' || t)::regclass, 'TRUNCATE');
  -- Views run with their owner's rights (postgres bypasses RLS) unless
  -- security_invoker is set; none is reviewed for client access.
  return query select 'containment', n.nspname || '.' || c.relname,
                      'view / materialized view / foreign table accessible to a client role (not reviewed; may bypass RLS of its base tables)'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any (api_schemas) and c.relkind in ('v','m','f')
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'));
  return query select 'containment', n.nspname || '.' || c.relname, 'client-accessible relation in a schema that is not reviewed'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r','p','v','m','f')
     and n.nspname <> all (api_schemas) and n.nspname <> all (platform_schemas) and n.nspname !~ '^pg_'
     and (has_schema_privilege('anon', n.oid, 'USAGE') or has_schema_privilege('authenticated', n.oid, 'USAGE'))
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'));
  return query select 'containment', x.col, 'authenticated may UPDATE a privileged column'
    from (values ('user_profiles','role'),('user_profiles','is_admin'),('user_profiles','user_id'),
                 ('drivers','status'),('drivers','commission_rate'),('drivers','total_earned'),
                 ('drivers','weekly_earnings'),('drivers','email'),('drivers','national_id'),('drivers','id')) v(t, c)
    cross join lateral (select v.t || '.' || v.c as col) x
   where to_regclass('public.' || v.t) is not null
     and has_column_privilege('authenticated', ('public.' || v.t)::regclass, v.c, 'UPDATE');
  return query select 'containment', 'public.' || t, 'authenticated has access to a retired or service-only table'
    from unnest(array['daily_closings','kiosks','products','stock_movements','admins','bank_accounts',
                      'admin_logs','financial_transactions','platform_settings']) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'));
  return query select 'containment', 'public.' || t, 'authenticated can write a server-managed table'
    from unnest(array['staff_roles','security_audit_log','kitchens','order_status_updates']) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE')
       or has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'));
  -- Functions
  return query select 'containment', p.oid::regprocedure::text, 'unsafe function executable by a client role'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_order_transaction','calculate_driver_weekly_earnings','containment_violations')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  return query select 'containment', p.oid::regprocedure::text, 'public function executable by anon'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype);
  return query select 'containment', p.oid::regprocedure::text, 'SECURITY DEFINER function executable by a client role is not reviewed'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or replace(p.oid::regprocedure::text, ' ', '') <> all (client_definer_functions));
  return query select 'containment', p.oid::regprocedure::text, 'SECURITY DEFINER function without a fixed search_path'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%');
  return query select 'containment', split_part(r, '|', 1), 'reviewed function changed (body, SECURITY DEFINER or configuration differ)'
    from unnest(reviewed_functions) r
    join pg_proc p on replace(p.oid::regprocedure::text, ' ', '') = split_part(r, '|', 1)
   where (replace(p.oid::regprocedure::text, ' ', '') || '|' || p.prosecdef::text || '|'
          || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || md5(p.prosrc)) <> r;
  -- Rewrite rules (review 2026-10-26 L3): no table in public has a reviewed
  -- rule. A rule can silently discard or redirect writes (for example
  -- DO INSTEAD NOTHING on security_audit_log), which no policy, grant or
  -- trigger check would show. A view's own _RETURN rule is not a rule here.
  return query select 'containment', 'rule ' || c.relname || '.' || w.rulename, 'unexpected rewrite rule'
    from pg_rewrite w join pg_class c on c.oid = w.ev_class
   where c.relnamespace = 'public'::regnamespace and w.rulename <> '_RETURN';
  -- Guard triggers and constraints
  return query select 'containment', 'trigger ' || x.t || '.' || x.g, 'required guard trigger missing or disabled'
    from (values ('user_profiles','trg_enforce_profile_privilege_guard'),
                 ('drivers','trg_enforce_driver_availability'),
                 ('security_audit_log','security_audit_log_append_only'),
                 ('security_audit_log','security_audit_log_no_truncate'),
                 ('staff_roles','trg_staff_roles_serialize'),
                 ('staff_roles','trg_staff_roles_require_admin'),
                 ('staff_roles','trg_staff_roles_driver_offline'),
                 ('staff_roles','trg_staff_roles_no_truncate')) x(t, g)
   where not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = to_regclass('public.' || x.t) and tg.tgname = x.g and tg.tgenabled <> 'D');
  return query select 'containment', 'public.drivers', 'availability check constraint missing or not the reviewed definition'
   where not exists (select 1 from pg_constraint
                      where conrelid = to_regclass('public.drivers') and conname = 'drivers_status_availability_check'
                        and pg_get_constraintdef(oid) = 'CHECK ((status = ANY (ARRAY[''online''::text, ''offline''::text])))');
  return query select 'containment', 'public.drivers.status', 'drivers.status allows NULL'
    from pg_attribute a
   where a.attrelid = to_regclass('public.drivers') and a.attname = 'status' and not a.attnotnull;
  -- State invariants (dynamic SQL: the tables exist only after the migration)
  if to_regclass('public.staff_roles') is not null then
    return query execute
      $q$select 'containment'::text, 'public.staff_roles'::text, 'no active admin staff role'::text
          where not exists (select 1 from public.staff_roles where role = 'admin' and is_active)$q$;
    return query execute
      $q$select 'containment'::text, 'public.drivers ' || d.id::text, 'driver online without an active driver approval'::text
           from public.drivers d
          where d.status = 'online'
            and not exists (select 1 from public.staff_roles s
                             where s.user_id = d.id and s.role = 'driver' and s.is_active)$q$;
  end if;
  return query select 'containment', 'default privileges ' || coalesce(d.defaclnamespace::regnamespace::text, '(global)')
                    || ' ' || d.defaclobjtype::text, 'migration role default privileges grant client access'
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'));
  return query select 'containment', 'default privileges (global) f', 'built-in default lets PUBLIC execute new functions'
   where not exists (select 1 from pg_default_acl d
                      where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f');

  -- ============================ storage ============================
  if to_regclass('storage.objects') is null then
    return query select 'storage', 'storage.objects', 'storage schema absent: storage containment not verifiable here';
  else
    -- every policy on every storage table (all commands, incl. SELECT /
    -- listing) must match a reviewed definition exactly
    return query select 'storage', 'storage.' || p.tablename || '.' || p.policyname,
                        'storage policy not reviewed, or its command/roles/mode/USING/WITH CHECK differ from the reviewed definition'
      from pg_policies p
     where p.schemaname = 'storage'
       and (p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::text || '|' || p.cmd || '|'
            || coalesce(regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|'
            || coalesce(regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')) <> all (reviewed_storage_policies);
    return query select 'storage', 'storage.' || split_part(r, '|', 1) || '.' || split_part(r, '|', 2), 'reviewed storage policy missing'
      from unnest(reviewed_storage_policies) r
     where not exists (select 1 from pg_policies p where p.schemaname = 'storage'
                          and p.tablename = split_part(r, '|', 1) and p.policyname = split_part(r, '|', 2));
    return query execute
      $q$select 'storage'::text, 'bucket ' || b.id, 'public bucket other than meal-images'::text
           from storage.buckets b where b.public and b.id <> 'meal-images'$q$;
    -- CTO-approved meal-images limits (5 MiB; jpeg/png/webp only)
    return query execute
      $q$select 'storage'::text, 'bucket meal-images',
                ('size/MIME limits not as approved (file_size_limit=' || coalesce(b.file_size_limit::text, 'NULL')
                 || ', allowed_mime_types=' || coalesce(b.allowed_mime_types::text, 'NULL') || ')')::text
           from storage.buckets b
          where b.id = 'meal-images'
            and (b.file_size_limit is distinct from 5242880
                 or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp']::text[])$q$;
    return query execute
      $q$select 'storage'::text, 'bucket meal-images', 'bucket missing'::text
          where not exists (select 1 from storage.buckets where id = 'meal-images')$q$;
  end if;
end
$cv$;
-- END GENERATED MONITOR

-- ---------------------------------------------------------------------
-- 5. Postcondition
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 create_order postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  if has_function_privilege('anon', 'public.create_order(uuid,jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.create_order(uuid,jsonb,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_order(uuid,jsonb,uuid,text)', 'EXECUTE') then
    raise exception 'V1 create_order postcondition failed: wrong EXECUTE privileges on create_order';
  end if;
  if has_table_privilege('authenticated', 'public.pricing_policies', 'INSERT')
     or has_table_privilege('authenticated', 'public.pricing_policies', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pricing_policies', 'DELETE')
     or has_table_privilege('anon', 'public.pricing_policies', 'SELECT')
     or has_sequence_privilege('authenticated', 'public.order_number_seq', 'USAGE') then
    raise exception 'V1 create_order postcondition failed: a client role can write pricing or use the order number sequence';
  end if;
  if exists (select 1 from public.pricing_policies) then
    raise exception 'V1 create_order postcondition failed: no pricing may be created by the migration';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 create_order: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_create_gate_ok values ('postcondition');
end
$post$;

commit;
