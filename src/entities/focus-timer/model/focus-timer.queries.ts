import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { focusTimerLinkRepository, type FocusTimerDevice } from '../data/focus-timer-link.repository';

export const focusTimerKeys = {
  devices: ['focus-timer-link', 'devices'] as const,
};

/**
 * The Focus Timer is an Android app: only here can Tekrar open it directly.
 * Other devices are paired with a code, from any platform.
 */
export const focusTimerSupported = Platform.OS === 'android';

interface DevicesOptions {
  enabled?: boolean;
  /** Ask again every few seconds while this holds — a pairing code is out and no device has used it yet. */
  pollWhile?: (devices: FocusTimerDevice[] | undefined) => boolean;
}

/** Every device the timer is paired on, and when each last reported. */
export function useFocusTimerDevices({ enabled = true, pollWhile }: DevicesOptions = {}) {
  return useQuery({
    queryKey: focusTimerKeys.devices,
    queryFn: () => focusTimerLinkRepository.devices(),
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: pollWhile ? (query) => (pollWhile(query.state.data) ? 4_000 : false) : false,
  });
}
