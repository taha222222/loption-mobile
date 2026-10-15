// src/stores/sessionReset.ts
// Clears every piece of client state that belongs to a signed-in user.
// Called on sign-out and whenever the active auth user changes, so nothing
// (cart, profile, orders, realtime channels, location tracking) can leak
// from one account to the next on a shared device.
import { supabase } from '../lib/supabase';
import { locationService } from '../services/locationService';
import { useAdminStore } from './adminStore';
import { useCartStore } from './cartStore';
import { useCollaboratorStore } from './collaboratorStore';
import { useDriverEarningsStore } from './driverEarningsStore';
import { useSubscriptionStore } from './subscriptionStore';
import { useUserStore } from './userStore';

export async function resetUserScopedState(
  options: { keepPersistedCart?: boolean } = {}
): Promise<void> {
  // The persisted cart is kept only when no user was active in memory (cold
  // start); cartStore.claimForUser() then discards it if it belongs to someone else.
  if (!options.keepPersistedCart) useCartStore.getState().reset();
  useUserStore.getState().reset();
  useSubscriptionStore.setState(useSubscriptionStore.getInitialState(), true);
  useCollaboratorStore.setState(useCollaboratorStore.getInitialState(), true);
  useAdminStore.setState(useAdminStore.getInitialState(), true);
  useDriverEarningsStore.setState(useDriverEarningsStore.getInitialState(), true);

  await Promise.allSettled([
    locationService.stopTracking(),
    supabase.removeAllChannels(),
  ]);
}
