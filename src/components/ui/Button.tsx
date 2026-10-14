import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
variant?: 'primary' | 'gold' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  style,
  textStyle,
}) => {
const getBackgroundColor = () => {
  if (disabled) return theme.colors.border;
  switch (variant) {
    case 'primary':
      return theme.colors.primary;
    case 'gold':
      return theme.colors.gold;
    case 'secondary':
      return theme.colors.secondary;
    case 'danger':
      return theme.colors.error;      // <-- added
    case 'success':
      return theme.colors.success;    // <-- added
    case 'outline':
    case 'ghost':
      return 'transparent';
    default:
      return theme.colors.primary;
  }
};

  const getTextColor = () => {
    if (disabled) return theme.colors.textLight;
    switch (variant) {
      case 'outline':
      case 'ghost':
        return theme.colors.primary;
      case 'gold':
        return theme.colors.dark;
      default:
        return theme.colors.textWhite;
    }
  };

  const getBorderColor = () => {
    if (variant === 'outline') return theme.colors.primary;
    return 'transparent';
  };

  const sizeStyles = {
    sm: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
    md: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
    lg: { paddingHorizontal: theme.spacing['2xl'], paddingVertical: theme.spacing.lg },
  };

  const textSizeStyles = {
    sm: theme.typography.sizes.sm,
    md: theme.typography.sizes.md,
    lg: theme.typography.sizes.lg,
  };

  const isGradient = variant === 'gold';

  const content = (
    <>
      {loading && <ActivityIndicator color={getTextColor()} style={styles.loader} />}
      <Text
        style={[
          styles.text,
          { color: getTextColor(), fontSize: textSizeStyles[size] },
          textStyle,
        ]}
      >
        {title}
      </Text>
    </>
  );

  if (isGradient && !disabled) {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || loading}
        style={[sizeStyles[size], styles.gradientContainer, style]}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={theme.gradients.gold}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {content}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        sizeStyles[size],
        {
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderWidth: variant === 'outline' ? 1 : 0,
        },
        style,
      ]}
      activeOpacity={0.7}
    >
      {content}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  gradientContainer: {
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  gradient: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  text: {
    fontWeight: theme.typography.weights.medium,
  },
  loader: {
    marginRight: theme.spacing.sm,
  },
});