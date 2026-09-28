import { useProfile, useSetBlockedWeekdays } from '@entities/profile';
import { useFinishedTasks } from '@entities/task';
import { useSessionsSince } from '@entities/task-session';
import { buildCapacitySamples, learnDailyCapacity, LOOKBACK_WEEKS } from '@domain/capacity';
import { WEEKDAY_LABEL, WEEKDAYS, type Weekday } from '@entities/class-session';
import { addDays, todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useCallback, useMemo } from 'react';

export interface CapacityRow {
  weekday: Weekday;
  label: string;
  minutes: number;
  isLearned: boolean;
  /** A day the student says they can never study on: worth zero minutes. */
  isBlocked: boolean;
}

/**
 * Shows the student the budget the planner is using, per weekday — the same
 * calculation the Edge Function runs, so the two can never disagree.
 */
export function useLearnedCapacity() {
  const finished = useFinishedTasks();
  const windowStart = addDays(todayLocal(), -LOOKBACK_WEEKS * 7);
  const sessions = useSessionsSince(windowStart);
  const profile = useProfile();
  const setBlocked = useSetBlockedWeekdays();

  const blocked = useMemo(() => profile.data?.blockedWeekdays ?? [], [profile.data?.blockedWeekdays]);

  const toggleBlocked = useCallback(
    (weekday: Weekday) => {
      const next = blocked.includes(weekday) ? blocked.filter((day) => day !== weekday) : [...blocked, weekday];
      setBlocked.mutate(next, {
        onSuccess: () =>
          showToast(
            next.includes(weekday)
              ? `${WEEKDAY_LABEL[weekday]} kapatıldı; plan o güne iş koymayacak.`
              : `${WEEKDAY_LABEL[weekday]} yeniden açıldı.`,
            'success',
          ),
        onError: (error) => showToast(describeError(error).message, 'danger'),
      });
    },
    [blocked, setBlocked],
  );

  const view = useMemo(() => {
    const today = todayLocal();
    const start = windowStart;
    const days: string[] = [];
    for (let day = start; day < today; day = addDays(day, 1)) days.push(day);

    const estimated = (finished.data ?? []).flatMap((task) =>
      task.status === 'completed' && task.completedAt
        ? [{ date: task.completedAt.slice(0, 10), minutes: task.estimatedMinutes ?? 0 }]
        : [],
    );
    const measured = (sessions.data ?? []).flatMap((session) =>
      session.minutes === null ? [] : [{ date: session.startedAt.slice(0, 10), minutes: session.minutes }],
    );
    const { samples, measuredDays } = buildCapacitySamples(measured, estimated);

    const learned = learnDailyCapacity(samples, days);
    const rows: CapacityRow[] = WEEKDAYS.map((weekday) => {
      const isBlocked = blocked.includes(weekday);
      return {
        weekday,
        label: WEEKDAY_LABEL[weekday],
        // A closed day is worth nothing, whatever the history says about it.
        minutes: isBlocked ? 0 : (learned.minutesByWeekday[weekday] ?? 0),
        isLearned: learned.learnedWeekdays.includes(weekday),
        isBlocked,
      };
    });

    return {
      isLoading: finished.isPending,
      rows,
      hasHistory: learned.learnedWeekdays.length > 0,
      /** Days whose number came from the stopwatch rather than an estimate. */
      measuredDays,
      weeks: LOOKBACK_WEEKS,
    };
  }, [blocked, finished.data, finished.isPending, sessions.data, windowStart]);

  return { ...view, toggleBlocked, isSavingBlocked: setBlocked.isPending };
}

export type CapacityController = ReturnType<typeof useLearnedCapacity>;
