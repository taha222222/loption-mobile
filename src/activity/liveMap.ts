// src/activity/liveMap.ts
// Whether this build can show a real map behind the workout route, and the
// route split into stretches for drawing. iPhone: Apple Maps (no key).
// Android: Google Maps only when the build was made with a Maps key
// (app.config.js sets extra.liveMap.android); without it Google Maps would
// fail, so the route is drawn without a map. Web: no map.
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { RoutePoint } from './workoutSession';

export function liveMapAvailable(os: string = Platform.OS, extra: any = Constants.expoConfig?.extra): boolean {
  if (os === 'ios') return true;
  if (os === 'android') return extra?.liveMap?.android === true;
  return false;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

// Stretches separated by a GPS gap or a pause are drawn apart, never joined.
export function mapStretches(points: RoutePoint[]): LatLng[][] {
  const out: LatLng[][] = [];
  for (const p of points) {
    const c = { latitude: p.lat, longitude: p.lng };
    if (p.start || out.length === 0) out.push([c]);
    else out[out.length - 1].push(c);
  }
  return out.filter((s) => s.length > 1);
}

// A region showing the whole route (summary), with a margin; null without points.
export function routeRegion(points: RoutePoint[]): (LatLng & { latitudeDelta: number; longitudeDelta: number }) | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.004, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.004, (maxLng - minLng) * 1.4),
  };
}
