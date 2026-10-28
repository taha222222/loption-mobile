import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface StepProgressProps {
  step: number; // 1-based
  total: number;
}

export const StepProgress: React.FC<StepProgressProps> = ({ step, total }) => (
  <View
    style={styles.wrap}
    accessibilityRole="progressbar"
    accessibilityLabel={`Étape ${step} sur ${total}`}
    accessibilityValue={{ min: 1, max: total, now: step }}
  >
    <View style={styles.track}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.segment, i < step && styles.segmentDone]} />
      ))}
    </View>
    <Text style={styles.label}>{`Étape ${step} sur ${total}`}</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    gap: theme.spacing.sm,
  },
  track: {
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.hairline,
  },
  segmentDone: {
    backgroundColor: theme.colors.brand,
  },
  label: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
  },
});
