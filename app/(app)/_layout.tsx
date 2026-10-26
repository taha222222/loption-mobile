import { Tabs } from 'expo-router';
import { theme } from '../../src/theme';
import { createPillTabBar } from '../../src/components/v2';

const PillTabBar = createPillTabBar([
  { name: 'index', label: 'Accueil', icon: 'home-outline', activeIcon: 'home' },
  { name: 'menu', label: 'Repas', icon: 'restaurant-outline', activeIcon: 'restaurant' },
  { name: 'cart', label: 'Panier', icon: 'cart-outline', activeIcon: 'cart' },
  { name: 'orders', label: 'Commandes', icon: 'receipt-outline', activeIcon: 'receipt' },
  { name: 'profile', label: 'Profil', icon: 'person-outline', activeIcon: 'person' },
]);

export default function AppLayout() {
  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.canvas },
      }}
    >
      {/* Customer Only Tabs */}
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="menu" options={{ title: 'Repas' }} />
      <Tabs.Screen name="cart" options={{ title: 'Panier' }} />
      <Tabs.Screen name="orders" options={{ title: 'Commandes' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />

      {/* Hidden Customer Screens */}
      <Tabs.Screen name="my-plan" options={{ href: null }} />
      <Tabs.Screen name="reorder" options={{ href: null }} />
      <Tabs.Screen name="upgrade" options={{ href: null }} />
      <Tabs.Screen name="checkout" options={{ href: null }} />
      <Tabs.Screen name="order-tracking/[id]" options={{ href: null }} />
      <Tabs.Screen name="progress" options={{ href: null }} />
    </Tabs>
  );
}