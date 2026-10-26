import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

interface QuantitySelectorProps {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  min?: number;
  max?: number;
}

export const QuantitySelector: React.FC<QuantitySelectorProps> = ({
  quantity,
  onIncrease,
  onDecrease,
  min = 1,
  max = 99,
}) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={onDecrease}
        disabled={quantity <= min}
        style={[styles.button, quantity <= min && styles.buttonDisabled]}
      >
        <Ionicons
          name="remove"
          size={20}
          color={quantity <= min ? theme.colors.textLight : theme.colors.ink}
        />
      </TouchableOpacity>
      <Text style={styles.quantity}>{quantity}</Text>
      <TouchableOpacity
        onPress={onIncrease}
        disabled={quantity >= max}
        style={[styles.button, quantity >= max && styles.buttonDisabled]}
      >
        <Ionicons
          name="add"
          size={20}
          color={quantity >= max ? theme.colors.textLight : theme.colors.ink}
        />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.canvas,
    borderRadius: theme.radii.pill,
    padding: 4,
  },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  quantity: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    minWidth: 28,
    textAlign: 'center',
  },
});
