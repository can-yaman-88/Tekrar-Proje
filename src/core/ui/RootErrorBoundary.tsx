import { reportError } from '@shared/api/telemetry';
import { ErrorState, Screen } from '@shared/ui';
import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';

/**
 * Expo Router renders this instead of a white screen when a screen throws.
 * Without it an unexpected render error would simply kill the app; with it
 * the student can try again, and the error is filed so it gets fixed.
 */
export function RootErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, { source: 'render' });
  }, [error]);

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
