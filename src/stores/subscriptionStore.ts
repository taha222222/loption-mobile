import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface Subscription {
  id: string;
  user_id: string;
  tier: 'meals_only' | 'coaching' | 'transformation' | 'premium' | 'ultimate';
  status: 'active' | 'paused' | 'expired' | 'cancelled';
  start_date: string;
  end_date: string;
  auto_renew: boolean;
}

interface SubscriptionState {
  subscription: Subscription | null;
  isLoading: boolean;
  fetchSubscription: (userId: string) => Promise<void>;
  checkAccess: (feature: string) => boolean;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscription: null,
  isLoading: false,

  fetchSubscription: async (userId: string) => {
    set({ isLoading: true });
    
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!error && data) {
      set({ subscription: data as Subscription });
    } else {
      set({ subscription: null });
    }
    
    set({ isLoading: false });
  },

  checkAccess: (feature: string) => {
    const { subscription } = get();
    if (!subscription) return false;

    // Define feature access per tier
    const access: Record<string, string[]> = {
      premium_meals: ['premium', 'ultimate'],
      coaching: ['coaching', 'transformation', 'premium', 'ultimate'],
      ai_scanner: ['transformation', 'ultimate'],
      unlimited_swaps: ['transformation', 'ultimate'],
    };

    const allowedTiers = access[feature] || [];
    return allowedTiers.includes(subscription.tier);
  },
}));