-- =====================================================================
-- L'OPTION demo accounts for testing the order workflow.
-- Run in: Supabase dashboard -> SQL Editor (runs as postgres), on a TEST
-- project. Safe to run again: existing accounts are updated, not duplicated.
--
-- Creates 5 confirmed e-mail accounts (no e-mail is sent):
--   admin@demo.loption.test     admin (staff role + admin profile)
--   caisse@demo.loption.test    cashier of Kitchen A
--   cuisine@demo.loption.test   kitchen staff of Kitchen A
--   livreur@demo.loption.test   driver of Kitchen A (+ drivers row, online)
--   client@demo.loption.test    customer (profile, onboarding done, address)
-- and, if the order workflow migrations are installed, 5 pending demo orders.
--
-- WARNING for a production / shared project: these accounts get staff
-- powers (admin can manage every order). Change the password below to a
-- strong one, or do not run this there at all. The cashier, kitchen and
-- driver screens also need the order workflow migrations (20261105 and
-- later); the script says so if they are missing.
-- =====================================================================
do $demo$
declare
  v_password constant text := 'Demo-1234!';   -- <- change for any shared or production project
  v_kitchen uuid;
  v_id uuid;
  v_n int;
  r record;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'staff_roles') then
    raise exception 'public.staff_roles is missing: apply the Phase 1C migration first';
  end if;
  select id into v_kitchen from public.kitchens where code = 'A';
  if v_kitchen is null then
    raise exception 'Kitchen A (public.kitchens code A) is missing: apply the Phase 1C migration first';
  end if;

  for r in select * from (values
      ('admin@demo.loption.test',   'admin'),
      ('caisse@demo.loption.test',  'cashier'),
      ('cuisine@demo.loption.test', 'kitchen_staff'),
      ('livreur@demo.loption.test', 'driver'),
      ('client@demo.loption.test',  'customer')) v(email, role)
  loop
    -- 1. Auth account: confirmed e-mail + password (and its e-mail identity).
    select id into v_id from auth.users where lower(email) = r.email;
    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', r.email,
              extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    else
      update auth.users
         set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             banned_until = null, updated_at = now()
       where id = v_id;
    end if;
    if not exists (select 1 from auth.identities where user_id = v_id and provider = 'email') then
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
      values (gen_random_uuid(), v_id, v_id::text,
              jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true), 'email', now(), now(), now());
    end if;

    -- 2. Profile (the app uses it to open the admin or customer screens).
    if r.role = 'admin' then
      insert into public.user_profiles (user_id, role, is_admin, full_name)
      values (v_id, 'admin', true, 'Admin Démo')
      on conflict (user_id) do update set role = 'admin', is_admin = true;
    elsif r.role = 'customer' then
      insert into public.user_profiles (user_id, role, is_admin, full_name, gender, age, weight, height, activity_level, delivery_address)
      values (v_id, 'customer', false, 'Client Démo', 'woman', 30, 62, 168, 'moderate', '12 Rue Test, Casablanca')
      on conflict (user_id) do nothing;
      update public.user_profiles set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where user_id = v_id;
    end if;

    -- 3. Staff role (authority for every staff action; one active role per user).
    if r.role <> 'customer' and not exists (select 1 from public.staff_roles where user_id = v_id and is_active) then
      insert into public.staff_roles (user_id, role, kitchen_id)
      values (v_id, r.role, case when r.role = 'admin' then null else v_kitchen end);
    end if;

    -- 4. Driver row (the driver screens and the admin's driver list read it).
    if r.role = 'driver' and not exists (select 1 from public.drivers where id = v_id) then
      insert into public.drivers (id, email, first_name, last_name, status, commission_rate, total_earned)
      values (v_id, r.email, 'Livreur', 'Démo', 'online', 0.15, 0);
    end if;
  end loop;

  -- 5. Pending demo orders, only where the order workflow is installed.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'workflow_version')
     or to_regprocedure('public.order_confirm(uuid)') is null then
    raise notice 'Accounts ready. The order workflow migrations (20261105 and later) are NOT installed here: no demo orders were created, and the cashier, kitchen and driver screens cannot work in this project.';
    return;
  end if;
  insert into public.meals (id, name, price, calories, protein) values
    ('00000000-0000-0000-0000-0000000d0e01', 'Bol poulet harissa', 65, 620, 42),
    ('00000000-0000-0000-0000-0000000d0e02', 'Salade César', 55, 480, 30)
  on conflict (id) do nothing;
  select id into v_id from auth.users where lower(email) = 'client@demo.loption.test';
  select count(*) into v_n from public.orders where order_number like 'LO-DEMO-%';
  for i in v_n + 1 .. v_n + 5 loop
    declare oid uuid := gen_random_uuid(); begin
      perform set_config('loption.order_service', 'on', true);   -- as create_order would (orders are server-written only)
      insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method, user_id,
                                 subtotal, delivery_fee, platform_service_fee, total, delivery_address, delivery_phone)
      values (oid, 'LO-DEMO-' || lpad(i::text, 3, '0'), 'pending', 1, v_kitchen, 'pending', 'cash', v_id,
              120, 16, 3, 139, '12 Rue Test, Casablanca', '+212612345678');
      insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes, options, line_total_ttc) values
        (oid, '00000000-0000-0000-0000-0000000d0e01', 'Bol poulet harissa', 1, 65, case when i % 2 = 1 then 'sans oignon' end,
         '[{"group": "Sauce", "name": "Harissa", "price": 0}]'::jsonb, 65),
        (oid, '00000000-0000-0000-0000-0000000d0e02', 'Salade César', 1, 55, null, '[]'::jsonb, 55);
      insert into public.order_status_updates (order_id, status) values (oid, 'pending');
      perform set_config('loption.order_service', 'off', true);
    end;
  end loop;
  raise notice 'Accounts ready and 5 pending demo orders created.';
end
$demo$;

-- Check: every account confirmed, with its role.
select u.email,
       u.email_confirmed_at is not null as email_verified,
       coalesce((select string_agg(s.role, ',') from public.staff_roles s where s.user_id = u.id and s.is_active), '-') as staff_role,
       coalesce((select p.role from public.user_profiles p where p.user_id = u.id), '-') as profile_role
  from auth.users u
 where u.email like '%@demo.loption.test'
 order by u.email;
