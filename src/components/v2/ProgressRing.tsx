import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../../theme';

interface ProgressRingProps {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}

// Circular progress drawn with clipped, rotated half-rings (no SVG dependency).
// Each half clips to one side of the ring; a coloured semicircle inside it is
// rotated into view as progress grows.
export const ProgressRing: React.FC<ProgressRingProps> = ({
  progress,
  size = 120,
  stroke = 12,
  color = theme.colors.highlight,
  trackColor = theme.colors.brandRingTrack,
  children,
}) => {
  const p = Math.min(Math.max(progress, 0), 1);
  const half = size / 2;
  const ring = { width: size, height: size, borderRadius: half, borderWidth: stroke };

  // Semicircle on the left side (180°..360°), rotated clockwise to reveal 0..p on the right.
  const rightDeg = Math.min(p * 360, 180);
  // Semicircle on the right side (0°..180°), rotated to reveal 180°..p on the left.
  const leftDeg = p * 360 - 180;

  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.abs, ring, { borderColor: trackColor }]} />

      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <View
          style={[
            styles.abs,
            ring,
            {
              left: -half,
              borderColor: 'transparent',
              borderBottomColor: color,
              borderLeftColor: color,
              transform: [{ rotate: `${45 + rightDeg}deg` }],
            },
          ]}
        />
      </View>

      {p > 0.5 && (
        <View style={[styles.clip, { left: 0, width: half, height: size }]}>
          <View
            style={[
              styles.abs,
              ring,
              {
                left: 0,
                borderColor: 'transparent',
                borderTopColor: color,
                borderRightColor: color,
                transform: [{ rotate: `${45 + leftDeg}deg` }],
              },
            ]}
          />
        </View>
      )}

      <View style={[styles.abs, styles.center, { width: size, height: size }]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  abs: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  clip: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
