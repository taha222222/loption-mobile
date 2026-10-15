import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface AdminStats {
  totalOrdersToday: number;
  revenueToday: number;
  pendingDrivers: number;
  activeDrivers: number;
  totalMeals: number;
  totalDeliveries: number;
}

export interface PendingDriver {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  national_id: string;
  status: string;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  total: number;
  status: string;
  delivery_address: string;
  created_at: string;
  driver_name?: string;
  driver_id?: string;
}

export interface Meal {
  id: string;
  name: string;
  price: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  popular: boolean;
  image_url: string | null;
  available: boolean;
}

interface AdminState {
  stats: AdminStats | null;
  pendingDrivers: PendingDriver[];
  activeDrivers: PendingDriver[];
  orders: Order[];
  meals: Meal[];
  isLoading: boolean;
  
  // Data fetching
  fetchStats: () => Promise<void>;
  fetchPendingDrivers: () => Promise<void>;
  fetchActiveDrivers: () => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchMeals: () => Promise<void>;
  
  // Actions
  approveDriver: (driverId: string) => Promise<void>;
  rejectDriver: (driverId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: string, driverId?: string) => Promise<void>;
  addMeal: (meal: Omit<Meal, 'id'>) => Promise<void>;
  updateMeal: (id: string, meal: Partial<Meal>) => Promise<void>;
  deleteMeal: (id: string) => Promise<void>;
  logAdminAction: (action: string, details: any) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  stats: null,
  pendingDrivers: [],
  activeDrivers: [],
  orders: [],
  meals: [],
  isLoading: false,

  fetchStats: async () => {
    set({ isLoading: true });
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get today's orders
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('total')
        .gte('created_at', today.toISOString());
      
      const totalOrdersToday = todayOrders?.length || 0;
      const revenueToday = todayOrders?.reduce((sum, o) => sum + o.total, 0) || 0;
      
      // Get pending drivers
      const { count: pendingDrivers } = await supabase
        .from('drivers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      // Get active drivers
      const { count: activeDrivers } = await supabase
        .from('drivers')
        .select('*', { count: 'exact', head: true })
        .in('status', ['online', 'offline']);
      
      // Get total meals
      const { count: totalMeals } = await supabase
        .from('meals')
        .select('*', { count: 'exact', head: true });
      
      // Get total deliveries (all time)
      const { count: totalDeliveries } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'delivered');
      
      set({
        stats: {
          totalOrdersToday,
          revenueToday,
          pendingDrivers: pendingDrivers || 0,
          activeDrivers: activeDrivers || 0,
          totalMeals: totalMeals || 0,
          totalDeliveries: totalDeliveries || 0,
        },
        isLoading: false,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
      set({ isLoading: false });
    }
  },

  fetchPendingDrivers: async () => {
    try {
      const { data } = await supabase
        .from('drivers')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      
      if (data) {
        set({ pendingDrivers: data });
      }
    } catch (err) {
      console.error('Error fetching pending drivers:', err);
    }
  },

  fetchActiveDrivers: async () => {
    try {
      const { data } = await supabase
        .from('drivers')
        .select('*')
        .in('status', ['online', 'offline'])
        .order('created_at', { ascending: false });
      
      if (data) {
        set({ activeDrivers: data });
      }
    } catch (err) {
      console.error('Error fetching active drivers:', err);
    }
  },

  fetchOrders: async () => {
    try {
      const { data } = await supabase
        .from('orders')
        .select(`
          *,
          drivers:driver_id (first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (data) {
        const formattedOrders = data.map((order: any) => ({
          id: order.id,
          order_number: order.order_number,
          customer_name: 'Customer',
          customer_email: '',
          total: order.total,
          status: order.status,
          delivery_address: order.delivery_address,
          created_at: order.created_at,
          driver_name: order.drivers?.first_name 
            ? `${order.drivers.first_name} ${order.drivers.last_name}`
            : 'Unassigned',
          driver_id: order.driver_id,
        }));
        set({ orders: formattedOrders });
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  },

  fetchMeals: async () => {
    try {
      const { data } = await supabase
        .from('meals')
        .select('*')
        .order('name', { ascending: true });
      
      if (data) {
        set({ meals: data });
      }
    } catch (err) {
      console.error('Error fetching meals:', err);
    }
  },

  approveDriver: async (driverId: string) => {
    try {
      const { error } = await supabase
        .from('drivers')
        .update({
          status: 'offline',
          updated_at: new Date().toISOString(),
        })
        .eq('id', driverId);
      
      if (!error) {
        await get().fetchPendingDrivers();
        await get().fetchActiveDrivers();
        await get().logAdminAction('approve_driver', { driverId });
      }
    } catch (err) {
      console.error('Error approving driver:', err);
    }
  },

  rejectDriver: async (driverId: string) => {
    try {
      const { error } = await supabase
        .from('drivers')
        .update({ status: 'rejected' })
        .eq('id', driverId);
      
      if (!error) {
        await get().fetchPendingDrivers();
        await get().logAdminAction('reject_driver', { driverId });
      }
    } catch (err) {
      console.error('Error rejecting driver:', err);
    }
  },

  updateOrderStatus: async (orderId: string, status: string, driverId?: string) => {
    try {
      const updateData: any = { status };
      if (driverId) updateData.driver_id = driverId;
      
      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);
      
      if (!error) {
        await get().fetchOrders();
        await get().fetchStats();
        await get().logAdminAction('update_order_status', { orderId, status, driverId });
      }
    } catch (err) {
      console.error('Error updating order status:', err);
    }
  },

  addMeal: async (meal: Omit<Meal, 'id'>) => {
    try {
      const { error } = await supabase
        .from('meals')
        .insert({
          name: meal.name,
          price: meal.price,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          category: meal.category,
          popular: meal.popular,
          image_url: meal.image_url,
          available: true,
        });
      
      if (!error) {
        await get().fetchMeals();
        await get().fetchStats();
        await get().logAdminAction('add_meal', { meal });
      }
    } catch (err) {
      console.error('Error adding meal:', err);
    }
  },

  updateMeal: async (id: string, meal: Partial<Meal>) => {
    try {
      const { error } = await supabase
        .from('meals')
        .update(meal)
        .eq('id', id);
      
      if (!error) {
        await get().fetchMeals();
        await get().logAdminAction('update_meal', { id, meal });
      }
    } catch (err) {
      console.error('Error updating meal:', err);
    }
  },

  deleteMeal: async (id: string) => {
    try {
      const { error } = await supabase
        .from('meals')
        .delete()
        .eq('id', id);
      
      if (!error) {
        await get().fetchMeals();
        await get().fetchStats();
        await get().logAdminAction('delete_meal', { id });
      }
    } catch (err) {
      console.error('Error deleting meal:', err);
    }
  },

  logAdminAction: async (action: string, details: any) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      await supabase
        .from('admin_logs')
        .insert({
          admin_id: session.user.id,
          action,
          details,
          created_at: new Date().toISOString(),
        });
    } catch (err) {
      console.error('Error logging admin action:', err);
    }
  },
}));