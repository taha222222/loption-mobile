import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { formatNumber } from './format';

interface MacroBarProps {
  label: string;
  value: number;
  target: number;
  color: string;
}

// Macro row for the indigo energy card: label, thin bar, "value / target g".
export const MacroBar: React.FC<MacroBarProps> = ({ label, value, target, color }) => {
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
      {/* Non-breaking spaces keep "479 g" together; on narrow screens the
          target wraps under the value instead of being cut off. */}
      <Text style={styles.value}>
        <Text style={styles.valueStrong}>{formatNumber(value)}</Text>
        {` /\u00A0${formatNumber(target)}\u00A0g`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandOnDark,
  },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.brandTrack,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  value: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.brandOnDark,
  },
  valueStrong: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.textWhite,
  },
});
