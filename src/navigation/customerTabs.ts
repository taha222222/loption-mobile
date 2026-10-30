// src/navigation/customerTabs.ts
// The five customer tabs. The cart is not a tab: it opens from the basket
// button in the Home and Menu headers (its screen and state are unchanged).
import type { PillTab } from '../components/v2';

export const CUSTOMER_TABS: PillTab[] = [
  { name: 'index', label: 'Accueil', icon: 'home-outline', activeIcon: 'home' },
  { name: 'menu', label: 'Repas', icon: 'restaurant-outline', activeIcon: 'restaurant' },
  { name: 'tracking', label: 'Suivi', icon: 'pulse-outline', activeIcon: 'pulse' },
  { name: 'orders', label: 'Commandes', icon: 'receipt-outline', activeIcon: 'receipt' },
  { name: 'profile', label: 'Profil', icon: 'person-outline', activeIcon: 'person' },
];
