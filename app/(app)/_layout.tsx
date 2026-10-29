import { Tabs } from 'expo-router';
import { theme } from '../../src/theme';
import { RouteGate } from '../../src/components/navigation/RouteGate';
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
    <RouteGate group="(app)">
      <AppTabs />
    </RouteGate>
  );
}

function AppTabs() {
  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      // Back returns to the previous screen (e.g. log-meal -> nutrition).
      backBehavior="history"
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

      {/* Screens without a tab button. The pill bar draws only the five tabs
          above. Not `href: null`: in this Expo Router version that marks a
          route hidden, and hidden routes redirect instead of rendering. */}
      <Tabs.Screen name="my-plan" />
      <Tabs.Screen name="reorder" />
      <Tabs.Screen name="upgrade" />
      <Tabs.Screen name="checkout" />
      <Tabs.Screen name="order-tracking/[id]" />
      <Tabs.Screen name="nutrition" />
      <Tabs.Screen name="log-meal" />
      <Tabs.Screen name="nutrition-profile" />
      <Tabs.Screen name="nutrition-reminders" />
    </Tabs>
  );
}