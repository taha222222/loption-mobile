-- =====================================================================
-- L'OPTION V1 — order lifecycle hardening (no new status, no new rule).
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on 20261109120000_v1_checkout_experience.sql (full V1 chain).
-- Rollback: supabase/rollback/v1_order_lifecycle_hardening_rollback.sql.
-- Business source: docs/v1/business/order-lifecycle.md (confirmed lifecycle
-- of 2026-11-05; nothing added).
--
-- Closes four gaps found by the Milestone 1 audit, all ways to bypass the
-- workflow functions or lose history:
--   1. A workflow order could be DELETED by an admin (policy
--      staff_admin_all_orders) or service_role: the guard covered INSERT and
--      UPDATE only. Now refused unless the order service itself does it.
--   2. The customer timeline (order_status_updates) of a workflow order could
--      be inserted, rewritten or deleted by service_role (and postgres)
--      outside the workflow. Now: rows are written only by the order service
--      and never changed or deleted.
--   3. Detaching the customer of a workflow order (user_id -> NULL) was
--      allowed to any role able to UPDATE (admin, service_role). It exists
--      for account deletion only (delete_my_account, SECURITY DEFINER, runs as
--      postgres): now only postgres may detach.
--   4. A cancellation reason was kept on the order and the timeline but not
--      in the audit row: the audit row now carries it.
-- The transition table, the actors, the payment rules and the first-order
-- rule are unchanged. The Phase 1C monitor is unchanged (no client policy or
-- client function added).
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 order lifecycle hardening: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_lifecycle_gate_ok (step text primary key) on commit drop;
create temp table v1_lifecycle_gate (
  step text constraint v1_order_lifecycle_hardening_guard_did_not_pass references v1_lifecycle_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_lifecycle_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
begin
  if to_regprocedure('public.checkout_preview(uuid,jsonb,text)') is null then
    raise exception 'V1 order lifecycle hardening: the V1 checkout experience migration must be applied first; aborting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure)
     <> '39523bf8d3b37e19078633046313f8eb' then
    raise exception 'V1 order lifecycle hardening: containment_violations() is not the reviewed monitor of the checkout experience migration; refusing';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 order lifecycle hardening: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  if to_regprocedure('public.order_status_updates_guard()') is not null then
    raise exception 'V1 order lifecycle hardening: already applied (re-run), refusing';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 order lifecycle hardening: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_lifecycle_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. Orders: no delete of a workflow order; detaching the customer only in
--    account deletion (postgres). Same rules as before otherwise.
-- ---------------------------------------------------------------------
create or replace function public.orders_workflow_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('loption.order_service', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.workflow_version is not null then
      raise exception 'a workflow order is never deleted (cancel it through the order workflow)' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.workflow_version is not null then
      raise exception 'workflow orders are created by the order service only' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE. Detaching the customer is allowed only to account deletion
  -- (delete_my_account runs as postgres); nothing else may change.
  if old.workflow_version is not null then
    if (to_jsonb(new) - 'user_id') is distinct from (to_jsonb(old) - 'user_id')
       or (new.user_id is not null and new.user_id is distinct from old.user_id) then
      raise exception 'a workflow order changes only through the order workflow functions' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id and current_user <> 'postgres' then
      raise exception 'only account deletion detaches the customer of a workflow order' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Historical order: its state, driver and payment are frozen.
  if new.status is distinct from old.status
     or new.workflow_version is distinct from old.workflow_version
     or new.payment_status is distinct from old.payment_status
     or new.kitchen_id is distinct from old.kitchen_id
     or new.driver_id is distinct from old.driver_id then
    raise exception 'historical orders are frozen: status, driver, kitchen and payment cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger trg_orders_workflow_guard on public.orders;
create trigger trg_orders_workflow_guard
  before insert or update or delete on public.orders
  for each row execute function public.orders_workflow_guard();

-- ---------------------------------------------------------------------
-- 2. Timeline of a workflow order: written by the order service only, then
--    immutable. Rows of historical orders keep their previous behaviour.
-- ---------------------------------------------------------------------
create function public.order_status_updates_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  is_workflow boolean;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'the order timeline is never truncated' using errcode = '42501';
  end if;
  select o.workflow_version is not null into is_workflow
    from public.orders o where o.id = coalesce(new.order_id, old.order_id);
  if not coalesce(is_workflow, false) then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and current_user = 'postgres' and coalesce(current_setting('loption.order_service', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'the timeline of a workflow order is written by the order workflow only' using errcode = '42501';
  end if;
  raise exception 'the timeline of a workflow order is never changed or deleted' using errcode = '42501';
end;
$$;
revoke all on function public.order_status_updates_guard() from public, anon, authenticated, service_role;
create trigger trg_order_status_updates_guard
  before insert or update or delete on public.order_status_updates
  for each row execute function public.order_status_updates_guard();
create trigger trg_order_status_updates_no_truncate
  before truncate on public.order_status_updates
  for each statement execute function public.order_status_updates_guard();

-- ---------------------------------------------------------------------
-- 3. Transitions: same checks and effects; the audit row now also carries
--    the cancellation reason.
-- ---------------------------------------------------------------------
create or replace function public.order_apply_transition(p_order uuid, p_to text, p_actor text, p_reason text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.workflow_version is null then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if o.status = p_to then
    return 'unchanged';
  end if;
  if not exists (select 1 from public.order_transitions() t
                  where t.from_status = o.status and t.to_status = p_to and t.actor = p_actor) then
    raise exception 'invalid order transition % -> %', o.status, p_to using errcode = '22023';
  end if;
  -- re-checked under the row lock: a driver reassigned a moment ago cannot act
  if p_actor = 'driver' and o.driver_id is distinct from (select auth.uid()) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if p_actor = 'customer' and o.user_id is distinct from (select auth.uid()) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if p_to = 'picked_up' and o.driver_id is null then
    raise exception 'no driver is assigned to this order' using errcode = '22023';
  end if;
  perform set_config('loption.order_service', 'on', true);
  update public.orders
     set status = p_to,
         status_changed_at = now(),
         confirmed_at  = case when p_to = 'confirmed'  then now() else confirmed_at end,
         preparing_at  = case when p_to = 'preparing'  then now() else preparing_at end,
         ready_at      = case when p_to = 'ready'      then now() else ready_at end,
         picked_up_at  = case when p_to = 'picked_up'  then timezone('UTC', now()) else picked_up_at end,
         on_the_way_at = case when p_to = 'on_the_way' then now() else on_the_way_at end,
         delivered_at  = case when p_to = 'delivered'  then timezone('UTC', now()) else delivered_at end,
         cancelled_at  = case when p_to = 'cancelled'  then now() else cancelled_at end,
         cancel_reason = case when p_to = 'cancelled'  then p_reason else cancel_reason end,
         -- the customer sees the driver's position only between pickup and delivery
         driver_latitude      = case when p_to in ('delivered', 'cancelled') then null else driver_latitude end,
         driver_longitude     = case when p_to in ('delivered', 'cancelled') then null else driver_longitude end,
         last_location_update = case when p_to in ('delivered', 'cancelled') then null else last_location_update end,
         updated_at = now()
   where id = p_order;
  insert into public.order_status_updates (order_id, status, message)
  values (p_order, p_to, case when p_to = 'cancelled' then p_reason end);
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values ((select auth.uid()), public.order_audit_action(p_to), o.user_id,
          jsonb_build_object('order_id', p_order, 'from', o.status, 'to', p_to, 'actor', p_actor, 'kitchen_id', o.kitchen_id)
          || case when p_to = 'cancelled' and p_reason is not null then jsonb_build_object('reason', p_reason) else '{}'::jsonb end);
  perform set_config('loption.order_service', 'off', true);
  return 'changed';
end;
$$;
revoke all on function public.order_apply_transition(uuid, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Postcondition
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 order lifecycle hardening postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure) <> '39523bf8d3b37e19078633046313f8eb' then
    raise exception 'V1 order lifecycle hardening postcondition failed: the monitor changed (this migration adds no client policy or client function)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_orders_workflow_guard' and tgrelid = 'public.orders'::regclass
                  and (tgtype & 8) <> 0 and (tgtype & 4) <> 0 and (tgtype & 16) <> 0) then
    raise exception 'V1 order lifecycle hardening postcondition failed: the orders guard must cover insert, update and delete';
  end if;
  if has_function_privilege('authenticated', 'public.order_apply_transition(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.order_apply_transition(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'V1 order lifecycle hardening postcondition failed: order_apply_transition is internal';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 order lifecycle hardening: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_lifecycle_gate_ok values ('postcondition');
end
$post$;

commit;
