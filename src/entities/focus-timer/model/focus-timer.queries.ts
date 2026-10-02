import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { focusTimerLinkRepository } from '../data/focus-timer-link.repository';

export const focusTimerKeys = {
  status: ['focus-timer-link', 'status'] as const,
};

/** The Focus Timer is an Android app; elsewhere there is nothing to link. */
export const focusTimerSupported = Platform.OS === 'android';

/** Whether a timer is paired with this account, and when it last reported. */
export function useFocusTimerLinkStatus() {
  return useQuery({
    queryKey: focusTimerKeys.status,
    queryFn: () => focusTimerLinkRepository.status(),
    enabled: focusTimerSupported,
    staleTime: 5 * 60_000,
  });
}
