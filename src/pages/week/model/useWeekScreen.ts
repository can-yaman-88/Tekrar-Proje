import type { IsoDate } from '@contracts/enums.contract';
import { cardGroupsOf, TASK_GROUPS, toTaskCardModel, useWeekTasks, type Task, type TaskCardModel, type TaskGroup } from '@entities/task';
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
  const { toggle, pendingTaskId, rating } = useToggleTaskStatus(todayLocal());

  const tasks = useMemo(() => query.data ?? [], [query.data]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  /**
   * A step is shown inside its parent's card, but only on the day they share.
   * A learning task whose two halves fell on different days is still one task —
   * and the calendar still has to show Monday's half on Monday.
   */
  const stepsByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const parent = task.parentTaskId === null ? undefined : taskById.get(task.parentTaskId);
      if (!parent || parent.dueDate !== task.dueDate) continue;
      map.set(parent.id, [...(map.get(parent.id) ?? []), task]);
    }
    return map;
  }, [tasks, taskById]);

  const isOwnCard = useCallback(
    (task: Task): boolean => {
      if (task.parentTaskId === null) return true;
      const parent = taskById.get(task.parentTaskId);
      return parent === undefined || parent.dueDate !== task.dueDate;
    },
    [taskById],
  );

  /** Every label a card carries — its own and its steps' — so a filter finds the steps too. */
  const groupsOf = useCallback((card: Task) => cardGroupsOf(card, stepsByParent.get(card.id) ?? []), [stepsByParent]);

  const counts = useMemo(() => {
    const result = emptyCounts();
    // One card, one count per label it carries: a learning card is counted
    // under Concepts and under Feynman, never twice under either.
    for (const task of tasks) {
      if (!isOwnCard(task)) continue;
      for (const group of groupsOf(task)) result[group]++;
    }
    return result;
  }, [tasks, isOwnCard, groupsOf]);

  const sections = useMemo<WeekDaySection[]>(() => {
    const cards = tasks.filter(isOwnCard).filter((card) => filter === 'all' || groupsOf(card).has(filter));
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      const ofDay = cards.filter((card) => card.dueDate === day);
      // Minutes count the work, which lives on the steps; the container is empty.
      const minutes = ofDay.reduce(
        (sum, card) =>
          sum +
          (stepsByParent.get(card.id) ?? [card]).reduce((inner, part) => inner + (part.estimatedMinutes ?? 0), 0),
        0,
      );
      return {
        key: day,
        title: formatLongDate(day),
        minutesLabel: minutes === 0 ? null : `${minutes} dk`,
        isToday: day === today,
        data: ofDay.map((task: Task) => toTaskCardModel(task, today, undefined, stepsByParent.get(task.id) ?? [])),
      };
    });
  }, [tasks, filter, weekStart, today, isOwnCard, stepsByParent, groupsOf]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const done = tasks.filter((task) => isOwnCard(task) && task.status === 'completed').length;

  return {
    isLoading: query.isPending && query.data === undefined,
    error: query.data === undefined && query.isError ? describeError(query.error) : null,
    retry: refresh,
    header: {
      rangeLabel: `${formatLongDate(weekStart)} – ${formatLongDate(weekEnd)}`,
      offsetLabel: weekOffset === 0 ? 'Bu hafta' : weekOffset === 1 ? 'Gelecek hafta' : `${weekOffset} hafta sonra`,
      progressLabel: `${done}/${tasks.filter(isOwnCard).length} tamam`,
      canGoBack: weekOffset > 0,
      onPrevious: () => setWeekOffset((value) => Math.max(0, value - 1)),
      onNext: () => setWeekOffset((value) => Math.min(8, value + 1)),
    },
    filter: { value: filter, counts, onChange: setFilter, groups: TASK_GROUPS },
    onOpenSummary: () => router.push('/weekly-summary'),
    onOpenShape: () => router.push('/week-shape'),
    sections,
    isRefreshing,
    refresh,
    onToggle: (taskId: string) => {
      const task = taskById.get(taskId);
      if (task) toggle(task);
    },
    onPressTask: (taskId: string) => router.push(`/task/${taskId}`),
    pendingTaskId,
    rating,
  };
}
