import { Stack } from 'expo-router';
import { RouteGate } from '../../src/components/navigation/RouteGate';

// Kitchen board: kitchen staff of a kitchen (staff_roles). The gate only
// chooses screens; the database decides what each account may read
// (orders_kitchen_staff_read) and do (order_kitchen_update).
export default function KitchenLayout() {
  return (
    <RouteGate group="kitchen">
      <Stack screenOptions={{ headerShown: false }} />
    </RouteGate>
  );
}
