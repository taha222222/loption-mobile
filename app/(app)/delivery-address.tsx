// Change the delivery address from checkout. Same form as onboarding: the
// position may suggest an address, the customer confirms it; nothing is
// saved without "Enregistrer l’adresse".
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { IconButton } from '../../src/components/v2';
import { DeliveryAddressForm } from '../../src/components/checkout/DeliveryAddressForm';
import { theme } from '../../src/theme';

export default function DeliveryAddressScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <IconButton icon="arrow-back" label="Retour" onPress={() => router.back()} />
      </View>
      <DeliveryAddressForm
        hint="Le livreur vous livre à cette adresse ; les frais de livraison sont calculés depuis notre cuisine."
        onSaved={() => router.back()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.canvas },
  top: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md },
});
