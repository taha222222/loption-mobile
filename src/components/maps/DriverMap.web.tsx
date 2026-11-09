// Web version of DriverMap. react-native-maps is a native-only library: its
// module cannot even be loaded in a browser, and the development server loads
// every screen at start-up, so importing it on the web stops the whole app.
// The bundler picks this file for the web; phones keep DriverMap.tsx.
// Same props and the same data: the position the driver shares, with a link
// that opens it in a map in the browser.
import React from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface DriverMapProps {
  driverLocation: { latitude: number; longitude: number } | null;
  orderStatus: string;
  restaurantLocation?: { latitude: number; longitude: number };
}

const STATUS_MESSAGE: Record<string, string> = {
  picked_up: 'Le livreur a récupéré votre commande.',
  on_the_way: 'Le livreur est en route vers vous.',
  delivered: 'Commande livrée.',
};

export const DriverMap: React.FC<DriverMapProps> = ({ driverLocation, orderStatus }) => {
  if (!driverLocation) {
    return (
      <View style={styles.box}>
        <ActivityIndicator size="large" color={theme.colors.gold} />
        <Text style={styles.text}>En attente de la position du livreur…</Text>
      </View>
    );
  }
  const { latitude, longitude } = driverLocation;
  const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  return (
    <View style={styles.box}>
      <Ionicons name="bicycle" size={32} color={theme.colors.gold} />
      <Text style={styles.title}>{STATUS_MESSAGE[orderStatus] ?? 'Livraison en cours.'}</Text>
      <Text style={styles.text}>
        Position du livreur : {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </Text>
      <Text style={styles.text}>La carte en direct est disponible dans l’application mobile.</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => void Linking.openURL(url)}
        accessibilityRole="link"
        accessibilityLabel="Voir la position du livreur sur une carte"
      >
        <Text style={styles.buttonText}>Voir sur une carte</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    width: '100%',
    minHeight: 200,
    backgroundColor: theme.colors.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    textAlign: 'center',
  },
  text: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textLight,
    textAlign: 'center',
  },
  button: {
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brandSoft,
  },
  buttonText: {
    color: theme.colors.brand,
    fontWeight: theme.typography.weights.semibold,
  },
});
