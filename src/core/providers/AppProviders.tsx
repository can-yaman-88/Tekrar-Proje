import { useSessionStore } from '@entities/session';
import { HomeWidgetSync } from '@features/home-widget';
import { configureNotifications, useNotificationActions } from '@features/reminders';
import { ToastHost } from '@shared/ui';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { installErrorReporting, useFlushPendingCrash } from '../bootstrap/errorReporting';
import { installAppLifecycle } from '../bootstrap/lifecycle';
import { registerMutationDefaults } from '../bootstrap/mutationDefaults';
import { useAuthListener } from '../bootstrap/useAuthListener';
import { useTimezoneSync } from '../bootstrap/useTimezoneSync';
import { QueryProvider } from './QueryProvider';

installErrorReporting();
installAppLifecycle();
registerMutationDefaults();
configureNotifications();

function AuthBridge() {
  useAuthListener();
  useFlushPendingCrash();
  useTimezoneSync();
  useNotificationActions();
  return null;
}

/** The home-screen widget follows the app's data while a student is signed in. */
function WidgetBridge() {
  const signedIn = useSessionStore((s) => s.status === 'signedIn');
  return Platform.OS === 'android' && signedIn ? <HomeWidgetSync /> : null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthBridge />
        <WidgetBridge />
        <View style={{ flex: 1 }}>
          {children}
          <ToastHost />
        </View>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
