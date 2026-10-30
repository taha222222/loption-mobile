import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { theme } from '../../theme';
import { useCartStore } from '../../stores/cartStore';
import { IconButton } from './IconButton';

// Header basket with a live item count. The cart is a screen without a tab
// button; its contents and add-to-cart are unchanged.
export const BasketButton: React.FC = () => {
  const count = useCartStore((s) => s.items.reduce((n, i) => n + i.quantity, 0));
  return (
    <IconButton
      icon="basket-outline"
      label={count > 0 ? `Panier, ${count} article${count > 1 ? 's' : ''}` : 'Panier vide'}
      onPress={() => router.push('/(app)/cart')}
    >
      {count > 0 ? (
        <View style={styles.badge} testID="basket-badge">
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </IconButton>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.highlight,
    borderWidth: 2,
    borderColor: theme.colors.canvas,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
  },
});
