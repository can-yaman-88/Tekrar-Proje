import { taskKeys, taskRepository, type Task } from '@entities/task';
import { useSessionsSince } from '@entities/task-session';
import { useWeekTasks } from '@entities/task';
import { WINDOW_DAYS, planDeadlineWork, type DayBudget } from '@domain/workload';
import { addDays, formatLongDate, todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

export type DayMode = 'auto' | 'manual' | 'off';

export interface AllocationRow {
  date: string;
  label: string;
  minutes: number;
  mode: DayMode;
  /** Minutes already taken by other work that day. */
  committedMinutes: number;
}

const DEFAULT_HOMEWORK_MINUTES = 45;
const DEFAULT_MINUTES_PER_QUESTION = 6;

/**
 * Per-day control over one piece of homework.
 *
 * The automatic split is a suggestion: the table shows what the app would do,
 * and every row can be overridden or switched off. Pinned days are stored on
 * the task, so the same numbers drive the card, the weekly plan and this
 * screen — there is no second source of truth.
 */
export function useTaskAllocation(task: Task, capacityByWeekday: Readonly<Record<number, number>>) {
  const today = todayLocal();
  const queryClient = useQueryClient();
  const horizonEnd = useMemo(() => addDays(today, WINDOW_DAYS), [today]);
  const weekTasks = useWeekTasks(today, horizonEnd);
  const sessions = useSessionsSince(useMemo(() => addDays(today, -30), [today]));

  // Local edits stay in the hand until saved, so a half-typed number never
  // rewrites the plan.
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const pinned = useMemo(
    () => draft ?? (task.dayAllocations as Record<string, number> | null) ?? {},
    [draft, task.dayAllocations],
  );

  const save = useMutation({
    networkMode: 'always' as const,
    mutationFn: (allocations: Record<string, number> | null) =>
      taskRepository.update(task.id, {
        title: task.title,
        type: task.type,
        instructions: task.instructions,
        dueDate: task.dueDate,
        startsOn: task.startsOn,
        targetCount: task.targetCount,
        completedCount: task.completedCount,
        estimatedMinutes: task.estimatedMinutes,
        confidenceLevel: task.confidenceLevel,
        dayAllocations: allocations,
      }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      showToast('Dağılım kaydedildi.', 'success');
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const measuredMinutes = useMemo(() => {
    let total = 0;
    for (const session of sessions.data ?? []) {
      if (session.taskId === task.id && session.minutes !== null) total += session.minutes;
    }
    return total;
  }, [sessions.data, task.id]);

  const remainingMinutes = useMemo(() => {
    const estimated =
      task.estimatedMinutes ??
      (task.targetCount === null ? DEFAULT_HOMEWORK_MINUTES : task.targetCount * DEFAULT_MINUTES_PER_QUESTION);
    if (task.targetCount !== null && task.targetCount > 0) {
      const left = Math.max(0, task.targetCount - task.completedCount);
      return Math.round((estimated * left) / task.targetCount);
    }
    return Math.max(0, estimated - measuredMinutes);
  }, [measuredMinutes, task.completedCount, task.estimatedMinutes, task.targetCount]);

  const rows = useMemo<AllocationRow[]>(() => {
    const windowStart = task.startsOn ?? addDays(task.dueDate, -WINDOW_DAYS);
    const from = windowStart > today ? windowStart : today;

    const dates: string[] = [];
    for (let date = from; date <= task.dueDate; date = addDays(date, 1)) dates.push(date);

    const days: DayBudget[] = dates.map((date) => ({
      date,
      capacityMinutes: capacityByWeekday[isoWeekday(date)] ?? 0,
      committedMinutes: (weekTasks.data ?? [])
        .filter((other) => other.id !== task.id && other.dueDate === date && isOpen(other))
        .reduce((total, other) => total + (other.estimatedMinutes ?? 0), 0),
    }));

    const plan = planDeadlineWork({
      today,
      days,
      tasks: [
        {
          id: task.id,
          dueDate: task.dueDate,
          startsOn: task.startsOn,
          remainingMinutes,
          remainingCount: task.targetCount === null ? null : Math.max(0, task.targetCount - task.completedCount),
          minutesPerUnit:
            task.targetCount === null || task.targetCount === 0
              ? null
              : (task.estimatedMinutes ?? task.targetCount * DEFAULT_MINUTES_PER_QUESTION) / task.targetCount,
          fixedByDate: pinned,
        },
      ],
    });

    return days.map((day) => {
      const share = plan.shares.find((entry) => entry.date === day.date);
      const manual = pinned[day.date];
      return {
        date: day.date,
        label: formatLongDate(day.date),
        minutes: share?.minutes ?? 0,
        mode: manual === undefined ? 'auto' : manual === 0 ? 'off' : 'manual',
        committedMinutes: day.committedMinutes,
      };
    });
  }, [capacityByWeekday, pinned, remainingMinutes, task, today, weekTasks.data]);

  const setDay = useCallback(
    (date: string, minutes: number | null) => {
      setDraft((current) => {
        const base = { ...(current ?? (task.dayAllocations as Record<string, number> | null) ?? {}) };
        if (minutes === null) delete base[date];
        else base[date] = Math.max(0, Math.min(600, Math.round(minutes)));
        return base;
      });
    },
    [task.dayAllocations],
  );

  return {
    rows,
    remainingMinutes,
    allocatedMinutes: rows.reduce((total, row) => total + row.minutes, 0),
    hasChanges: draft !== null,
    isSaving: save.isPending,
    onSetDay: setDay,
    onClearDay: (date: string) => setDay(date, null),
    onCloseDay: (date: string) => setDay(date, 0),
    onResetAll: () => {
      setDraft({});
      save.mutate(null);
    },
    onSave: () => save.mutate(Object.keys(pinned).length > 0 ? pinned : null),
  };
}

const isOpen = (task: Task): boolean => task.status === 'pending' || task.status === 'in_progress';

const isoWeekday = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

export type TaskAllocationController = ReturnType<typeof useTaskAllocation>;
