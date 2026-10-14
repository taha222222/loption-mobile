import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type UserRole = 'customer' | 'driver' | 'collaborator' | 'admin';

interface AuthState {
  session: any | null;
  user: any | null;
  role: UserRole | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any | null }>;
  signUp: (email: string, password: string, role: UserRole, userData?: any) => Promise<{ error: any | null }>;
  signOut: () => Promise<void>;
  loadSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
  fetchUserRole: () => Promise<void>;
  clearRole: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  role: null,
  isLoading: true,

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error && data?.session) {
      set({ session: data.session, user: data.session.user });
      await get().fetchUserRole();
    }
    return { error };
  },

  signUp: async (email: string, password: string, role: UserRole, userData: any = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (!error && data?.user) {
      // Create user profile with role
      const { error: insertError } = await supabase
        .from('user_profiles')
        .insert({
          user_id: data.user.id,
          full_name: userData.full_name || null,
          phone: userData.phone || null,
          role: role,
          is_admin: role === 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.log('Profile creation error:', insertError);
      }

      // In Supabase v2 with email confirmation enabled, data.session is null
      // at signup time. The user must verify email and then sign in.
      set({ session: data.session ?? null, user: data.user, role });
    }
    return { error };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, role: null });
  },

  loadSession: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    set({
      session: session,
      user: session?.user ?? null,
      isLoading: false,
    });

    if (session?.user) {
      await get().fetchUserRole();
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
      if (session?.user) {
        get().fetchUserRole();
      }
    });
  },

  refreshSession: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    set({
      session: session,
      user: session?.user ?? null,
    });
    if (session?.user) {
      await get().fetchUserRole();
    }
  },

  fetchUserRole: async () => {
    const { user } = get();
    if (!user) {
      console.log('❌ No user found, skipping role fetch');
      set({ role: null });
      return;
    }

    console.log('🔍 Checking role for user:', user.id);

    try {
      // Check user_profiles for role
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role, is_admin')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        console.log('⚠️ Profile query error:', profileError.message);
      } else if (profile) {
        if (profile.role === 'admin' || profile.is_admin === true) {
          console.log('👑 Admin role confirmed');
          set({ role: 'admin' });
          return;
        }
        if (profile.role) {
          console.log('📋 Role from profile:', profile.role);
          set({ role: profile.role as UserRole });
          return;
        }
      }

      // Check collaborators table
      const { data: collaboratorData } = await supabase
        .from('collaborators')
        .select('id, branch_name, status')
        .eq('user_id', user.id)
        .maybeSingle();

      if (collaboratorData && collaboratorData.status === 'active') {
        console.log('🏪 Collaborator role detected');
        set({ role: 'collaborator' });
        return;
      }

      // Check drivers table
      const { data: driverData } = await supabase
        .from('drivers')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (driverData) {
        console.log('🚗 Driver role detected');
        set({ role: 'driver' });
        return;
      }

      // Default to customer
      console.log('👤 Defaulting to customer');
      set({ role: 'customer' });

    } catch (error) {
      console.error('❌ Error in fetchUserRole:', error);
      set({ role: 'customer' });
    }
  },

  clearRole: () => {
    set({ role: null });
  },
}));