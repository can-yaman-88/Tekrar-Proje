import type { IsoDate } from '@contracts/enums.contract';
import { useLastCheckinDate } from '@entities/daily-log';
import { nextExamDaysByCourse, toExamChipModel, useUpcomingExams } from '@entities/exam';
import {
  isDeadlineWork,
  TASK_GROUPS,
  taskGroupOf,
  useMissionTasks,
  useWeekTasks,
  type DailyShare,
  type Task,
  type TaskGroup,
} from '@entities/task';
import { useSessionsSince } from '@entities/task-session';
import { useLearnedCapacity } from '@features/capacity';
import { planDeadlineWork, WINDOW_DAYS, type DayBudget, type DeadlineTask } from '@domain/workload';
import {
  useBannerStore,
  useExamReminderSync,
  useSmartReminderSync,
  useWeeklySummaryReminder,
} from '@features/reminders';
import { useToggleTaskStatus } from '@features/task-toggle-status';
import { useQueuedChangeCount } from '@shared/api/query';
import { addDays, diffInDays, formatLongDate, formatShortDate, useToday } from '@shared/lib/date';
import { useIsOnline } from '@shared/lib/network';
import { describeError, type ErrorDescription } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { TaskGroupFilterValue } from '@widgets/task-group-filter';
import { buildMissionSections } from './buildMissionSections';

export type MissionScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; error: ErrorDescription }
  | { kind: 'ready' };

