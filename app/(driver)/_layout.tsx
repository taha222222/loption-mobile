import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { RouteGate } from '../../src/components/navigation/RouteGate';

export default function DriverLayout() {
  return (
    <RouteGate group="(driver)">
      <DriverTabs />
    </RouteGate>
  );
}

function DriverTabs() {
  return (
    <Tabs
      // Back from an order returns to the dashboard or history it was opened from.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.border,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: theme.colors.gold,
        tabBarInactiveTintColor: theme.colors.textLight,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}
    >
      {/* Driver Only Tabs */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color as string} />
          ),
        }}
      />

      {/* Order screen without a tab button. Not `href: null`: in this Expo
          Router version that marks the route hidden, and hidden routes
          redirect (to the first tab) instead of rendering. */}
      <Tabs.Screen name="delivery/[id]" options={{ title: 'Delivery', tabBarItemStyle: { display: 'none' } }} />
    </Tabs>
  );
}