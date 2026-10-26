import { colors } from './colors';
import { spacing } from './spacing';
import { typography } from './typography';
import { shadows } from './shadows';
import { gradients } from './gradients';
import { radii } from './radii';

export const theme = {
  colors,
  spacing,
  typography,
  shadows,
  gradients,
  radii,
};

export type Theme = typeof theme;