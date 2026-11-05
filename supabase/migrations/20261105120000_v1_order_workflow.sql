-- =====================================================================
-- L'OPTION V1 — order workflow: one state machine for delivery orders,
-- enforced in the database.
--
-- STATUS: proposal for review. NOT applied to any hosted database.
-- Depends on 20261104120000_v1_account_deletion.sql.
-- Rollback: supabase/rollback/v1_order_workflow_rollback.sql (archiving).
--
-- Owner decisions (2026-11-05, DECISIONS.md #29-#32):
--   * cash on delivery: the cashier confirms the ORDER (pending -> confirmed);
--     payment stays 'pending' until the cashier records it after delivery
--     (paid / failed; refunded later). No status changes on payment;
--   * the cashier (or an admin) assigns the driver; drivers only see orders
--     assigned to them;
--   * a customer may cancel only while pending; cashier/admin may cancel
--     pending, confirmed, preparing or ready with a reason; nobody cancels
--     after pickup;
--   * at most one active staff role per user (customers hold none).
--
-- What this migration adds:
--   1. staff_roles: one active role per user (unique partial index).
--   2. orders: workflow_version (NULL = historical counter/kiosk order,
--      frozen), kitchen_id, payment_status, step timestamps, cancel reason;
--      status vocabulary = historical values + the workflow values.
--   3. public.order_transitions(): THE single list of allowed transitions
--      (from, to, actor). Every function below and the client mirror
--      (src/orders/orderWorkflow.ts, tested against this list) use it.
--   4. orders_workflow_guard: no client, staff account (including admin via
--      its ALL policy) or service_role can change the state, driver,
--      kitchen, payment or content of a workflow order directly; only the
--      functions of this migration can (they run as postgres with a
--      transaction-local flag). Historical orders are frozen the same way.
--      The account-deletion path (user_id -> NULL) stays allowed.
--   5. order_items_snapshot_guard: price, meal, name and quantity of an
--      order line never change after insert (price snapshot); lines of a
--      workflow order are added or removed only by the order service.
--   6. Client functions (SECURITY DEFINER, fixed search_path, EXECUTE for
--      authenticated only, added to the Phase 1C monitor by the generator):
--      order_confirm, order_kitchen_update, order_assign_driver,
--      order_driver_update, order_cancel, order_set_payment,
--      driver_report_location. Each locks the order row, checks the caller's
--      role AND scope (kitchen, assignment, ownership) and the state, writes
--      the customer-visible status history and the immutable audit log.
--      Repeating a call that already took effect changes nothing.
--   7. driver_location_points: append-only location history for audit
--      (admin read only). Customers see the current position on their own
--      order only between pickup and delivery.
--   8. Read policies: kitchen staff and cashiers read the workflow orders of
--      their kitchen; items and status history are visible to whoever can
--      see the order.
--   9. Realtime: orders and order_status_updates published (best effort; a
--      failure here never aborts the migration).
-- Not in this migration: trusted order creation (blocked on pricing
-- approval, checklist H4), order notifications, kitchen/cashier screens.
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'V1 order workflow: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table v1_order_gate_ok (step text primary key) on commit drop;
create temp table v1_order_gate (
  step text constraint v1_order_guard_did_not_pass references v1_order_gate_ok deferrable initially deferred
) on commit drop;
insert into v1_order_gate values ('precondition'), ('postcondition');

-- ---------------------------------------------------------------------
-- 0. Precondition
-- ---------------------------------------------------------------------
do $pre$
declare
  bad text;
  n integer;
begin
  if to_regprocedure('public.delete_my_account(text)') is null then
    raise exception 'V1 order workflow: the V1 account deletion migration must be applied first; aborting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure)
     <> '8c902c66f5fac9b355d28b67c4c03250' then
    raise exception 'V1 order workflow: containment_violations() is not the reviewed monitor of the account deletion migration; refusing to extend it';
  end if;
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 order workflow: Phase 1C containment reports violations; refusing to build on it: %', bad;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'workflow_version')
     or to_regprocedure('public.order_transitions()') is not null
     or to_regclass('public.driver_location_points') is not null then
    raise exception 'V1 order workflow: already applied (re-run or unknown objects), refusing';
  end if;
  select count(*) into n from (select user_id from public.staff_roles where is_active group by user_id having count(*) > 1) x;
  if n > 0 then
    raise exception 'V1 order workflow: % user(s) hold more than one active staff role; revoke the extra roles first (one active role per user)', n;
  end if;
  select count(*) into n from public.orders
   where status is null or status <> all (array['new','confirmed','waiting_payment','in_preparation','prepared','ready_to_serve','served','paid']);
  if n > 0 then
    raise exception 'V1 order workflow: % existing order(s) have a status outside the reviewed historical vocabulary; refusing', n;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_status_check') then
    raise exception 'V1 order workflow: orders_status_check not found; the orders table is not the reviewed shape';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 order workflow: precondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_order_gate_ok values ('precondition');
end
$pre$;

-- ---------------------------------------------------------------------
-- 1. One active staff role per user
-- ---------------------------------------------------------------------
create unique index staff_roles_one_active_role on public.staff_roles (user_id) where is_active;

-- ---------------------------------------------------------------------
-- 2. Orders: workflow columns and vocabulary
-- ---------------------------------------------------------------------
alter table public.orders
  add column workflow_version smallint check (workflow_version = 1),
  add column kitchen_id uuid references public.kitchens(id),
  add column payment_status text check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  add column status_changed_at timestamptz,
  add column confirmed_at timestamptz,
  add column preparing_at timestamptz,
  add column ready_at timestamptz,
  add column on_the_way_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancel_reason text check (char_length(cancel_reason) between 3 and 300);

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status = any (array[
  -- historical counter/kiosk vocabulary (frozen rows)
  'new', 'confirmed', 'waiting_payment', 'in_preparation', 'prepared', 'ready_to_serve', 'served', 'paid',
  -- delivery workflow
  'pending', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivered', 'cancelled']));
alter table public.orders add constraint orders_workflow_shape check (
     (workflow_version is null and payment_status is null
      and status = any (array['new', 'confirmed', 'waiting_payment', 'in_preparation', 'prepared', 'ready_to_serve', 'served', 'paid']))
  or (workflow_version = 1 and kitchen_id is not null and payment_status is not null
      and status = any (array['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivered', 'cancelled'])));
create index orders_kitchen_workflow_idx on public.orders (kitchen_id, status) where workflow_version is not null;

-- ---------------------------------------------------------------------
-- 3. The single list of allowed transitions
-- ---------------------------------------------------------------------
-- actor: 'cashier' (an admin may act as cashier), 'kitchen_staff',
-- 'driver' (the assigned driver), 'customer' (the order's customer).
create function public.order_transitions()
returns table (from_status text, to_status text, actor text)
language sql immutable set search_path = ''
as $$
  values ('pending',    'confirmed',  'cashier'),
         ('confirmed',  'preparing',  'kitchen_staff'),
         ('preparing',  'ready',      'kitchen_staff'),
         ('ready',      'picked_up',  'driver'),
         ('picked_up',  'on_the_way', 'driver'),
         ('on_the_way', 'delivered',  'driver'),
         ('pending',    'cancelled',  'customer'),
         ('pending',    'cancelled',  'cashier'),
         ('confirmed',  'cancelled',  'cashier'),
         ('preparing',  'cancelled',  'cashier'),
         ('ready',      'cancelled',  'cashier')
$$;
revoke all on function public.order_transitions() from public, anon;
grant execute on function public.order_transitions() to authenticated, service_role;

-- Payment (cash on delivery): recorded by the cashier once the order is
-- delivered; a refund only after a payment.
create function public.order_payment_transitions()
returns table (from_status text, to_status text, order_status text)
language sql immutable set search_path = ''
as $$
  values ('pending', 'paid',     'delivered'),
         ('pending', 'failed',   'delivered'),
         ('failed',  'paid',     'delivered'),
         ('paid',    'refunded', 'delivered')
$$;
revoke all on function public.order_payment_transitions() from public, anon;
grant execute on function public.order_payment_transitions() to authenticated, service_role;

-- Audit action names for each target status.
create function public.order_audit_action(p_to text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_to
    when 'confirmed' then 'order_confirmed'
    when 'preparing' then 'kitchen_preparing'
    when 'ready' then 'order_ready'
    when 'picked_up' then 'order_picked_up'
    when 'on_the_way' then 'order_on_the_way'
    when 'delivered' then 'order_delivered'
    when 'cancelled' then 'order_cancelled'
  end
$$;
revoke all on function public.order_audit_action(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------
-- "The order service is writing" is true only inside the functions of this
-- migration: they run as the owner (current_user postgres) and set the
-- transaction-local flag loption.order_service. A client cannot become
-- postgres, so setting the flag alone does nothing. Both guards run with the
-- caller's rights so current_user is the real caller.
create function public.orders_workflow_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user = 'postgres' and coalesce(current_setting('loption.order_service', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.workflow_version is not null then
      raise exception 'workflow orders are created by the order service only' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE. Detaching the customer (account deletion) is always allowed.
  if old.workflow_version is not null then
    if (to_jsonb(new) - 'user_id') is distinct from (to_jsonb(old) - 'user_id')
       or (new.user_id is not null and new.user_id is distinct from old.user_id) then
      raise exception 'a workflow order changes only through the order workflow functions' using errcode = '42501';
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
revoke all on function public.orders_workflow_guard() from public, anon, authenticated, service_role;
create trigger trg_orders_workflow_guard
  before insert or update on public.orders
  for each row execute function public.orders_workflow_guard();

create function public.order_items_snapshot_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  wf smallint;
begin
  if tg_op = 'UPDATE' then
    if new.price is distinct from old.price or new.meal_id is distinct from old.meal_id
       or new.meal_name is distinct from old.meal_name or new.quantity is distinct from old.quantity
       or new.order_id is distinct from old.order_id then
      raise exception 'order lines keep their price snapshot: price, meal, name, quantity and order cannot change' using errcode = '42501';
    end if;
    return new;
  end if;
  select o.workflow_version into wf from public.orders o where o.id = coalesce(new.order_id, old.order_id);
  if wf is not null and not (current_user = 'postgres' and coalesce(current_setting('loption.order_service', true), '') = 'on') then
    raise exception 'lines of a workflow order are written by the order service only' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.order_items_snapshot_guard() from public, anon, authenticated, service_role;
create trigger trg_order_items_snapshot_guard
  before insert or update or delete on public.order_items
  for each row execute function public.order_items_snapshot_guard();

-- ---------------------------------------------------------------------
-- 5. Roles and scope
-- ---------------------------------------------------------------------
-- Read helper for policies: the caller holds this active role in this
-- kitchen (runs with the caller's rights; staff_roles_self_read applies).
create function public.has_kitchen_role(p_role text, p_kitchen uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles s
     where s.user_id = (select auth.uid()) and s.role = p_role and s.is_active and s.kitchen_id = p_kitchen);
$$;
revoke all on function public.has_kitchen_role(text, uuid) from public, anon;
grant execute on function public.has_kitchen_role(text, uuid) to authenticated;

-- Internal: does p_user hold the role for this kitchen? Admin counts as
-- cashier; a driver without a kitchen serves every kitchen.
create function public.order_staff_can(p_user uuid, p_actor text, p_kitchen uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.staff_roles s
     where s.user_id = p_user and s.is_active
       and (   (p_actor = 'cashier' and ((s.role = 'cashier' and s.kitchen_id = p_kitchen) or s.role = 'admin'))
            or (p_actor = 'kitchen_staff' and s.role = 'kitchen_staff' and s.kitchen_id = p_kitchen)
            or (p_actor = 'driver' and s.role = 'driver' and (s.kitchen_id is null or s.kitchen_id = p_kitchen))));
$$;
revoke all on function public.order_staff_can(uuid, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. The one place where a workflow order's status changes
-- ---------------------------------------------------------------------
-- Returns 'changed', or 'unchanged' when the order already has p_to (a
-- repeated call: no second history row, no second audit row).
create function public.order_apply_transition(p_order uuid, p_to text, p_actor text, p_reason text default null)
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
          jsonb_build_object('order_id', p_order, 'from', o.status, 'to', p_to, 'actor', p_actor, 'kitchen_id', o.kitchen_id));
  perform set_config('loption.order_service', 'off', true);
  return 'changed';
end;
$$;
revoke all on function public.order_apply_transition(uuid, text, text, text) from public, anon, authenticated, service_role;

-- Internal: the order's kitchen, customer and driver, or a refusal that
-- does not reveal whether the order exists.
create function public.order_scope(p_order uuid, out kitchen_id uuid, out user_id uuid, out driver_id uuid, out status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  select o.kitchen_id, o.user_id, o.driver_id, o.status into kitchen_id, user_id, driver_id, status
    from public.orders o where o.id = p_order and o.workflow_version is not null;
  if not found then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.order_scope(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Client functions
-- ---------------------------------------------------------------------
-- Cashier (or admin): pending -> confirmed. Cash on delivery: payment stays pending.
create function public.order_confirm(p_order uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
begin
  s := public.order_scope(p_order);
  if not public.order_staff_can((select auth.uid()), 'cashier', s.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  return public.order_apply_transition(p_order, 'confirmed', 'cashier');
end;
$$;
revoke all on function public.order_confirm(uuid) from public, anon, service_role;
grant execute on function public.order_confirm(uuid) to authenticated;

-- Kitchen staff of the order's kitchen: confirmed -> preparing -> ready.
create function public.order_kitchen_update(p_order uuid, p_status text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
begin
  s := public.order_scope(p_order);
  if not public.order_staff_can((select auth.uid()), 'kitchen_staff', s.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('preparing', 'ready') then
    raise exception 'the kitchen can only set preparing or ready' using errcode = '22023';
  end if;
  return public.order_apply_transition(p_order, p_status, 'kitchen_staff');
end;
$$;
revoke all on function public.order_kitchen_update(uuid, text) from public, anon, service_role;
grant execute on function public.order_kitchen_update(uuid, text) to authenticated;

-- Cashier (or admin): assign or reassign an active driver before pickup.
create function public.order_assign_driver(p_order uuid, p_driver uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  uid uuid := (select auth.uid());
begin
  select * into o from public.orders where id = p_order and workflow_version is not null for update;
  if not found or not public.order_staff_can(uid, 'cashier', o.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if o.status not in ('confirmed', 'preparing', 'ready') then
    raise exception 'a driver can be assigned only to a confirmed, preparing or ready order (status %)', o.status using errcode = '22023';
  end if;
  if not public.order_staff_can(p_driver, 'driver', o.kitchen_id) then
    raise exception 'this person is not an active driver for this kitchen' using errcode = '22023';
  end if;
  if o.driver_id is not distinct from p_driver then
    return 'unchanged';
  end if;
  perform set_config('loption.order_service', 'on', true);
  update public.orders set driver_id = p_driver, accepted_at = timezone('UTC', now()), updated_at = now() where id = p_order;
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (uid, case when o.driver_id is null then 'driver_assigned' else 'driver_reassigned' end, o.user_id,
          jsonb_build_object('order_id', p_order, 'driver_id', p_driver, 'previous_driver_id', o.driver_id, 'kitchen_id', o.kitchen_id));
  perform set_config('loption.order_service', 'off', true);
  return 'changed';
end;
$$;
revoke all on function public.order_assign_driver(uuid, uuid) from public, anon, service_role;
grant execute on function public.order_assign_driver(uuid, uuid) to authenticated;

-- The assigned driver: ready -> picked_up -> on_the_way -> delivered.
create function public.order_driver_update(p_order uuid, p_status text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  uid uuid := (select auth.uid());
begin
  s := public.order_scope(p_order);
  if s.driver_id is distinct from uid or not public.order_staff_can(uid, 'driver', s.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('picked_up', 'on_the_way', 'delivered') then
    raise exception 'a driver can only set picked_up, on_the_way or delivered' using errcode = '22023';
  end if;
  return public.order_apply_transition(p_order, p_status, 'driver');
end;
$$;
revoke all on function public.order_driver_update(uuid, text) from public, anon, service_role;
grant execute on function public.order_driver_update(uuid, text) to authenticated;

-- Customer: own order while pending. Cashier/admin: pending to ready, with a reason.
create function public.order_cancel(p_order uuid, p_reason text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  uid uuid := (select auth.uid());
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  s := public.order_scope(p_order);
  if uid is not null and s.user_id = uid then
    return public.order_apply_transition(p_order, 'cancelled', 'customer', reason);
  end if;
  if not public.order_staff_can(uid, 'cashier', s.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if reason is null or char_length(reason) < 3 then
    raise exception 'a cancellation reason is required' using errcode = '22023';
  end if;
  return public.order_apply_transition(p_order, 'cancelled', 'cashier', left(reason, 300));
end;
$$;
revoke all on function public.order_cancel(uuid, text) from public, anon, service_role;
grant execute on function public.order_cancel(uuid, text) to authenticated;

-- Cashier (or admin): payment of a delivered cash order.
create function public.order_set_payment(p_order uuid, p_status text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  uid uuid := (select auth.uid());
begin
  select * into o from public.orders where id = p_order and workflow_version is not null for update;
  if not found or not public.order_staff_can(uid, 'cashier', o.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if o.payment_status = p_status then
    return 'unchanged';
  end if;
  if not exists (select 1 from public.order_payment_transitions() t
                  where t.from_status = o.payment_status and t.to_status = p_status and t.order_status = o.status) then
    raise exception 'invalid payment change % -> % for an order that is %', o.payment_status, p_status, o.status using errcode = '22023';
  end if;
  perform set_config('loption.order_service', 'on', true);
  update public.orders set payment_status = p_status, updated_at = now() where id = p_order;
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  values (uid, case p_status when 'paid' then 'payment_confirmed' when 'failed' then 'payment_failed' else 'payment_refunded' end, o.user_id,
          jsonb_build_object('order_id', p_order, 'from', o.payment_status, 'to', p_status, 'kitchen_id', o.kitchen_id));
  perform set_config('loption.order_service', 'off', true);
  return 'changed';
end;
$$;
revoke all on function public.order_set_payment(uuid, text) from public, anon, service_role;
grant execute on function public.order_set_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Driver location: history for audit, current position for the customer
-- ---------------------------------------------------------------------
create table public.driver_location_points (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id),
  driver_id   uuid not null,  -- no foreign key: the history outlives accounts (audit)
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  accuracy_m  real check (accuracy_m >= 0 and accuracy_m <= 5000),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint driver_location_points_once unique (order_id, recorded_at)
);
create index driver_location_points_driver_idx on public.driver_location_points (driver_id, recorded_at);
alter table public.driver_location_points enable row level security;
revoke all on public.driver_location_points from public, anon, authenticated, service_role;
grant select on public.driver_location_points to authenticated;   -- admins only, via RLS
create policy driver_locations_admin_read on public.driver_location_points
  for select to authenticated using ((select public.has_staff_role('admin')));

create function public.driver_location_points_append_only()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'driver_location_points is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.driver_location_points_append_only() from public, anon, authenticated, service_role;
create trigger trg_driver_location_points_append_only
  before update or delete on public.driver_location_points
  for each row execute function public.driver_location_points_append_only();
create trigger trg_driver_location_points_no_truncate
  before truncate on public.driver_location_points
  for each statement execute function public.driver_location_points_append_only();

-- The assigned driver, only between pickup and delivery. Returns true when
-- the point was stored (a repeated point is ignored).
create function public.driver_report_location(p_order uuid, p_latitude double precision, p_longitude double precision,
                                              p_accuracy real, p_recorded_at timestamptz)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  uid uuid := (select auth.uid());
  stored integer;
begin
  -- Locked: a position never lands after the order was delivered or reassigned.
  select * into o from public.orders where id = p_order and workflow_version is not null for update;
  if not found or o.driver_id is distinct from uid or not public.order_staff_can(uid, 'driver', o.kitchen_id) then
    raise exception 'order not found or not allowed' using errcode = '42501';
  end if;
  if o.status not in ('picked_up', 'on_the_way') then
    raise exception 'location is shared only between pickup and delivery' using errcode = '22023';
  end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or (p_accuracy is not null and (p_accuracy < 0 or p_accuracy > 5000)) then
    raise exception 'invalid position' using errcode = '22023';
  end if;
  if p_recorded_at is null or p_recorded_at > now() + interval '1 minute' or p_recorded_at < now() - interval '10 minutes' then
    raise exception 'position time is too far from now' using errcode = '22023';
  end if;
  insert into public.driver_location_points (order_id, driver_id, latitude, longitude, accuracy_m, recorded_at)
  values (p_order, uid, p_latitude, p_longitude, p_accuracy, p_recorded_at)
  on conflict on constraint driver_location_points_once do nothing;
  get diagnostics stored = row_count;
  if stored = 0 then
    return false;
  end if;
  perform set_config('loption.order_service', 'on', true);
  update public.orders
     set driver_latitude = p_latitude, driver_longitude = p_longitude,
         last_location_update = timezone('UTC', p_recorded_at)
   where id = p_order
     and (last_location_update is null or last_location_update <= timezone('UTC', p_recorded_at));
  perform set_config('loption.order_service', 'off', true);
  return true;
end;
$$;
revoke all on function public.driver_report_location(uuid, double precision, double precision, real, timestamptz) from public, anon, service_role;
grant execute on function public.driver_report_location(uuid, double precision, double precision, real, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Read policies for kitchen staff and cashiers; items and history
--    follow the visibility of their order
-- ---------------------------------------------------------------------
create policy orders_kitchen_staff_read on public.orders
  for select to authenticated using (workflow_version is not null and public.has_kitchen_role('kitchen_staff', kitchen_id));
create policy orders_cashier_read on public.orders
  for select to authenticated using (workflow_version is not null and public.has_kitchen_role('cashier', kitchen_id));
create policy order_items_read_with_order on public.order_items
  for select to authenticated using (exists (select 1 from public.orders o where o.id = order_items.order_id));
create policy order_status_read_with_order on public.order_status_updates
  for select to authenticated using (exists (select 1 from public.orders o where o.id = order_status_updates.order_id));

-- ---------------------------------------------------------------------
-- 10. Realtime (best effort: never aborts the migration)
-- ---------------------------------------------------------------------
do $rt$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders', 'order_status_updates'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        begin
          execute format('alter publication supabase_realtime add table public.%I', t);
        exception when others then
          raise notice 'V1 order workflow: realtime publication not changed for %: %', t, sqlerrm;
        end;
      end if;
    end loop;
  else
    raise notice 'V1 order workflow: publication supabase_realtime not found; realtime not enabled';
  end if;
end
$rt$;

-- ---------------------------------------------------------------------
-- 11. Phase 1C monitor: reviewed policies and client definer functions
--     extended with this migration's. GENERATED by
--     supabase/tools/generate_nutrition_monitor.py; do not edit by hand.
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
    'orders|orders_kitchen_staff_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''kitchen_staff''::text, kitchen_id))|-'];
  reviewed_storage_policies text[] := array[
    'objects|staff_admin_delete_meal_images|PERMISSIVE|{authenticated}|DELETE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_insert_meal_images|PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))',
    'objects|staff_admin_select_meal_images|PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|-',
    'objects|staff_admin_update_meal_images|PERMISSIVE|{authenticated}|UPDATE|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))|((bucket_id = ''meal-images''::text) AND ( SELECT public.has_staff_role(''admin''::text) AS has_staff_role))'];
  -- SECURITY DEFINER functions a client role may execute (authenticated only).
  client_definer_functions text[] := array[
    'public.has_staff_role(text)','public.assign_staff_role(uuid,text,uuid)',
    'public.revoke_staff_role(uuid,text,uuid)','public.set_driver_availability(boolean)',
    'public.register_push_token(text,text)','public.deactivate_push_token(text)','public.delete_my_account(text)','public.order_confirm(uuid)','public.order_kitchen_update(uuid,text)','public.order_assign_driver(uuid,uuid)','public.order_driver_update(uuid,text)','public.order_cancel(uuid,text)','public.order_set_payment(uuid,text)','public.driver_report_location(uuid,doubleprecision,doubleprecision,real,timestampwithtimezone)'];
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
-- 12. Postcondition
-- ---------------------------------------------------------------------
do $post$
declare
  bad text;
  f text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v where v.category in ('drift', 'containment');
  if bad is not null then
    raise exception 'V1 order workflow postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  foreach f in array array['public.order_confirm(uuid)', 'public.order_kitchen_update(uuid,text)', 'public.order_assign_driver(uuid,uuid)',
                           'public.order_driver_update(uuid,text)', 'public.order_cancel(uuid,text)', 'public.order_set_payment(uuid,text)',
                           'public.driver_report_location(uuid,double precision,double precision,real,timestamp with time zone)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE')
       or not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'V1 order workflow postcondition failed: wrong EXECUTE privileges on %', f;
    end if;
  end loop;
  foreach f in array array['public.order_apply_transition(uuid,text,text,text)', 'public.order_staff_can(uuid,text,uuid)',
                           'public.order_scope(uuid)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'V1 order workflow postcondition failed: internal function % is executable by a client role', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.driver_location_points', 'INSERT')
     or has_table_privilege('authenticated', 'public.driver_location_points', 'UPDATE')
     or has_table_privilege('authenticated', 'public.driver_location_points', 'DELETE')
     or has_table_privilege('anon', 'public.driver_location_points', 'SELECT') then
    raise exception 'V1 order workflow postcondition failed: driver_location_points is writable by a client role';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'trg_orders_workflow_guard' and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.order_items'::regclass and tgname = 'trg_order_items_snapshot_guard' and tgenabled <> 'D') then
    raise exception 'V1 order workflow postcondition failed: guard trigger missing';
  end if;
  if exists (select 1 from public.orders where workflow_version is not null) then
    raise exception 'V1 order workflow postcondition failed: existing orders were changed';
  end if;
  if current_user <> 'postgres' then
    raise exception 'V1 order workflow: postcondition must run as role postgres' using errcode = '42501';
  end if;
  insert into pg_temp.v1_order_gate_ok values ('postcondition');
end
$post$;

commit;