/** All Mission screen logic; the screen component only renders what this returns. */
export function useMissionScreen() {
  const router = useRouter();
  const today = useToday();
  const tasksQuery = useMissionTasks(today);
  const examsQuery = useUpcomingExams(today);
  const { toggle, pendingTaskId } = useToggleTaskStatus(today);
  const lastCheckin = useLastCheckinDate();
  const [isPullRefreshing, setPullRefreshing] = useState(false);
  const [filter, setFilter] = useState<TaskGroupFilterValue>('all');
  const isOnline = useIsOnline();
  const queuedChanges = useQueuedChangeCount();
  const bannerHiddenOn = useBannerStore((state) => state.pressureHiddenOn);
  const bannerExpanded = useBannerStore((state) => state.pressureExpanded);
  const toggleBanner = useBannerStore((state) => state.togglePressure);
  const hideBannerFor = useBannerStore((state) => state.hidePressureFor);

  const exams = useMemo(() => examsQuery.data ?? [], [examsQuery.data]);
  useExamReminderSync(exams);
  useSmartReminderSync();
  useWeeklySummaryReminder();
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  // What the days ahead already hold, so a homework's share is carved out of
  // the time that is actually free — not out of the weekday average.
  const horizonEnd = useMemo(() => addDays(today, WINDOW_DAYS), [today]);
  const weekTasks = useWeekTasks(today, horizonEnd);
  const sessions = useSessionsSince(useMemo(() => addDays(today, -30), [today]));
  const capacity = useLearnedCapacity();

  const workload = useMemo(
    () =>
      buildWorkload({
        today,
        horizonEnd,
        board: tasks,
        scheduled: weekTasks.data ?? [],
        measuredMinutes: measuredByTask(sessions.data ?? []),
        capacityByWeekday: Object.fromEntries(capacity.rows.map((row) => [row.weekday, row.minutes])),
      }),
    [capacity.rows, horizonEnd, sessions.data, tasks, today, weekTasks.data],
  );

  // Two rules decide what the board shows: homework with no share today is
  // work for another day, and a step is shown inside its parent rather than
  // beside it.
  const boardTasks = useMemo(() => {
    const visibleIds = new Set(tasks.map((task) => task.id));
    return tasks.filter(
      (task) =>
        (task.parentTaskId === null || !visibleIds.has(task.parentTaskId)) &&
        (!isDeadlineWork(task, today) || workload.shares.has(task.id)),
    );
  }, [tasks, today, workload.shares]);

  // The chips count what the list actually shows: a group task is one card,
  // so its steps are not counted again beside it.
  const groupCounts = useMemo(() => {
    const counts: Record<TaskGroup, number> = { concepts: 0, quiz: 0, feynman: 0, homework: 0 };
    for (const task of boardTasks) counts[taskGroupOf(task)]++;
    return counts;
  }, [boardTasks]);

  const visibleTasks = useMemo(
    () => (filter === 'all' ? boardTasks : boardTasks.filter((task) => taskGroupOf(task) === filter)),
    [boardTasks, filter],
  );

  const summary = useMemo(
    () =>
      buildMissionSections(
        // Steps travel with their parent so the card can show them, but only
        // the parent is a row in the list.
        [...visibleTasks, ...tasks.filter((task) => task.parentTaskId !== null)],
        today,
        nextExamDaysByCourse(exams, today),
        workload.shares,
      ),
    [visibleTasks, tasks, exams, today, workload.shares],
  );
  const examChips = useMemo(() => exams.map((e) => toExamChipModel(e, today)), [exams, today]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Cached data wins over errors: offline users keep seeing their last-known plan.
  const state: MissionScreenState =
    tasksQuery.data !== undefined
      ? { kind: 'ready' }
      : tasksQuery.isError
        ? { kind: 'error', error: describeError(tasksQuery.error) }
        : { kind: 'loading' };

  const { refetch: refetchTasks } = tasksQuery;
  const { refetch: refetchExams } = examsQuery;
  const refresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([refetchTasks(), refetchExams()]);
    } finally {
      setPullRefreshing(false);
    }
  }, [refetchTasks, refetchExams]);

  const onToggle = useCallback(
    (taskId: string) => {
      const task = taskById.get(taskId);
      if (task) toggle(task);
    },
    [taskById, toggle],
  );

  return {
    state,
    header: {
      dateLabel: formatLongDate(today),
      done: summary.done,
      total: summary.total,
      overdue: summary.overdue,
      onCheckIn: () => router.push('/check-in'),
    },
    exams: { exams: examChips, loading: examsQuery.isPending },
    filter: { value: filter, counts: groupCounts, onChange: setFilter, groups: TASK_GROUPS },
    // After a break, one report can cover the whole gap.
    catchUp: (() => {
      const last = lastCheckin.data;
      if (last === undefined) return null;
      const missedDays = last === null ? null : diffInDays(last, today);
      if (missedDays !== null && missedDays <= 1) return null;
      return {
        missedDays,
        message:
          missedDays === null
            ? 'Henüz değerlendirme yazmadın. İlkini yazınca plan sana göre şekillenmeye başlar.'
            : `${missedDays} gündür değerlendirme yok. Hepsini tek seferde anlatabilirsin: "pazartesi şunu bitirdim, dün hiç çalışamadım" gibi.`,
        onPress: () => router.push('/check-in'),
      };
    })(),
    onOpenExam: (examId: string) => router.push(`/exam/${examId}`),
    onOpenBacklog: () => router.push('/backlog'),
    deadlinePressure:
      workload.pressureMessage === null || bannerHiddenOn === today
        ? null
        : {
            message: workload.pressureMessage,
            isExpanded: bannerExpanded,
            onToggle: toggleBanner,
            onHideForToday: () => hideBannerFor(today),
          },
    list: {
      sections: summary.sections,
      refreshing: isPullRefreshing,
      onRefresh: refresh,
      onToggle,
      onPressTask: (taskId: string) => router.push(`/task/${taskId}`),
      pendingTaskId,
    },
    offline:
      isOnline && queuedChanges === 0
        ? null
        : {
            isOnline,
            queuedChanges,
            message: isOnline
              ? `${queuedChanges} değişiklik gönderiliyor…`
              : queuedChanges > 0
                ? `Çevrimdışısın. ${queuedChanges} değişiklik bağlantı gelince gönderilecek.`
                : 'Çevrimdışısın. Kayıtlı verilerin gösteriliyor.',
          },
    staleWarning: tasksQuery.isError && tasksQuery.data !== undefined ? describeError(tasksQuery.error) : null,
    retry: refresh,
  };
}


/** Minutes really spent per task, from the stopwatch. */
function measuredByTask(sessions: readonly { taskId: string; minutes: number | null }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const session of sessions) {
    if (session.minutes === null) continue;
    result.set(session.taskId, (result.get(session.taskId) ?? 0) + session.minutes);
  }
  return result;
}

/** Work with no estimate and no question count still has to cost something. */
const DEFAULT_HOMEWORK_MINUTES = 45;
const DEFAULT_MINUTES_PER_QUESTION = 6;

