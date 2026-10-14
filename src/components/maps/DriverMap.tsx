import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, Text } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

const { width, height } = Dimensions.get('window');

interface DriverMapProps {
  driverLocation: { latitude: number; longitude: number } | null;
  orderStatus: string;
  restaurantLocation?: { latitude: number; longitude: number };
}

export const DriverMap: React.FC<DriverMapProps> = ({
  driverLocation,
  orderStatus,
  restaurantLocation = { latitude: 33.5731, longitude: -7.5898 }, // Casablanca default
}) => {
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (mapReady && driverLocation) {
      // Center map on driver location
      mapRef.current?.animateToRegion({
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    }
  }, [driverLocation, mapReady]);

  const getStatusMessage = () => {
    switch (orderStatus) {
      case 'accepted':
        return 'Driver heading to restaurant...';
      case 'picked_up':
        return 'Driver picked up your order!';
      case 'on_the_way':
        return 'Driver is on the way to you!';
      case 'delivered':
        return 'Order delivered!';
      default:
        return 'Waiting for driver...';
    }
  };

  if (!driverLocation) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.gold} />
        <Text style={styles.loadingText}>Waiting for driver location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onMapReady={() => setMapReady(true)}
      >
        {/* Driver Marker */}
        <Marker
          coordinate={driverLocation}
          title="Driver"
          description={getStatusMessage()}
        >
          <View style={styles.driverMarker}>
            <Ionicons name="bicycle" size={24} color="#FFFFFF" />
          </View>
        </Marker>

        {/* Restaurant Marker */}
        <Marker
          coordinate={restaurantLocation}
          title="L'OPTION"
          description="Restaurant"
        >
          <View style={styles.restaurantMarker}>
            <Ionicons name="restaurant" size={20} color="#FFFFFF" />
          </View>
        </Marker>

        {/* Customer Marker (destination) - would need customer location */}
        {/* Add when customer shares location */}
      </MapView>

      {/* Status Overlay */}
      <View style={styles.statusOverlay}>
        <View style={styles.statusCard}>
          <Ionicons name="bicycle" size={20} color={theme.colors.gold} />
          <Text style={styles.statusText}>{getStatusMessage()}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 300,
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    width: '100%',
    height: 300,
    backgroundColor: theme.colors.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.spacing.lg,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textLight,
  },
  driverMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  restaurantMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  statusOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
  },
});