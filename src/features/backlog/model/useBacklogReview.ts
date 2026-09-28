import { taskKeys, taskRepository, useBacklog } from '@entities/task';
import { BACKLOG_AFTER_DAYS, rescheduleBacklog } from '@domain/backlog';
import type { DayBudget } from '@domain/workload';
import { addDays, diffInDays, formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

/** How many days ahead the pile may be spread over. */
const SPREAD_DAYS = 7;

export interface BacklogRow {
  id: string;
  title: string;
  subtitle: string;
  ageLabel: string;
  minutes: number;
  isSelected: boolean;
}

/**
 * Settling the debt.
 *
 * Old open work is the thing that makes a planner unpleasant to open: it is
 * never today's plan, it never goes away on its own, and it turns the list
 * into a reproach. So it is gathered in one place with exactly two honest
 * answers — put it back on the calendar, or admit it is not happening.
 */
export function useBacklogReview(capacityByWeekday: Readonly<Record<number, number>>) {
  const today = useToday();
  const queryClient = useQueryClient();
  const cutoff = useMemo(() => addDays(today, -BACKLOG_AFTER_DAYS), [today]);
  const backlog = useBacklog(cutoff);

  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const tasks = useMemo(() => backlog.data ?? [], [backlog.data]);
  // Everything is selected until the student says otherwise: the common case
  // is "deal with all of it".
  const selection = selected ?? new Set(tasks.map((task) => task.id));

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    [queryClient],
  );

  const spread = useMutation({
    // No optimistic UI here: offline this must fail loudly, not queue.
    networkMode: 'always' as const,
    mutationFn: async (ids: readonly string[]) => {
      const chosen = tasks.filter((task) => ids.includes(task.id));
      const days: DayBudget[] = Array.from({ length: SPREAD_DAYS }, (_, index) => {
        const date = addDays(today, index);
        return {
          date,
          capacityMinutes: capacityByWeekday[isoWeekday(date)] ?? 0,
          // Days already carry the rest of the plan; the pile goes in what is left.
          committedMinutes: 0,
        };
      });

      const plan = rescheduleBacklog({
        days,
        tasks: chosen.map((task) => ({
          id: task.id,
          dueDate: task.dueDate,
          estimatedMinutes: task.estimatedMinutes ?? 0,
        })),
      });

      // One update per day rather than per task.
      const byDate = new Map<string, string[]>();
      for (const placement of plan.placements) {
        byDate.set(placement.date, [...(byDate.get(placement.date) ?? []), placement.taskId]);
      }
      for (const [date, taskIds] of byDate) await taskRepository.moveMany(taskIds, date);

      return { moved: plan.placements.length, unplacedMinutes: plan.unplacedMinutes };
    },
    onSuccess: async (result) => {
      setSelected(null);
      await invalidate();
      showToast(
        result.unplacedMinutes > 0
          ? `${result.moved} görev dağıtıldı; ${result.unplacedMinutes} dakikalık iş sığmadı.`
          : `${result.moved} görev önümüzdeki günlere dağıtıldı.`,
        'success',
      );
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const close = useMutation({
    networkMode: 'always' as const,
    mutationFn: (ids: readonly string[]) => taskRepository.skipMany(ids),
    onSuccess: async (count) => {
      setSelected(null);
      await invalidate();
      showToast(`${count} görev kapatıldı.`, 'success');
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const rows: BacklogRow[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    subtitle: `${task.course.code ?? task.course.name} · ${task.topic.title}`,
    ageLabel: `${Math.max(1, diffInDays(task.dueDate, today))} gün önce · ${formatShortDate(task.dueDate)}`,
    minutes: task.estimatedMinutes ?? 0,
    isSelected: selection.has(task.id),
  }));

  const selectedIds = rows.filter((row) => row.isSelected).map((row) => row.id);

  return {
    isLoading: backlog.isPending && backlog.data === undefined,
    error: backlog.isError ? describeError(backlog.error) : null,
    retry: () => void backlog.refetch(),
    rows,
    count: rows.length,
    selectedCount: selectedIds.length,
    totalMinutes: rows.filter((row) => row.isSelected).reduce((total, row) => total + row.minutes, 0),
    isBusy: spread.isPending || close.isPending,
    onToggle: (taskId: string) =>
      setSelected(() => {
        const next = new Set(selection);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      }),
    onSelectAll: () => setSelected(new Set(tasks.map((task) => task.id))),
    onSelectNone: () => setSelected(new Set()),
    onSpread: () => spread.mutate(selectedIds),
    onClose: () => close.mutate(selectedIds),
    spreadDays: SPREAD_DAYS,
    cutoffDays: BACKLOG_AFTER_DAYS,
  };
}

const isoWeekday = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

export type BacklogController = ReturnType<typeof useBacklogReview>;
