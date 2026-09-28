import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkinHistoryRepository } from '../data/checkin-history.repository';

export const checkinHistoryKeys = {
  all: ['checkin-history'] as const,
  list: () => [...checkinHistoryKeys.all, 'list'] as const,
  changes: (dailyLogId: string) => [...checkinHistoryKeys.all, 'changes', dailyLogId] as const,
};

export function useCheckinHistory() {
  return useQuery({
    queryKey: checkinHistoryKeys.list(),
    queryFn: () => checkinHistoryRepository.listRecent(),
  });
}

export function useCheckinChanges(dailyLogId: string | null) {
  return useQuery({
    queryKey: checkinHistoryKeys.changes(dailyLogId ?? 'none'),
    queryFn: () => checkinHistoryRepository.listTaskChanges(dailyLogId as string),
    enabled: dailyLogId !== null,
  });
}

export function useDeleteCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    // Server-side and irreversible: offline this must fail, never queue.
    networkMode: 'always' as const,
    mutationFn: ({ dailyLogId, revert }: { dailyLogId: string; revert: boolean }) =>
      checkinHistoryRepository.delete(dailyLogId, revert),
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useRevertCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always' as const,
    mutationFn: (dailyLogId: string) => checkinHistoryRepository.revert(dailyLogId),
    // The undo touches tasks, topics and the plan: refresh everything.
    onSettled: () => queryClient.invalidateQueries(),
  });
}
