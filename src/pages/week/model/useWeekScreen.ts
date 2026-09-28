import type { IsoDate } from '@contracts/enums.contract';
import { TASK_GROUPS, taskGroupOf, toTaskCardModel, useWeekTasks, type Task, type TaskCardModel, type TaskGroup } from '@entities/task';
import { useToggleTaskStatus } from '@features/task-toggle-status';
import { addDays, formatLongDate, todayLocal, useToday, weekStartOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import type { TaskGroupFilterValue } from '@widgets/task-group-filter';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export interface WeekDaySection {
  key: IsoDate;
  title: string;
  minutesLabel: string | null;
  isToday: boolean;
  data: TaskCardModel[];
}

const emptyCounts = (): Record<TaskGroup, number> => ({ concepts: 0, quiz: 0, feynman: 0, homework: 0 });

/** The whole week at a glance: which day carries what, filtered by label. */
export function useWeekScreen() {
  const router = useRouter();
  const today = useToday();
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState<TaskGroupFilterValue>('all');
  const [isRefreshing, setRefreshing] = useState(false);

  const weekStart = useMemo(() => addDays(weekStartOf(today), weekOffset * 7), [today, weekOffset]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const query = useWeekTasks(weekStart, weekEnd);
  const { toggle, pendingTaskId } = useToggleTaskStatus(todayLocal());

  const tasks = useMemo(() => query.data ?? [], [query.data]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const counts = useMemo(() => {
    const result = emptyCounts();
    for (const task of tasks) result[taskGroupOf(task)]++;
    return result;
  }, [tasks]);

  const sections = useMemo<WeekDaySection[]>(() => {
    const visible = filter === 'all' ? tasks : tasks.filter((task) => taskGroupOf(task) === filter);
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      const ofDay = visible.filter((task) => task.dueDate === day);
      const minutes = ofDay.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
      return {
        key: day,
        title: formatLongDate(day),
        minutesLabel: minutes === 0 ? null : `${minutes} dk`,
        isToday: day === today,
        data: ofDay.map((task: Task) => toTaskCardModel(task, today)),
      };
    });
  }, [tasks, filter, weekStart, today]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const done = tasks.filter((task) => task.status === 'completed').length;

  return {
    isLoading: query.isPending && query.data === undefined,
    error: query.data === undefined && query.isError ? describeError(query.error) : null,
    retry: refresh,
    header: {
      rangeLabel: `${formatLongDate(weekStart)} – ${formatLongDate(weekEnd)}`,
      offsetLabel: weekOffset === 0 ? 'Bu hafta' : weekOffset === 1 ? 'Gelecek hafta' : `${weekOffset} hafta sonra`,
      progressLabel: `${done}/${tasks.length} tamam`,
      canGoBack: weekOffset > 0,
      onPrevious: () => setWeekOffset((value) => Math.max(0, value - 1)),
      onNext: () => setWeekOffset((value) => Math.min(8, value + 1)),
    },
    filter: { value: filter, counts, onChange: setFilter, groups: TASK_GROUPS },
    onOpenSummary: () => router.push('/weekly-summary'),
    sections,
    isRefreshing,
    refresh,
    onToggle: (taskId: string) => {
      const task = taskById.get(taskId);
      if (task) toggle(task);
    },
    onPressTask: (taskId: string) => router.push(`/task/${taskId}`),
    pendingTaskId,
  };
}
