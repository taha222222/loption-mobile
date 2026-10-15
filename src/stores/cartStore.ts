import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  calories: number;
  protein: number;
  image?: string;
  quantity: number;
  notes?: string;
}

interface CartState {
  items: CartItem[];
  // Auth user id the persisted cart belongs to; a cart is never shown to another account.
  ownerId: string | null;
  claimForUser: (userId: string) => Promise<void>;
  reset: () => void;
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateNotes: (id: string, notes: string) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
  getTotalCalories: () => number;
  getTotalProtein: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      ownerId: null,

      claimForUser: async (userId) => {
        await waitForCartHydration();
        if (get().ownerId !== userId) {
          set({ items: [], ownerId: userId });
        }
      },

      reset: () => {
        set({ items: [], ownerId: null });
      },

      addItem: (item) => {
        const existing = get().items.find((i) => i.id === item.id);
        if (existing) {
          set({
            items: get().items.map((i) =>
              i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
            ),
          });
        } else {
          set({ items: [...get().items, { ...item, quantity: 1 }] });
        }
      },

      removeItem: (id) => {
        set({ items: get().items.filter((i) => i.id !== id) });
      },

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          get().removeItem(id);
        } else {
          set({
            items: get().items.map((i) =>
              i.id === id ? { ...i, quantity } : i
            ),
          });
        }
      },

      updateNotes: (id, notes) => {
        set({
          items: get().items.map((i) =>
            i.id === id ? { ...i, notes } : i
          ),
        });
      },

      clearCart: () => {
        set({ items: [] });
      },

      getTotalPrice: () => {
        return get().items.reduce((total, item) => total + item.price * item.quantity, 0);
      },

      getTotalCalories: () => {
        return get().items.reduce((total, item) => total + item.calories * item.quantity, 0);
      },

      getTotalProtein: () => {
        return get().items.reduce((total, item) => total + item.protein * item.quantity, 0);
      },

      getItemCount: () => {
        return get().items.reduce((count, item) => count + item.quantity, 0);
      },
    }),
    {
      name: 'loption-cart',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items, ownerId: state.ownerId }),
      // v0 carts had no owner, so they cannot be attributed safely: start empty.
      version: 1,
      migrate: () => ({ items: [], ownerId: null }),
    }
  )
);

function waitForCartHydration(): Promise<void> {
  if (useCartStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useCartStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}