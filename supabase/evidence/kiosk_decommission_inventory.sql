-- L'OPTION — kiosk / Ola Amigos decommission inventory. READ-ONLY.
-- Run in Supabase Dashboard → SQL Editor. Returns one JSON cell with row
-- counts and last-activity dates only (no personal data). Changes nothing.
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),

  -- Kiosk-only tables
  'kiosks', (select jsonb_build_object('rows', count(*), 'active', count(*) filter (where status = 'active'),
      'last_seen', max(last_seen)) from public.kiosks),
  'products_by_brand', (select jsonb_object_agg(coalesce(brand, 'null'), n) from
      (select brand, count(*) n from public.products group by brand) x),
  'stock_movements', (select jsonb_build_object('rows', count(*), 'linked_to_orders', count(order_id),
      'last', max(created_at)) from public.stock_movements),
  'daily_closings', (select jsonb_build_object('rows', count(*), 'last_date', max(date)) from public.daily_closings),

  -- Shared table: orders (kiosk orders have kiosk_id; app orders have user_id)
  'orders_by_origin', (select jsonb_agg(jsonb_build_object('kiosk_order', k, 'app_user_order', u, 'rows', n, 'last', last))
      from (select kiosk_id is not null k, user_id is not null u, count(*) n, max(created_at) last
            from public.orders group by 1, 2) x),
  'app_orders_using_kiosk_columns', (select jsonb_build_object(
      'items', count(*) filter (where items is not null),
      'table_number', count(*) filter (where table_number is not null),
      'customer_name', count(*) filter (where customer_name is not null),
      'tracking_token', count(*) filter (where tracking_token is not null),
      'notified_at', count(*) filter (where notified_at is not null))
      from public.orders where user_id is not null),
  'orders_status_by_origin', (select jsonb_agg(jsonb_build_object('kiosk_order', k, 'status', s, 'rows', n))
      from (select kiosk_id is not null k, status s, count(*) n from public.orders group by 1, 2) x),

  -- Rows in other tables that point at kiosk orders (would block or cascade on delete)
  'refs_to_kiosk_orders', jsonb_build_object(
      'order_items', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.kiosk_id is not null),
      'order_status_updates', (select count(*) from public.order_status_updates s join public.orders o on o.id = s.order_id where o.kiosk_id is not null),
      'stock_movements', (select count(*) from public.stock_movements m join public.orders o on o.id = m.order_id where o.kiosk_id is not null),
      'financial_transactions', (select count(*) from public.financial_transactions f join public.orders o on o.id = f.order_id where o.kiosk_id is not null),
      'cash_collections', (select count(*) from public.cash_collections c join public.orders o on o.id = c.order_id where o.kiosk_id is not null),
      'collaborator_orders', (select count(*) from public.collaborator_orders c join public.orders o on o.id = c.order_id where o.kiosk_id is not null)),

  -- Ambiguous table: who uses order_status_updates?
  'order_status_updates_by_origin', (select jsonb_agg(jsonb_build_object('kiosk_order', k, 'rows', n))
      from (select o.kiosk_id is not null k, count(*) n from public.order_status_updates s
            left join public.orders o on o.id = s.order_id group by 1) x),

  -- Tables of unknown origin
  'bank_accounts_rows', (select count(*) from public.bank_accounts),
  'admins_rows', (select count(*) from public.admins),

  -- Storage: objects per bucket ('src' bucket origin unknown)
  'storage_objects_by_bucket', (select jsonb_object_agg(bucket_id, n) from
      (select bucket_id, count(*) n from storage.objects group by bucket_id) x)
)) as inventory;
