// src/orders/orderQueries.ts
// The hosted schema has two identical foreign keys from orders.driver_id to
// drivers (fk_orders_driver_id and orders_driver_id_fkey, see
// supabase/baseline/staging_schema_2026-10-15.sql). A plain embed
// `drivers:driver_id(...)` is then ambiguous and PostgREST refuses the whole
// request (PGRST201), which left the admin order list empty. Naming one of
// the two relationships works with both keys present (and if the duplicate
// is ever dropped).
export const ORDER_DRIVER_EMBED = 'drivers:drivers!orders_driver_id_fkey (first_name, last_name)';
