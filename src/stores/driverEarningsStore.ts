import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface WeeklyEarning {
  id: string;
  week_start: string;
  week_end: string;
  total_deliveries: number;
  total_delivery_fees: number;
  commission_rate: number;
  commission_amount: number;
  payout_status: 'pending' | 'processing' | 'completed';
  payout_date: string | null;
}

interface DriverEarningsState {
  weeklyEarnings: WeeklyEarning[];
  currentWeekEarnings: number;
  totalEarnings: number;
  isLoading: boolean;
  fetchWeeklyEarnings: (driverId: string) => Promise<void>;
  calculateCommission: (deliveryFee: number) => number;
}

const COMMISSION_RATE = 0.15; // 15%

export const useDriverEarningsStore = create<DriverEarningsState>((set, get) => ({
  weeklyEarnings: [],
  currentWeekEarnings: 0,
  totalEarnings: 0,
  isLoading: false,

  calculateCommission: (deliveryFee: number) => {
    return deliveryFee * COMMISSION_RATE;
  },

  fetchWeeklyEarnings: async (driverId: string) => {
    set({ isLoading: true });
    
    // Get weekly earnings from database
    const { data } = await supabase
      .from('driver_weekly_earnings')
      .select('*')
      .eq('driver_id', driverId)
      .order('week_start', { ascending: false });
    
    if (data) {
      const total = data.reduce((sum, w) => sum + w.commission_amount, 0);
      set({ 
        weeklyEarnings: data,
        totalEarnings: total,
        currentWeekEarnings: data[0]?.commission_amount || 0
      });
    }
    
    set({ isLoading: false });
  },
}));