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

/**
 * Push notifications need the EAS project the build belongs to. Without it the
 * app still works and reminders stay local (scheduled on the device); with it
 * the server can reach the student even when the app has not been opened.
 *
 *   EAS_PROJECT_ID=<id from `npx eas-cli project:info`> npm run apk
 */
const easProjectId = process.env.EAS_PROJECT_ID;

/**
 * Android delivers push through FCM, which needs the Firebase project's
 * google-services.json in the build. Kept out of git; point at it when
 * building: GOOGLE_SERVICES_JSON=./google-services.json npm run apk
 */
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

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
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-secure-store',
    [
      'expo-notifications',
      {
        // Android draws the status-bar icon from its alpha channel alone.
        icon: './assets/notification-icon.png',
        color: '#3451D1',
        defaultChannel: 'reminders',
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission: 'Ders programını takviminden içe aktarmak için takvimini okur.',
        remindersPermission: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Değerlendirmene ödev ya da not fotoğrafı eklemek için galerini açar.',
        cameraPermission: 'Değerlendirmene ödev ya da not fotoğrafı çekip eklemek için kamerayı açar.',
        microphonePermission: false,
      },
    ],
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
  ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
};

export default config;
