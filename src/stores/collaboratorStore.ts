import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface CollaboratorStats {
  totalRevenueToday: number;
  totalOrdersToday: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  deliveredOrders: number;
  collaboratorEarnings: number;
  loptionEarnings: number;
  acceptanceRate: number;
  avgPrepTime: number;
}

export interface CollaboratorOrder {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_address: string;
  order_total: number;
  collaborator_share: number;
  preparation_status: string;
  preparation_notes: string;
  created_at: string;
  items: any[];
}

export interface Payout {
  id: string;
  period_start: string;
  period_end: string;
  total_orders: number;
  total_revenue: number;
  collaborator_share: number;
  status: string;
  payout_amount: number;
  payout_date: string;
}

interface CollaboratorState {
  profile: any | null;
  stats: CollaboratorStats | null;
  orders: CollaboratorOrder[];
  payouts: Payout[];
  isLoading: boolean;
  
  fetchProfile: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchPayouts: () => Promise<void>;
  updateOrderStatus: (orderId: string, status: string, notes?: string) => Promise<void>;
  acceptOrder: (orderId: string) => Promise<void>;
  rejectOrder: (orderId: string, reason: string) => Promise<void>;
  markOrderReady: (orderId: string) => Promise<void>;
}

export const useCollaboratorStore = create<CollaboratorState>((set, get) => ({
  profile: null,
  stats: null,
  orders: [],
  payouts: [],
  isLoading: false,

  fetchProfile: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    
    const { data } = await supabase
      .from('collaborators')
      .select('*')
      .eq('user_id', session.user.id)
      .single();
    
    if (data) {
      set({ profile: data });
    }
  },

  fetchStats: async () => {
    set({ isLoading: true });
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    
    const { data: collaborator } = await supabase
      .from('collaborators')
      .select('id')
      .eq('user_id', session.user.id)
      .single();
    
    if (!collaborator) {
      set({ isLoading: false });
      return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data: todayOrders } = await supabase
      .from('collaborator_orders')
      .select('*, orders:order_id(total, status)')
      .eq('collaborator_id', collaborator.id)
      .gte('created_at', today.toISOString());
    
    const totalOrdersToday = todayOrders?.length || 0;
    const totalRevenueToday = todayOrders?.reduce((sum, o) => sum + o.order_total, 0) || 0;
    const collaboratorEarnings = todayOrders?.reduce((sum, o) => sum + o.collaborator_share, 0) || 0;
    const loptionEarnings = todayOrders?.reduce((sum, o) => sum + o.loption_share, 0) || 0;
    
    const pendingOrders = todayOrders?.filter(o => o.preparation_status === 'pending').length || 0;
    const preparingOrders = todayOrders?.filter(o => o.preparation_status === 'preparing').length || 0;
    const readyOrders = todayOrders?.filter(o => o.preparation_status === 'ready').length || 0;
    const deliveredOrders = todayOrders?.filter(o => o.orders?.status === 'delivered').length || 0;
    
    set({
      stats: {
        totalRevenueToday,
        totalOrdersToday,
        pendingOrders,
        preparingOrders,
        readyOrders,
        deliveredOrders,
        collaboratorEarnings,
        loptionEarnings,
        acceptanceRate: 98.5,
        avgPrepTime: 24,
      },
      isLoading: false,
    });
  },

  fetchOrders: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    
    const { data: collaborator } = await supabase
      .from('collaborators')
      .select('id')
      .eq('user_id', session.user.id)
      .single();
    
    if (!collaborator) return;
    
    const { data } = await supabase
      .from('collaborator_orders')
      .select(`
        *,
        orders:order_id (
          order_number,
          delivery_address,
          total,
          status,
          order_items (*)
        )
      `)
      .eq('collaborator_id', collaborator.id)
      .order('created_at', { ascending: false });
    
    if (data) {
      const formattedOrders = data.map((order: any) => ({
        id: order.id,
        order_id: order.order_id,
        order_number: order.orders?.order_number,
        customer_name: 'Customer',
        customer_address: order.orders?.delivery_address,
        order_total: order.order_total,
        collaborator_share: order.collaborator_share,
        preparation_status: order.preparation_status,
        preparation_notes: order.preparation_notes,
        created_at: order.created_at,
        items: order.orders?.order_items || [],
      }));
      set({ orders: formattedOrders });
    }
  },

  fetchPayouts: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    
    const { data: collaborator } = await supabase
      .from('collaborators')
      .select('id')
      .eq('user_id', session.user.id)
      .single();
    
    if (!collaborator) return;
    
    const { data } = await supabase
      .from('collaborator_payouts')
      .select('*')
      .eq('collaborator_id', collaborator.id)
      .order('period_start', { ascending: false });
    
    if (data) {
      set({ payouts: data });
    }
  },

  updateOrderStatus: async (orderId: string, status: string, notes?: string) => {
    const updateData: any = { preparation_status: status };
    if (notes) updateData.preparation_notes = notes;
    if (status === 'accepted') updateData.accepted_at = new Date().toISOString();
    if (status === 'preparing') updateData.preparing_at = new Date().toISOString();
    if (status === 'ready') updateData.ready_at = new Date().toISOString();
    
    await supabase
      .from('collaborator_orders')
      .update(updateData)
      .eq('id', orderId);
    
    await get().fetchOrders();
    await get().fetchStats();
  },

  acceptOrder: async (orderId: string) => {
    await get().updateOrderStatus(orderId, 'accepted');
  },

  rejectOrder: async (orderId: string, reason: string) => {
    await supabase
      .from('collaborator_orders')
      .update({
        preparation_status: 'rejected',
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    
    await get().fetchOrders();
    await get().fetchStats();
  },

  markOrderReady: async (orderId: string) => {
    await get().updateOrderStatus(orderId, 'ready');
  },
}));