// src/stores/checkoutDraftStore.ts
// Where the customer is in checkout and what they typed (step, promo code),
// kept in memory so that going back to the cart and returning keeps them.
// Never persisted, never a price: the server prices the order every time.
// Cleared after an order is placed and on sign-out (session reset).
import { create } from 'zustand';

export type CheckoutStep = 'address' | 'phone' | 'summary';

interface CheckoutDraft {
  step: CheckoutStep;
  promoCode: string | null; // a code the server accepted for this basket
  setStep: (step: CheckoutStep) => void;
  setPromoCode: (code: string | null) => void;
  reset: () => void;
}

export const useCheckoutDraftStore = create<CheckoutDraft>((set) => ({
  step: 'address',
  promoCode: null,
  setStep: (step) => set({ step }),
  setPromoCode: (promoCode) => set({ promoCode }),
  reset: () => set({ step: 'address', promoCode: null }),
}));
