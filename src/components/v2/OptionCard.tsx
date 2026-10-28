import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface OptionCardProps {
  title: string;
  description?: string;
  icon?: IconName;
  selected: boolean;
  onPress: () => void;
}

// Selectable card used for single-choice questions (radio semantics).
export const OptionCard: React.FC<OptionCardProps> = ({ title, description, icon, selected, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ selected }}
    accessibilityLabel={description ? `${title}. ${description}` : title}
    style={[styles.card, selected && styles.cardSelected]}
  >
    {icon ? (
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        <Ionicons name={icon} size={22} color={selected ? theme.colors.textWhite : theme.colors.brand} />
      </View>
    ) : null}
    <View style={styles.text}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {selected ? <Ionicons name="checkmark" size={14} color={theme.colors.textWhite} /> : null}
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
  },
  cardSelected: {
    borderColor: theme.colors.brand,
    backgroundColor: theme.colors.brandSoft,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandSoft,
  },
  iconWrapSelected: {
    backgroundColor: theme.colors.brand,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  description: {
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: theme.colors.brand,
    backgroundColor: theme.colors.brand,
  },
});
