import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lineKey, unitPrice, type ChosenOption } from '../menu/customization';

// One cart line = one meal with one set of choices. `id` is the line id
// (the meal id when there is no choice); prices are for display only: the
// server prices the order from the menu (create_order / checkout_preview).
export interface CartItem {
  id: string;
  mealId: string;
  name: string;
  basePrice: number;
  price: number; // unit price shown: base + choices
  options: ChosenOption[];
  calories: number;
  protein: number;
  image?: string;
  quantity: number;
  notes?: string;
}

// What a screen adds: the meal (id = meal id) and, optionally, its choices.
export interface CartItemInput {
  id: string;
  name: string;
  price: number; // the meal's base price
  calories: number;
  protein: number;
  image?: string;
  options?: ChosenOption[];
  notes?: string;
}

const toLine = (item: CartItemInput, quantity: number): CartItem => {
  const options = item.options ?? [];
  return {
    id: lineKey(item.id, options.map((o) => o.id)),
    mealId: item.id,
    name: item.name,
    basePrice: item.price,
    price: unitPrice(item.price, options),
    options,
    calories: item.calories,
    protein: item.protein,
    image: item.image,
    quantity,
    notes: item.notes?.trim() ? item.notes.trim() : undefined,
  };
};

interface CartState {
  items: CartItem[];
  // Auth user id the persisted cart belongs to; a cart is never shown to another account.
  ownerId: string | null;
  claimForUser: (userId: string) => Promise<void>;
  reset: () => void;
  addItem: (item: CartItemInput, quantity?: number) => void;
  // Edit a line (choices, quantity, note); merges with an identical line.
  replaceItem: (lineId: string, item: CartItemInput, quantity: number) => void;
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

      addItem: (item, quantity = 1) => {
        const line = toLine(item, Math.max(1, Math.min(20, quantity)));
        const existing = get().items.find((i) => i.id === line.id);
        if (existing) {
          set({
            items: get().items.map((i) =>
              i.id === line.id ? { ...i, quantity: Math.min(20, i.quantity + line.quantity), notes: line.notes ?? i.notes } : i
            ),
          });
        } else {
          set({ items: [...get().items, line] });
        }
      },

      replaceItem: (lineId, item, quantity) => {
        const line = toLine(item, Math.max(1, Math.min(20, quantity)));
        const others = get().items.filter((i) => i.id !== lineId);
        const twin = others.find((i) => i.id === line.id);
        if (twin) {
          set({ items: others.map((i) => (i.id === line.id ? { ...i, quantity: Math.min(20, i.quantity + line.quantity) } : i)) });
          return;
        }
        const index = get().items.findIndex((i) => i.id === lineId);
        const items = [...others];
        items.splice(index < 0 ? items.length : index, 0, line);
        set({ items });
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
              i.id === id ? { ...i, quantity: Math.min(20, quantity) } : i
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

      // Display subtotal, summed in centimes.
      getTotalPrice: () => {
        return get().items.reduce((total, item) => total + Math.round(item.price * 100) * item.quantity, 0) / 100;
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
      // v1 lines had no choices: kept as lines of the meal without choices.
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { items?: Partial<CartItem>[]; ownerId?: string | null } | undefined;
        if (version < 1 || !state) return { items: [], ownerId: null };
        const items = (state.items ?? []).map((i) => ({
          ...i,
          mealId: i.mealId ?? i.id,
          basePrice: i.basePrice ?? i.price,
          options: i.options ?? [],
        })) as CartItem[];
        return { items, ownerId: state.ownerId ?? null };
      },
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