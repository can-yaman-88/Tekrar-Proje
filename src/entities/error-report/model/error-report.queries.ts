import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorReportRepository } from '../data/error-report.repository';

export const errorReportKeys = {
  all: ['error-reports'] as const,
  isAdmin: () => ['error-reports', 'is-admin'] as const,
  live: (days: number) => ['error-reports', 'live', days] as const,
  stored: () => ['error-reports', 'stored'] as const,
  group: (fingerprint: string) => ['error-reports', 'group', fingerprint] as const,
};

/** Admin status rarely changes; a day of cache keeps the settings screen quiet. */
export function useIsAdmin() {
  return useQuery({
    queryKey: errorReportKeys.isAdmin(),
    queryFn: () => errorReportRepository.isAdmin(),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useLiveErrorDigest(days: number, enabled = true) {
  return useQuery({
    queryKey: errorReportKeys.live(days),
    queryFn: () => errorReportRepository.liveDigest(days),
    enabled,
  });
}

export function useStoredErrorDigests(enabled = true) {
  return useQuery({
    queryKey: errorReportKeys.stored(),
    queryFn: () => errorReportRepository.storedDigests(),
    enabled,
  });
}

export function useErrorGroup(fingerprint: string | null) {
  return useQuery({
    queryKey: errorReportKeys.group(fingerprint ?? 'none'),
    queryFn: () => errorReportRepository.groupDetail(fingerprint ?? ''),
    enabled: fingerprint !== null,
  });
}

export function useSetErrorGroupResolved() {
  const queryClient = useQueryClient();
  return useMutation({
    // An admin tool: done now or not at all, never queued.
    networkMode: 'always',
    mutationFn: ({ fingerprint, resolved }: { fingerprint: string; resolved: boolean }) =>
      errorReportRepository.setResolved(fingerprint, resolved),
    onSettled: () => queryClient.invalidateQueries({ queryKey: errorReportKeys.all }),
  });
}
