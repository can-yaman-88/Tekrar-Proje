import { taskKeys } from '@entities/task';
import { reviewKeys, reviewRepository, topicKeys } from '@entities/topic';
import { formatRelativeDay, formatShortDate, todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * "Bugün tekrar ettim" from a topic's own screen, rated 1–5. The database runs
 * the same rules as a check-in, so a review logged here and one reported in
 * the evening are never counted twice.
 */
export function useLogReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ topicId, confidence }: { topicId: string; confidence: number }) =>
      reviewRepository.logReview(topicId, confidence, todayLocal()),
    onSuccess: (result) => {
      const today = todayLocal();
      if (!result.counted) {
        showToast('Bu konunun bugünkü tekrarı zaten sayılmıştı; takvim değişmedi.', 'info');
      } else if (result.nextReviewOn) {
        const when = `${formatShortDate(result.nextReviewOn)} (${formatRelativeDay(result.nextReviewOn, today)})`;
        showToast(
          result.early ? `Erken tekrar kaydedildi. Sıradaki: ${when}.` : `Kaydedildi. Sıradaki tekrar: ${when}.`,
          'success',
        );
      }
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: topicKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskKeys.all }),
      ]),
  });
}
