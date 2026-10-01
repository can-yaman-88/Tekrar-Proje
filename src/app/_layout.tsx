import { AppProviders } from '@core/index';
import { useSessionStore } from '@entities/session';
import { envError } from '@shared/config/env';
import { ErrorState, Screen, useTheme } from '@shared/ui';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const status = useSessionStore((s) => s.status);
  const theme = useTheme();

  useEffect(() => {
    if (status !== 'initializing') void SplashScreen.hideAsync();
  }, [status]);

  // Keep the native splash up until we know where to route.
  if (status === 'initializing') return null;
  const signedIn = status === 'signedIn';

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (envError) void SplashScreen.hideAsync();
  }, []);

  if (envError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ErrorState title="Uygulama yapılandırılmamış" message={envError} />
      </Screen>
    );
  }

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

/** Expo Router shows this when a screen throws; it lives in core with the rest of the app shell. */
export { RootErrorBoundary as ErrorBoundary } from '@core/index';
