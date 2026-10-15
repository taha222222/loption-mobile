import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCartStore } from '../src/stores/cartStore';

describe('cart persistence', () => {
  it('discards legacy (unowned, v0) carts instead of attributing them to whoever signs in', async () => {
    await AsyncStorage.setItem(
      'loption-cart',
      JSON.stringify({ state: { items: [{ id: 'm', name: 'x', price: 1, calories: 1, protein: 1, quantity: 2 }] }, version: 0 })
    );
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState()).toMatchObject({ items: [], ownerId: null });
  });
});
