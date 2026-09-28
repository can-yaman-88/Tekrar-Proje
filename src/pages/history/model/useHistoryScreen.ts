import { toTaskCardModel, useFinishedTasks, type Task, type TaskCardModel } from '@entities/task';
import { formatLongDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export interface HistorySection {
  key: string;
  title: string;
  data: TaskCardModel[];
}

/** Groups finished work by the day it was finished (falling back to its due date). */
function groupByDay(tasks: readonly Task[], today: string): HistorySection[] {
  const groups = new Map<string, TaskCardModel[]>();
  for (const task of tasks) {
    const day = task.completedAt?.slice(0, 10) ?? task.dueDate;
    const bucket = groups.get(day) ?? [];
    bucket.push(toTaskCardModel(task, today));
    groups.set(day, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, data]) => ({ key: day, title: day === today ? 'Bugün' : formatLongDate(day), data }));
}

export function useHistoryScreen() {
  const router = useRouter();
  const today = useToday();
  const query = useFinishedTasks();
  const [isRefreshing, setRefreshing] = useState(false);

  const tasks = useMemo(() => query.data ?? [], [query.data]);
  const sections = useMemo(() => groupByDay(tasks, today), [tasks, today]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const completed = tasks.filter((t) => t.status === 'completed').length;

  return {
    isLoading: query.isPending && query.data === undefined,
    error: query.data === undefined && query.isError ? describeError(query.error) : null,
    sections,
    stats: { completed, failed: tasks.filter((t) => t.status === 'failed').length, total: tasks.length },
    isRefreshing,
    refresh,
    openTask: (taskId: string) => router.push(`/task/${taskId}`),
    openCheckinHistory: () => router.push('/checkin-history'),
  };
}
