import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  children?: React.ReactNode;
}

// Round 44 pt header button (close, back, settings); `children` may add a badge.
export const IconButton: React.FC<IconButtonProps> = ({ icon, label, onPress, children }) => (
  <TouchableOpacity onPress={onPress} style={styles.button} accessibilityRole="button" accessibilityLabel={label}>
    <Ionicons name={icon} size={22} color={theme.colors.ink} />
    {children}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
});
