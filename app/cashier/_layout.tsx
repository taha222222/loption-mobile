import { Stack } from 'expo-router';
import { RouteGate } from '../../src/components/navigation/RouteGate';

// Cashier order management: the cashier of a kitchen (staff_roles) and admins.
// The gate only chooses screens; the database decides what each account may
// read (orders_cashier_read, staff_admin_all_orders) and do (order_confirm,
// order_cancel).
export default function CashierLayout() {
  return (
    <RouteGate group="cashier">
      <Stack screenOptions={{ headerShown: false }} />
    </RouteGate>
  );
}
