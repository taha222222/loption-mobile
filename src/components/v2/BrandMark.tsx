import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../../theme';

// The L'OPTION "L with fork tines" mark on an indigo disc.
export const BrandMark: React.FC<{ size?: number }> = ({ size = 48 }) => {
  const u = size / 12;
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={{ width: u * 5, height: u * 6.4 }}>
        <View style={[styles.white, { left: 0, top: 0, width: u * 2.6, height: u * 6.4 }]} />
        <View style={[styles.white, { left: 0, top: u * 4.4, width: u * 5, height: u * 2 }]} />
        <View style={[styles.slit, { left: u * 0.75, top: 0, width: u * 0.35, height: u * 2.2 }]} />
        <View style={[styles.slit, { left: u * 1.5, top: 0, width: u * 0.35, height: u * 2.2 }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  disc: {
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  white: {
    position: 'absolute',
    backgroundColor: theme.colors.textWhite,
    borderRadius: 1,
  },
  slit: {
    position: 'absolute',
    backgroundColor: theme.colors.brand,
  },
});
