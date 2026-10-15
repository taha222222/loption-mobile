import { create } from 'zustand';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useCartStore } from './cartStore';
import { resetUserScopedState } from './sessionReset';

export type UserRole = 'customer' | 'driver' | 'collaborator' | 'admin';
export type RoleStatus = 'idle' | 'loading' | 'resolved' | 'error';

const KNOWN_ROLES: readonly UserRole[] = ['customer', 'driver', 'collaborator', 'admin'];

interface AuthState {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  roleStatus: RoleStatus;
  // True until the persisted session has been restored at startup.
  isLoading: boolean;
  initialize: () => () => void;
  signIn: (email: string, password: string) => Promise<{ error: any | null }>;
  signUp: (email: string, password: string, userData?: any) => Promise<{ error: any | null }>;
  signOut: () => Promise<{ error: any | null }>;
  retryRoleResolution: () => Promise<void>;
}

// Role lookups in flight, keyed by user id, so concurrent triggers share one request.
const roleRequests = new Map<string, Promise<void>>();
let authSubscription: { unsubscribe: () => void } | null = null;

// NOTE: the role is resolved by client-side reads for routing/UX only. It is
// not an authorization boundary; the database (RLS) must enforce access.
// That enforcement is unverified and tracked as a Phase 1B dependency.
async function lookupRole(userId: string): Promise<UserRole> {
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role, is_admin')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (profile) {
    if (profile.role === 'admin' || profile.is_admin === true) return 'admin';
    if (KNOWN_ROLES.includes(profile.role)) return profile.role as UserRole;
  }

  const { data: collaboratorData, error: collaboratorError } = await supabase
    .from('collaborators')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (collaboratorError) console.log('Collaborator lookup error:', collaboratorError.message);
  if (collaboratorData && collaboratorData.status === 'active') return 'collaborator';

  const { data: driverData, error: driverError } = await supabase
    .from('drivers')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (driverError) console.log('Driver lookup error:', driverError.message);
  if (driverData) return 'driver';

  return 'customer';
}

export const useAuthStore = create<AuthState>((set, get) => {
  const resolveRole = (userId: string): Promise<void> => {
    const inFlight = roleRequests.get(userId);
    if (inFlight) return inFlight;

    set({ roleStatus: 'loading' });
    const request = (async () => {
      try {
        const role = await lookupRole(userId);
        if (get().user?.id !== userId) return;
        // Drops any persisted cart that belongs to a different account.
        await useCartStore.getState().claimForUser(userId);
        if (get().user?.id !== userId) return;
        set({ role, roleStatus: 'resolved' });
      } catch (error: any) {
        console.log('Role resolution failed:', error?.message ?? error);
        if (get().user?.id === userId) set({ role: null, roleStatus: 'error' });
      } finally {
        roleRequests.delete(userId);
      }
    })();
    roleRequests.set(userId, request);
    return request;
  };

  // Applies a session from any source and keeps user-scoped state consistent with it.
  const applySession = async (session: Session | null) => {
    const previousUserId = get().user?.id ?? null;
    const nextUserId = session?.user?.id ?? null;

    if (previousUserId !== nextUserId) {
      set({ session, user: session?.user ?? null, role: null, roleStatus: 'idle' });
      await resetUserScopedState({ keepPersistedCart: previousUserId === null });
      if (get().user?.id !== nextUserId) return;
      if (nextUserId) await resolveRole(nextUserId);
    } else {
      // Same user (e.g. TOKEN_REFRESHED): keep role, just update the session.
      set({ session, user: session?.user ?? null });
      if (nextUserId && get().roleStatus === 'idle') await resolveRole(nextUserId);
    }
  };

  return {
    session: null,
    user: null,
    role: null,
    roleStatus: 'idle',
    isLoading: true,

    initialize: () => {
      if (!authSubscription) {
        const { data } = supabase.auth.onAuthStateChange(
          (event: AuthChangeEvent, session: Session | null) => {
            // Supabase holds an auth lock while notifying listeners; calling the
            // client from inside the callback can deadlock, so defer the work.
            setTimeout(() => {
              void (async () => {
                await applySession(session);
                if (event === 'INITIAL_SESSION') set({ isLoading: false });
              })();
            }, 0);
          }
        );
        authSubscription = data.subscription;
      }
      return () => {
        authSubscription?.unsubscribe();
        authSubscription = null;
      };
    },

    signIn: async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error && data?.session) {
        await applySession(data.session);
      }
      return { error };
    },

    // Public sign-up always creates a customer. Driver, kitchen-staff and admin
    // accounts must be provisioned by an administrator through a trusted path.
    signUp: async (email: string, password: string, userData: any = {}) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (!error && data?.user) {
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert({
            user_id: data.user.id,
            full_name: userData.full_name || null,
            phone: userData.phone || null,
            role: 'customer',
            is_admin: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (insertError) {
          console.log('Profile creation error:', insertError);
        }

        // With email confirmation enabled data.session is null and the user
        // must verify their email, then sign in.
        if (data.session) {
          await applySession(data.session);
        }
      }
      return { error };
    },

    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        // supabase-js keeps the stored session when the revoke call fails
        // (e.g. offline), so the user is still signed in: report it instead
        // of showing a signed-out UI over a live session.
        return { error };
      }
      await applySession(null);
      return { error: null };
    },

    retryRoleResolution: async () => {
      const userId = get().user?.id;
      if (userId) await resolveRole(userId);
    },
  };
});
