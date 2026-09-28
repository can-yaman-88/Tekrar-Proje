import { useCheckinHistory } from '@entities/daily-log';
import { taskGroupOf, useWeekTasks } from '@entities/task';
import { useMeasuredWork } from '@entities/task-session';
import { useReviewRadar } from '@entities/topic';
import { addDays, formatLongDate, formatShortDate, useToday, weekStartOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { buildWeekSummary, type SummaryTask } from '../domain/weekly-summary';

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/**
 * The week in review. Composed from queries the app already runs, so opening
 * this screen costs one extra read (the sessions) rather than a new endpoint.
 */
export function useWeeklySummary() {
  const today = useToday();
  const router = useRouter();
  // Sunday evening is when this is read, so "this week" is the week just lived.
  const [offset, setOffset] = useState(0);
  const weekStart = useMemo(() => addDays(weekStartOf(today), offset * 7), [today, offset]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const tasksQuery = useWeekTasks(weekStart, weekEnd);
  const sessionsQuery = useMeasuredWork(weekStart);
  const checkinsQuery = useCheckinHistory();
  const topicsQuery = useReviewRadar();

  const queries = [tasksQuery, sessionsQuery, checkinsQuery, topicsQuery];
  const failed = queries.find((query) => query.isError);

  const summary = useMemo(() => {
    const tasks: SummaryTask[] = (tasksQuery.data ?? []).map((task) => ({
      id: task.id,
      type: task.type,
      group: taskGroupOf(task),
      status: task.status,
      dueDate: task.dueDate,
      estimatedMinutes: task.estimatedMinutes,
      topicId: task.topic.id,
      topicTitle: task.topic.title,
      courseLabel: task.course.code ?? task.course.name,
    }));

    return buildWeekSummary({
      weekStart,
      tasks,
      sessions: (sessionsQuery.data ?? []).map((work) => ({
        taskId: work.taskId,
        taskType: work.taskType,
        startedAt: work.startedAt,
        minutes: work.minutes,
        estimatedMinutes: work.estimatedMinutes,
      })),
      checkinDates: (checkinsQuery.data ?? [])
        .filter((record) => record.revertedAt === null)
        .map((record) => record.logDate),
      topics: (topicsQuery.data ?? []).map((topic) => ({
        id: topic.id,
        title: topic.title,
        courseLabel: topic.courseLabel,
        easeFactor: topic.easeFactor,
        nextReviewOn: topic.nextReviewOn,
        failedTasks: topic.failedTasks,
      })),
    });
  }, [checkinsQuery.data, sessionsQuery.data, tasksQuery.data, topicsQuery.data, weekStart]);

  const maxMinutes = Math.max(60, ...summary.byDay.map((day) => day.minutes));

  return {
    isLoading: queries.some((query) => query.isPending && query.data === undefined),
    error: failed ? describeError(failed.error) : null,
    retry: () => queries.forEach((query) => void query.refetch()),
    rangeLabel: `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`,
    isCurrentWeek: offset === 0,
    onPreviousWeek: () => setOffset((current) => current - 1),
    onNextWeek: () => setOffset((current) => Math.min(0, current + 1)),
    headline: summary.headline,
    stats: [
      { label: 'Biten görev', value: `${summary.completed}/${summary.total}` },
      {
        label: summary.hasMeasuredTime ? 'Ölçülen süre' : 'Tahmini süre',
        value: `${summary.hasMeasuredTime ? summary.measuredMinutes : summary.estimatedMinutes} dk`,
      },
      { label: 'Değerlendirme', value: `${summary.checkinDays} gün` },
      { label: 'Takılan görev', value: String(summary.failed) },
    ],
    days: summary.byDay.map((day, index) => ({
      key: day.date,
      label: WEEKDAY_SHORT[index] ?? formatShortDate(day.date),
      minutes: day.minutes,
      completed: day.completed,
      ratio: day.minutes / maxMinutes,
    })),
    groups: summary.byGroup.filter((group) => group.total > 0),
    calibration: summary.calibration.map((row) => ({
      ...row,
      /** Positive means the work takes longer than the planner budgets for. */
      drift: row.actual - row.estimated,
    })),
    struggling: summary.struggling.map((topic) => ({
      id: topic.id,
      title: topic.title,
      detail: `${topic.courseLabel} · kolaylık ${topic.easeFactor.toFixed(2)}`,
    })),
    nextWeek: summary.nextWeekReviews.map((topic) => ({
      id: topic.id,
      title: topic.title,
      detail: topic.nextReviewOn ? formatLongDate(topic.nextReviewOn) : '',
    })),
    hasMeasuredTime: summary.hasMeasuredTime,
    onOpenProgress: () => router.push('/progress'),
    onOpenBacklog: () => router.push('/backlog'),
  };
}

export type WeeklySummaryController = ReturnType<typeof useWeeklySummary>;
