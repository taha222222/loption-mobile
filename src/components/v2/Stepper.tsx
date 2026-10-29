import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface StepperProps {
  label: string;
  value: string; // formatted value shown between the buttons
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
}

// Compact −/+ control (servings, times). Values are formatted by the caller.
export const Stepper: React.FC<StepperProps> = ({ label, value, onDecrease, onIncrease, canDecrease, canIncrease }) => (
  <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: value }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={(e) => {
      if (e.nativeEvent.actionName === 'increment' && canIncrease) onIncrease();
      if (e.nativeEvent.actionName === 'decrement' && canDecrease) onDecrease();
    }}
  >
    <Text style={styles.label}>{label}</Text>
    <View style={styles.controls}>
      <TouchableOpacity
        onPress={onDecrease}
        disabled={!canDecrease}
        style={[styles.button, !canDecrease && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={`Diminuer ${label}`}
        hitSlop={6}
      >
        <Ionicons name="remove" size={18} color={theme.colors.brand} />
      </TouchableOpacity>
      <Text style={styles.value}>{value}</Text>
      <TouchableOpacity
        onPress={onIncrease}
        disabled={!canIncrease}
        style={[styles.button, !canIncrease && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={`Augmenter ${label}`}
        hitSlop={6}
      >
        <Ionicons name="add" size={18} color={theme.colors.brand} />
      </TouchableOpacity>
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandSoft,
  },
  disabled: {
    opacity: 0.4,
  },
  value: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
});
