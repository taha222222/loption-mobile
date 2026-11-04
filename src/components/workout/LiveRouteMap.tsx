// Live workout map: the customer's position (the system's own location dot),
// the route drawn as it grows, and automatic centring that stops when the
// customer moves the map ("Recentrer" brings it back). The route comes only
// from accepted GPS points (src/activity/gps.ts): nothing is drawn for a gap,
// a pause or a missing position. On a build without a map (Android without
// a Maps key, web, tests) the same route is drawn without map tiles.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { RouteSketch } from '../v2';
import { liveMapAvailable, mapStretches, routeRegion, type LatLng } from '../../activity/liveMap';
import type { RoutePoint } from '../../activity/workoutSession';

// Loaded only where a map can be shown (no native view on web or in tests).
let Maps: any = null;
function maps(): any {
  if (Maps === null) {
    try {
      Maps = require('react-native-maps');
    } catch {
      Maps = false;
    }
  }
  return Maps || null;
}

const FOLLOW_DELTA = 0.006; // ≈ 650 m across: a street-level view

interface Props {
  route: RoutePoint[];
  // Position to centre on before any route point exists (pre-start fix).
  position?: LatLng | null;
  follow?: boolean; // live: keep the latest position in view
  height: number;
  overview?: boolean; // summary: fit the whole route, no following
  placeholder?: string; // shown when there is nothing to draw yet
}

export const LiveRouteMap: React.FC<Props> = ({ route, position = null, follow = true, height, overview = false, placeholder }) => {
  const lib = liveMapAvailable() ? maps() : null;
  const mapRef = useRef<any>(null);
  const [following, setFollowing] = useState(follow && !overview);
  const [userPos, setUserPos] = useState<LatLng | null>(null);
  const stretches = useMemo(() => mapStretches(route), [route]);
  const last = route.length ? { latitude: route[route.length - 1].lat, longitude: route[route.length - 1].lng } : null;
  const target = last ?? userPos ?? position;

  useEffect(() => {
    if (!lib || !following || !target || overview) return;
    mapRef.current?.animateToRegion?.({ ...target, latitudeDelta: FOLLOW_DELTA, longitudeDelta: FOLLOW_DELTA }, 400);
  }, [lib, following, overview, target?.latitude, target?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lib) {
    return (
      <View style={[styles.box, styles.sketch, { minHeight: Math.min(height, 200) }]}>
        {route.length > 1 ? (
          <RouteSketch points={route} height={Math.min(height, 200) - 16} width={300} />
        ) : (
          <Text style={styles.placeholder}>{placeholder ?? 'Votre parcours s’affichera ici.'}</Text>
        )}
      </View>
    );
  }

  const { default: MapView, Polyline, Marker } = lib;
  const region = overview ? routeRegion(route) : null;
  const initial = region ?? (target ? { ...target, latitudeDelta: FOLLOW_DELTA, longitudeDelta: FOLLOW_DELTA } : undefined);
  const startPoint = route.length ? { latitude: route[0].lat, longitude: route[0].lng } : null;

  return (
    <View style={[styles.box, { height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initial}
        showsUserLocation={!overview}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        onUserLocationChange={(e: any) => {
          const c = e?.nativeEvent?.coordinate;
          if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) setUserPos({ latitude: c.latitude, longitude: c.longitude });
        }}
        onPanDrag={() => setFollowing(false)}
        accessibilityLabel="Carte de votre parcours"
      >
        {stretches.map((coords, i) => (
          <Polyline key={i} coordinates={coords} strokeColor={theme.colors.workout} strokeWidth={5} lineCap="round" lineJoin="round" />
        ))}
        {startPoint ? <Marker coordinate={startPoint} pinColor={theme.colors.movement} title="Départ" tracksViewChanges={false} /> : null}
        {overview && last ? <Marker coordinate={last} pinColor={theme.colors.nutrition} title="Arrivée" tracksViewChanges={false} /> : null}
      </MapView>
      {!overview && !following && target ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Recentrer la carte sur votre position"
          onPress={() => setFollowing(true)}
          style={styles.recenter}
        >
          <Ionicons name="locate" size={20} color={theme.colors.workout} />
          <Text style={styles.recenterText}>Recentrer</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
    backgroundColor: theme.colors.canvas,
  },
  sketch: { alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.sm },
  placeholder: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, textAlign: 'center', paddingHorizontal: theme.spacing.lg },
  recenter: {
    position: 'absolute',
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    ...theme.shadows.md,
  },
  recenterText: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.semibold, color: theme.colors.workout },
});
