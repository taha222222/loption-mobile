import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { theme } from '../../src/theme';

export default function WebViewScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);

  const handleNavigationStateChange = (navState: any) => {
    // Check if user completed payment and is redirecting back
    if (navState.url.includes('loption://subscription/active')) {
      router.replace('/(app)');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Complete Subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#D4A757" />
          <Text style={styles.loadingText}>Loading secure payment...</Text>
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{ uri: url || 'https://loption.org/subscription.html' }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={handleNavigationStateChange}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        style={styles.webview}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1115',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    backgroundColor: '#0F1115',
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F1115',
    zIndex: 10,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: '#9CA3AF',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});