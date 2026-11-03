// The shape of a workout route, drawn from the GPS points kept on this
// device (no map tiles, no address, nothing uploaded). Stretches separated
// by a GPS gap or a pause are drawn apart, never joined by a straight line.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { theme } from '../../theme';
import type { RoutePoint } from '../../activity/workoutSession';

export function routeStretches(points: RoutePoint[], width: number, height: number, pad = 12): string[] {
  if (points.length < 2) return [];
  const lat0 = points[0].lat;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p.lng * kx);
  const ys = points.map((p) => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const scale = Math.min(width - 2 * pad, height - 2 * pad) / span;
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const stretches: string[][] = [];
  points.forEach((p, i) => {
    const xy = `${(ox + (xs[i] - minX) * scale).toFixed(1)},${(oy + (maxY - ys[i]) * scale).toFixed(1)}`;
    if (p.start || stretches.length === 0) stretches.push([xy]);
    else stretches[stretches.length - 1].push(xy);
  });
  return stretches.filter((s) => s.length > 1).map((s) => s.join(' '));
}

export const RouteSketch: React.FC<{ points: RoutePoint[]; height?: number; width?: number }> = ({ points, height = 160, width = 300 }) => {
  const stretches = routeStretches(points, width, height);
  if (stretches.length === 0) return null;
  const first = stretches[0].split(' ')[0].split(',').map(Number);
  const lastS = stretches[stretches.length - 1].split(' ');
  const last = lastS[lastS.length - 1].split(',').map(Number);
  return (
    <View style={styles.box} accessibilityLabel="Tracé de la séance">
      <Svg width={width} height={height}>
        {stretches.map((d, i) => (
          <Polyline key={i} points={d} fill="none" stroke={theme.colors.workout} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        <Circle cx={first[0]} cy={first[1]} r={6} fill={theme.colors.movement} />
        <Circle cx={last[0]} cy={last[1]} r={6} fill={theme.colors.nutrition} />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    backgroundColor: theme.colors.canvas,
    borderRadius: theme.radii.lg,
    paddingVertical: theme.spacing.sm,
  },
});
