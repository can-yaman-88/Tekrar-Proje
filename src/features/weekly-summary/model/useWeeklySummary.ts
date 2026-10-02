import { useCheckinHistory } from '@entities/daily-log';
import { taskGroupOf, useWeekTasks } from '@entities/task';
import { entriesBetween, summarizeByCourse, useStudyTimeSince } from '@entities/study-time';
import { useMeasuredWork } from '@entities/task-session';
import { useReviewRadar } from '@entities/topic';
import { addDays, formatLongDate, formatMinutes, formatShortDate, useToday, weekStartOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { buildWeekSummary, type SummaryTask } from '../domain/weekly-summary';

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
/** Topics named under each course; the rest is in the course screen. */
const TOPICS_PER_COURSE = 3;

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
  // Extra detail, not a pillar of the screen: if it fails, the week still shows without it.
  const studyQuery = useStudyTimeSince(weekStart);

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
      timerSessions: (studyQuery.data ?? []).filter((entry) => entry.source === 'timer'),
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
  }, [checkinsQuery.data, sessionsQuery.data, studyQuery.data, tasksQuery.data, topicsQuery.data, weekStart]);

  // Where the week's time went, from both clocks: the task stopwatch and Focus Timer.
  const courses = useMemo(() => {
    const rows = summarizeByCourse(entriesBetween(studyQuery.data ?? [], weekStart, weekEnd));
    const longest = Math.max(1, ...rows.map((row) => row.minutes));
    return rows.map((row) => ({
      id: row.courseId,
      label: row.label,
      minutesLabel: formatMinutes(row.minutes),
      ratio: row.minutes / longest,
      topicsLabel: row.topics
        .slice(0, TOPICS_PER_COURSE)
        .map((topic) => `${topic.title} ${formatMinutes(topic.minutes)}`)
        .join(' · '),
    }));
  }, [studyQuery.data, weekEnd, weekStart]);

  const maxMinutes = Math.max(60, ...summary.byDay.map((day) => day.minutes));

  return {
    isLoading: queries.some((query) => query.isPending && query.data === undefined),
    error: failed ? describeError(failed.error) : null,
    retry: () => [...queries, studyQuery].forEach((query) => void query.refetch()),
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
    courses,
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
