import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../theme';

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];
type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface PillTab {
  name: string;
  label: string;
  icon: IconName;
  activeIcon: IconName;
}

// Floating white pill nav. The active tab expands into an indigo pill with its
// label. It is rendered in normal layout flow (not absolutely positioned) so it
// never covers screen content.
export const createPillTabBar = (tabs: PillTab[]) =>
  function PillTabBar({ state, navigation }: TabBarProps) {
    const insets = useSafeAreaInsets();
    const activeName = state.routes[state.index]?.name;

    return (
      <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
        <View style={styles.bar}>
          {tabs.map((tab) => {
            const route = state.routes.find((r) => r.name === tab.name);
            if (!route) return null;
            const focused = activeName === tab.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            return (
              <TouchableOpacity
                key={tab.name}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.label}
                activeOpacity={0.85}
                style={[styles.item, focused && styles.itemActive]}
              >
                <Ionicons
                  name={focused ? tab.activeIcon : tab.icon}
                  size={22}
                  color={focused ? theme.colors.textWhite : theme.colors.inkMuted}
                />
                {focused ? (
                  <Text style={styles.label} numberOfLines={1}>
                    {tab.label}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

const styles = StyleSheet.create({
  outer: {
    backgroundColor: theme.colors.canvas,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 68,
    paddingHorizontal: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
    ...theme.shadows.soft,
  },
  item: {
    height: 52,
    width: 44,
    borderRadius: theme.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  itemActive: {
    width: 'auto',
    backgroundColor: theme.colors.brand,
    paddingHorizontal: 14,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
});
