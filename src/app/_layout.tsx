import { AppProviders } from '@core/index';
import { useSessionStore } from '@entities/session';
import { envError } from '@shared/config/env';
import { ErrorState, Screen, useTheme } from '@shared/ui';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
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

/**
 * Expo Router renders this instead of a white screen when a screen throws.
 * Without it an unexpected render error would simply kill the app.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <Screen edges={['top', 'bottom']}>
      <ErrorState
        title="Beklenmeyen bir hata oluştu"
        message={__DEV__ ? error.message : 'Ekran yüklenemedi. Tekrar denemek uygulamayı kurtarabilir.'}
        actionLabel="Tekrar dene"
        onAction={() => void retry()}
      />
    </Screen>
  );
}
