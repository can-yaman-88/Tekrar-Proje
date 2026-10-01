import { taskKeys } from '@entities/task';
import { todayLocal, weekStartOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateWeeklyPlan } from '../data/weekly-plan.api';

export function useWeeklyPlan() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: ['weekly-plan', 'generate'],
    // The server does the work; there is no optimistic UI to fall back on, so
    // a paused mutation would look like a button that did nothing while the
    // plan was quietly being written.
    networkMode: 'always',
    mutationFn: () => {
      const today = todayLocal();
      return generateWeeklyPlan(weekStartOf(today), today);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      showToast(
        result.created === 0
          ? (result.notes[0] ?? 'Planlanacak yeni konu bulunamadı.')
          : `${result.created} görev planlandı.`,
        result.created === 0 ? 'info' : 'success',
      );
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  return {
    generate: () => mutation.mutate(),
    isGenerating: mutation.isPending,
    result: mutation.data ?? null,
  };
}
