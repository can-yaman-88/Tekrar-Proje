import type { IsoDate } from '@contracts/enums.contract';
import { taskKeys } from '@entities/task';
import { reviewRepository, topicKeys } from '@entities/topic';
import { useIsOnline } from '@shared/lib/network';
import { showToast } from '@shared/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/** More than this many fresh reviews in one day is a pile, not a plan; the rest wait a day. */
const MAX_TOPICS_PER_DAY = 3;

/**
 * Puts the reviews that are due today on the board.
 *
 * The database decides what a review is and guarantees it is created once per
 * scheduled date, so calling this again is harmless. It runs when the day's
 * board opens, when the day changes, and when the number of due topics does.
 *
 * @param budgetMinutes what is still free today; the first due review is
 *        always created, the rest only while they fit
 */
export function useEnsureReviewTasks(today: IsoDate, dueCount: number, budgetMinutes: number | null): void {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();
  const lastRun = useRef<string | null>(null);

  const budgetKnown = budgetMinutes !== null;

  useEffect(() => {
    // Wait for today's board: without it the budget is unknown, and a review
    // created blind could land on a day that is already full.
    if (!isOnline || dueCount === 0 || !budgetKnown) return;
    const signature = `${today}:${dueCount}`;
    if (lastRun.current === signature) return;
    lastRun.current = signature;

    let cancelled = false;
    reviewRepository
      .ensureReviewTasks(today, MAX_TOPICS_PER_DAY, Math.max(0, budgetMinutes ?? 0))
      .then(async (result) => {
        if (cancelled || result.tasks === 0) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: taskKeys.all }),
          queryClient.invalidateQueries({ queryKey: topicKeys.all }),
        ]);
        showToast(
          result.topics === 1
            ? 'Bir konunun tekrar zamanı geldi; görevi bugünün listesine eklendi.'
            : `${result.topics} konunun tekrar zamanı geldi; görevleri bugünün listesine eklendi.`,
          'info',
        );
      })
      .catch(() => {
        // Not worth an error on screen: the weekly plan schedules the same
        // reviews, and the next opening of the board tries again.
        lastRun.current = null;
      });
    return () => {
      cancelled = true;
    };
    // budgetMinutes is read at the moment of the run on purpose: a budget that
    // shrinks as tasks load must not trigger a second run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, dueCount, isOnline, budgetKnown, queryClient]);
}
