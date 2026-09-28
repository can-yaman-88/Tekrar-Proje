import { configureNotifications, useNotificationActions } from '@features/reminders';
import { ToastHost } from '@shared/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { installAppLifecycle } from '../bootstrap/lifecycle';
import { registerMutationDefaults } from '../bootstrap/mutationDefaults';
import { useAuthListener } from '../bootstrap/useAuthListener';
import { QueryProvider } from './QueryProvider';

installAppLifecycle();
registerMutationDefaults();
configureNotifications();

function AuthBridge() {
  useAuthListener();
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
