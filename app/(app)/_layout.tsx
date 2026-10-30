import { Tabs } from 'expo-router';
import { theme } from '../../src/theme';
import { RouteGate } from '../../src/components/navigation/RouteGate';
import { createPillTabBar } from '../../src/components/v2';
import { CUSTOMER_TABS } from '../../src/navigation/customerTabs';

const PillTabBar = createPillTabBar(CUSTOMER_TABS);

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
      <Tabs.Screen name="tracking" options={{ title: 'Suivi' }} />
      <Tabs.Screen name="orders" options={{ title: 'Commandes' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />

      {/* Screens without a tab button. The pill bar draws only the five tabs
          above. Not `href: null`: in this Expo Router version that marks a
          route hidden, and hidden routes redirect instead of rendering.
          The cart is opened from the basket in the Home and Menu headers. */}
      <Tabs.Screen name="cart" />
      <Tabs.Screen name="my-plan" />
      <Tabs.Screen name="reorder" />
      <Tabs.Screen name="upgrade" />
      <Tabs.Screen name="checkout" />
      <Tabs.Screen name="order-tracking/[id]" />
      <Tabs.Screen name="nutrition" />
      <Tabs.Screen name="log-meal" />
      <Tabs.Screen name="nutrition-profile" />
      <Tabs.Screen name="nutrition-reminders" />
      <Tabs.Screen name="workout" />
      <Tabs.Screen name="workout-history" />
      <Tabs.Screen name="activity-connect" />
    </Tabs>
  );
}