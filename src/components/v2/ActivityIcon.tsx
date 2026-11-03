// L'OPTION activity icons: an original set drawn for the Daily Tracking
// experience (48-unit grid, one stroke weight, rounded ends), shown large
// on a soft rounded tile in the colour of its meaning.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { theme } from '../../theme';

export type ActivityIconName = 'steps' | 'walk' | 'run' | 'cycle' | 'gym' | 'calories' | 'meal' | 'distance' | 'time' | 'target';
export type ActivityTone = 'nutrition' | 'movement' | 'workout' | 'energy' | 'neutral';

export const TONES: Record<ActivityTone, { fg: string; bg: string }> = {
  nutrition: { fg: theme.colors.nutrition, bg: theme.colors.nutritionSoft },
  movement: { fg: theme.colors.movement, bg: theme.colors.movementSoft },
  workout: { fg: theme.colors.workout, bg: theme.colors.workoutSoft },
  energy: { fg: theme.colors.energy, bg: theme.colors.energySoft },
  neutral: { fg: theme.colors.ink, bg: theme.colors.canvas },
};

export const ICON_TONE: Record<ActivityIconName, ActivityTone> = {
  steps: 'movement',
  walk: 'workout',
  run: 'workout',
  cycle: 'workout',
  gym: 'workout',
  calories: 'energy',
  meal: 'nutrition',
  distance: 'movement',
  time: 'workout',
  target: 'energy',
};

const SW = 3.2; // stroke weight on the 48 grid

function Glyph({ name, color }: { name: ActivityIconName; color: string }) {
  const s = { stroke: color, strokeWidth: SW, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const f = { fill: color };
  switch (name) {
    case 'steps':
      return (
        <>
          <Ellipse cx={17} cy={20} rx={5.5} ry={8.5} {...s} />
          <Path d="M13.5 32.5h7" {...s} />
          <Ellipse cx={31} cy={14} rx={5.5} ry={8.5} {...s} />
          <Path d="M27.5 26.5h7" {...s} />
          <Circle cx={17} cy={38} r={2.4} {...f} />
          <Circle cx={31} cy={32} r={2.4} {...f} />
        </>
      );
    case 'walk':
      return (
        <>
          <Circle cx={26} cy={9} r={4} {...f} />
          <Path d="M24 17l-3 11 6 6 2 9" {...s} />
          <Path d="M21 28l-5 15" {...s} />
          <Path d="M23 18l-7 5v6M25 19l5 6 5 1" {...s} />
        </>
      );
    case 'run':
      return (
        <>
          <Circle cx={31} cy={8.5} r={4} {...f} />
          <Path d="M28 16l-6 10 7 5-2 11" {...s} />
          <Path d="M22 26l-9 4-3 6" {...s} />
          <Path d="M27 17l-9 1-4 6M29 17l4 7 7 1" {...s} />
          <Path d="M5 16h7M3 22h6" {...s} opacity={0.55} />
        </>
      );
    case 'cycle':
      return (
        <>
          <Circle cx={12} cy={32} r={8} {...s} />
          <Circle cx={36} cy={32} r={8} {...s} />
          <Path d="M12 32l8-13h12l4 13M20 19l6 13h-14M26 32l6-13" {...s} />
          <Path d="M18 15h5M31 14l2 5" {...s} />
        </>
      );
    case 'gym':
      return (
        <>
          <Path d="M14 24h20" {...s} />
          <Rect x={8} y={14} width={6} height={20} rx={2.5} {...s} />
          <Rect x={34} y={14} width={6} height={20} rx={2.5} {...s} />
          <Path d="M4 19v10M44 19v10" {...s} />
        </>
      );
    case 'calories':
      return (
        <>
          <Path d="M27 4L12 27h11l-3 17 16-24H25l2-16z" {...s} />
        </>
      );
    case 'meal':
      return (
        <>
          <Circle cx={24} cy={25} r={12} {...s} />
          <Circle cx={24} cy={25} r={6} {...s} opacity={0.55} />
          <Path d="M6 10v8a3 3 0 006 0v-8M9 18v22" {...s} />
          <Path d="M42 10c-4 2-5 7-5 13h5v17" {...s} />
        </>
      );
    case 'distance':
      return (
        <>
          <Path d="M10 38c6-12 10-4 15-14s9-12 13-12" {...s} />
          <Circle cx={10} cy={38} r={3.5} {...f} />
          <Path d="M38 6v12M38 6l6 3-6 3" {...s} />
        </>
      );
    case 'time':
      return (
        <>
          <Circle cx={24} cy={26} r={15} {...s} />
          <Path d="M24 17v9l6 4M20 5h8" {...s} />
        </>
      );
    case 'target':
      return (
        <>
          <Circle cx={24} cy={24} r={16} {...s} />
          <Circle cx={24} cy={24} r={9} {...s} />
          <Circle cx={24} cy={24} r={3} {...f} />
        </>
      );
  }
}

interface ActivityIconProps {
  name: ActivityIconName;
  size?: number; // tile size
  tone?: ActivityTone;
  bare?: boolean; // glyph only, no tile
  color?: string;
}

export const ActivityIcon: React.FC<ActivityIconProps> = ({ name, size = 56, tone, bare, color }) => {
  const t = TONES[tone ?? ICON_TONE[name]];
  const glyph = bare ? size : size * 0.6;
  const svg = (
    <Svg width={glyph} height={glyph} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      <Glyph name={name} color={color ?? t.fg} />
    </Svg>
  );
  if (bare) return svg;
  return <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.bg }]}>{svg}</View>;
};

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