function toDeadlineTask(task: Task, measured: number): DeadlineTask {
  const estimated =
    task.estimatedMinutes ??
    (task.targetCount === null ? DEFAULT_HOMEWORK_MINUTES : task.targetCount * DEFAULT_MINUTES_PER_QUESTION);
  const remainingCount = task.targetCount === null ? null : Math.max(0, task.targetCount - task.completedCount);
  const minutesPerUnit = task.targetCount === null || task.targetCount === 0 ? null : estimated / task.targetCount;

  // Countable work knows exactly how much is left; for the rest the stopwatch
  // is the only honest measure of progress.
  const remainingMinutes =
    remainingCount !== null && task.targetCount !== null
      ? Math.round((estimated * remainingCount) / task.targetCount)
      : Math.max(0, estimated - measured);

  return {
    id: task.id,
    dueDate: task.dueDate,
    startsOn: task.startsOn,
    remainingMinutes,
    remainingCount,
    minutesPerUnit,
    // Days the student pinned themselves win over the automatic share.
    fixedByDate: task.dayAllocations ?? undefined,
  };
}

interface WorkloadView {
  shares: Map<string, DailyShare>;
  pressureMessage: string | null;
}

function buildWorkload({
  today,
  horizonEnd,
  board,
  scheduled,
  measuredMinutes,
  capacityByWeekday,
}: {
  today: IsoDate;
  horizonEnd: IsoDate;
  board: readonly Task[];
  scheduled: readonly Task[];
  measuredMinutes: ReadonlyMap<string, number>;
  capacityByWeekday: Readonly<Record<number, number>>;
}): WorkloadView {
  // A task with steps is a container: the steps carry the work, so they are
  // what gets split across the days, not their parent.
  const parentIds = new Set(board.flatMap((task) => (task.parentTaskId === null ? [] : [task.parentTaskId])));
  const deadlineWork = board.filter((task) => isDeadlineWork(task, today) && !parentIds.has(task.id));
  if (deadlineWork.length === 0) return { shares: new Map(), pressureMessage: null };

  const days: DayBudget[] = [];
  for (let date = today; date <= horizonEnd; date = addDays(date, 1)) {
    const weekday = isoWeekday(date);
    // Loop work already booked for that day; homework is what we are placing.
    const committed = scheduled
      .filter((task) => task.dueDate === date && !isDeadlineWork(task, today) && isOpenTask(task))
      .reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
    days.push({ date, capacityMinutes: capacityByWeekday[weekday] ?? 0, committedMinutes: committed });
  }

  const plan = planDeadlineWork({
    today,
    days,
    tasks: deadlineWork.map((task) => toDeadlineTask(task, measuredMinutes.get(task.id) ?? 0)),
  });

  const shares = new Map<string, DailyShare>();
  for (const share of plan.shares) {
    if (share.date === today) shares.set(share.taskId, { minutes: share.minutes, count: share.count });
  }

  return { shares, pressureMessage: pressureMessage(plan.pressure, board) };
}

const isOpenTask = (task: Task): boolean => task.status === 'pending' || task.status === 'in_progress';

const isoWeekday = (date: IsoDate): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

const hoursAndMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} dk`;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
};

/** One sentence about the deadline that will not fit, worst one first. */
function pressureMessage(
  pressure: readonly { taskId: string; dueDate: IsoDate; remainingMinutes: number; freeMinutes: number; shortfallMinutes: number }[],
  tasks: readonly Task[],
): string | null {
  if (pressure.length === 0) return null;
  const worst = [...pressure].sort((a, b) => b.shortfallMinutes - a.shortfallMinutes)[0];
  if (!worst) return null;
  const title = tasks.find((task) => task.id === worst.taskId)?.title ?? 'Ödev';
  const others = pressure.length > 1 ? ` (+${pressure.length - 1} teslim daha sıkışık)` : '';
  return (
    `${formatShortDate(worst.dueDate)} teslimli "${title}" için ${hoursAndMinutes(worst.remainingMinutes)} iş var; ` +
    `o güne kadar boş kapasiten ${hoursAndMinutes(worst.freeMinutes)}. ` +
    `${hoursAndMinutes(worst.shortfallMinutes)} açık${others}.`
  );
}
