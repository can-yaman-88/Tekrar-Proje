import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@shared/api/supabase';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

let installed = false;

/**
 * Wires React Native lifecycle into React Query and Supabase auth:
 * - NetInfo drives onlineManager (paused queries resume on reconnect)
 * - AppState drives focusManager (refetch stale data on foreground)
 * - token auto-refresh runs only while the app is in the foreground
 * Idempotent; call once at startup.
 */
export function installAppLifecycle(): void {
  if (installed) return;
  installed = true;

  // Only the absence of a network interface counts as offline.
  //
  // NetInfo also reports `isInternetReachable`, which is a probe to an outside
  // URL. On mobile data that probe fails often enough — blocked, throttled,
  // slow under load — to flip the app "offline" mid-request on a connection
  // that is working. React Query then pauses the write, the student sees the
  // offline banner, and the request they started may still have reached the
  // server. A false "offline" costs far more than a late error does.
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );

  const onAppStateChange = (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
    if (status === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  };
  AppState.addEventListener('change', onAppStateChange);
  onAppStateChange(AppState.currentState);
}
