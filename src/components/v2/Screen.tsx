import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../../theme';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}

// Canvas-coloured page with a top safe area. The pill tab bar sits below the
// screen in normal layout flow, so content never ends up hidden behind it.
export const Screen: React.FC<ScreenProps> = ({ children, scroll = false, contentStyle }) => (
  <SafeAreaView style={styles.safe} edges={['top']}>
    {scroll ? (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, contentStyle]}
      >
        {children}
      </ScrollView>
    ) : (
      <View style={[styles.fill, contentStyle]}>{children}</View>
    )}
  </SafeAreaView>
);

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
  },
  fill: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: theme.spacing['2xl'],
  },
});
