import { configureNotifications, useNotificationActions } from '@features/reminders';
import { ToastHost } from '@shared/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';
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

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthBridge />
        <View style={{ flex: 1 }}>
          {children}
          <ToastHost />
        </View>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
