import { useQuery } from '@tanstack/react-query';
import { dailyLogRepository } from '../data/daily-log.repository';

export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  lastCheckin: () => [...dailyLogKeys.all, 'last-checkin'] as const,
};

export function useLastCheckinDate() {
  return useQuery({
    queryKey: dailyLogKeys.lastCheckin(),
    queryFn: () => dailyLogRepository.lastCheckinDate(),
    staleTime: 5 * 60_000,
  });
}
