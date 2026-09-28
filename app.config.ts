import type { ExpoConfig } from 'expo/config';

/**
 * Local backends are served over plain HTTP. Android release builds block
 * cleartext traffic by default, so testing against a LAN Supabase needs an
 * explicit opt-in at build time:
 *
 *   TEKRAR_ALLOW_CLEARTEXT=1 ./gradlew assembleRelease
 *
 * A hosted Supabase project is HTTPS and needs none of this — keep it off.
 */
const allowCleartext = process.env.TEKRAR_ALLOW_CLEARTEXT === '1';

const config: ExpoConfig = {
  name: 'Tekrar',
  slug: 'tekrar',
  scheme: 'tekrar',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.tekrar.app',
  },
  android: {
    package: 'com.tekrar.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#F6F7F9',
        dark: { backgroundColor: '#0E1116' },
      },
    ],
    [
      'expo-build-properties',
      {
        android: { usesCleartextTraffic: allowCleartext },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
