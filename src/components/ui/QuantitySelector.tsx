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
          color={quantity <= min ? theme.colors.textLight : theme.colors.textDark}
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
          color={quantity >= max ? theme.colors.textLight : theme.colors.textDark}
        />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  quantity: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textDark,
    minWidth: 30,
    textAlign: 'center',
  },
});