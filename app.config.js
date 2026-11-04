// Build-time additions to app.json (Expo reads app.json first, then this).
// Live workout map: iPhone uses Apple Maps (no key). Android uses Google Maps,
// which needs an API key restricted to com.loption.app + the signing
// certificate. The key is read from the build environment (EAS environment
// variable GOOGLE_MAPS_ANDROID_API_KEY, visibility "sensitive"), never from
// git and never from an EXPO_PUBLIC_ variable. Without it the Android build
// shows the route drawing without a map (extra.liveMap.android = false), so
// it never opens a Google map that would fail without a key.
module.exports = ({ config }) => {
  const androidKey = (process.env.GOOGLE_MAPS_ANDROID_API_KEY || '').trim();
  return {
    ...config,
    plugins: [...(config.plugins || []), ['react-native-maps', androidKey ? { androidGoogleMapsApiKey: androidKey } : {}]],
    extra: { ...config.extra, liveMap: { android: androidKey.length > 0 } },
  };
};
