// The week, counted honestly.
//
// Everything here is arithmetic over rows the app already has: no estimates
// dressed up as measurements, no praise the numbers do not support. If the
// student timed their work the minutes are real; if they did not, the summary
// says so rather than quietly showing estimates as fact.
import type { IsoDate, TaskType } from '@contracts/enums.contract';
import { addDays, localDateOf } from '@shared/lib/date';

/** The same labels the task board uses, homework included. */
export type TaskGroup = 'concepts' | 'quiz' | 'feynman' | 'homework';

export interface SummaryTask {
  id: string;
  type: TaskType;
  group: TaskGroup;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rescheduled' | 'skipped';
  dueDate: IsoDate;
  estimatedMinutes: number | null;
  topicId: string;
  topicTitle: string;
  courseLabel: string;
}

export interface SummarySession {
  taskId: string;
  taskType: TaskType;
  startedAt: string;
  minutes: number;
  estimatedMinutes: number | null;
}

/** Time from the Focus Timer app: real minutes, but not tied to a task. */
export interface SummaryTimerSession {
  startedAt: string;
  minutes: number;
}

export interface SummaryTopic {
  id: string;
  title: string;
  courseLabel: string;
  easeFactor: number;
  nextReviewOn: IsoDate | null;
  failedTasks: number;
}

export interface DayRow {
  date: IsoDate;
  completed: number;
  minutes: number;
}

export interface GroupRow {
  group: TaskGroup;
  label: string;
  completed: number;
  total: number;
}

export interface CalibrationRow {
  label: string;
  estimated: number;
  actual: number;
  samples: number;
}

export interface WeekSummary {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  completed: number;
  failed: number;
  open: number;
  total: number;
  /** 0–1, of the work that was due this week. */
  completionRate: number;
  measuredMinutes: number;
  /** Estimated minutes of the work finished — the fallback when nothing was timed. */
  estimatedMinutes: number;
  hasMeasuredTime: boolean;
  checkinDays: number;
  byDay: DayRow[];
  byGroup: GroupRow[];
  calibration: CalibrationRow[];
  /** Topics that lost ground or failed this week. */
  struggling: SummaryTopic[];
  /** What next week already has waiting. */
  nextWeekReviews: SummaryTopic[];
  headline: string;
}

const GROUP_LABEL: Record<TaskGroup, string> = {
  concepts: 'Konsept',
  quiz: 'Sınav',
  feynman: 'Feynman',
  homework: 'Ödev',
};

const TYPE_LABEL: Partial<Record<TaskType, string>> = {
  concept_note: 'Konsept sayfası',
  quiz: '10 soruluk sınav',
  feynman: 'Feynman',
  advanced_problems: 'Zor sorular',
};

const WEAK_EASE = 2.2;
const MAX_LISTED_TOPICS = 5;
/** Below this many timed sessions a type's average says nothing. */
const MIN_CALIBRATION_SAMPLES = 2;

export interface WeekSummaryInput {
  weekStart: IsoDate;
  tasks: readonly SummaryTask[];
  sessions: readonly SummarySession[];
  /** Focus Timer stretches: counted as measured time, never in the estimate calibration. */
  timerSessions?: readonly SummaryTimerSession[];
  /** Days with a processed check-in. */
  checkinDates: readonly IsoDate[];
  topics: readonly SummaryTopic[];
}

export function buildWeekSummary({
  weekStart,
  tasks,
  sessions,
  timerSessions = [],
  checkinDates,
  topics,
}: WeekSummaryInput): WeekSummary {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = tasks.filter((task) => task.dueDate >= weekStart && task.dueDate <= weekEnd);

  const completedTasks = inWeek.filter((task) => task.status === 'completed');
  const failed = inWeek.filter((task) => task.status === 'failed').length;
  const open = inWeek.filter((task) => task.status === 'pending' || task.status === 'in_progress').length;
  const total = inWeek.length;

  const inThisWeek = (session: { startedAt: string }) => {
    const day = localDateOf(session.startedAt);
    return day >= weekStart && day <= weekEnd;
  };
  const weekSessions = sessions.filter(inThisWeek);
  const weekTimerSessions = timerSessions.filter(inThisWeek);
  const measuredMinutes = [...weekSessions, ...weekTimerSessions].reduce((sum, session) => sum + session.minutes, 0);
  const estimatedMinutes = completedTasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);

  const minutesByDay = new Map<IsoDate, number>();
  for (const session of [...weekSessions, ...weekTimerSessions]) {
    const day = localDateOf(session.startedAt);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + session.minutes);
  }

  const byDay: DayRow[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const done = completedTasks.filter((task) => task.dueDate === date).length;
    const measured = minutesByDay.get(date);
    const fallback = completedTasks
      .filter((task) => task.dueDate === date)
      .reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
    return { date, completed: done, minutes: measured ?? fallback };
  });

  const byGroup: GroupRow[] = (['concepts', 'quiz', 'feynman', 'homework'] as const).map((group) => ({
    group,
    label: GROUP_LABEL[group],
    completed: completedTasks.filter((task) => task.group === group).length,
    total: inWeek.filter((task) => task.group === group).length,
  }));

  // Estimate versus stopwatch, per kind of work — the planner's budgets rest on
  // these numbers, so it is worth seeing where they are wrong.
  const byType = new Map<TaskType, { actual: number; estimated: number; samples: number }>();
  for (const session of weekSessions) {
    const current = byType.get(session.taskType) ?? { actual: 0, estimated: 0, samples: 0 };
    current.actual += session.minutes;
    current.estimated += session.estimatedMinutes ?? 0;
    current.samples += 1;
    byType.set(session.taskType, current);
  }
  const calibration: CalibrationRow[] = [...byType.entries()]
    .filter(([, value]) => value.samples >= MIN_CALIBRATION_SAMPLES && value.estimated > 0)
    .map(([type, value]) => ({
      label: TYPE_LABEL[type] ?? type,
      estimated: Math.round(value.estimated / value.samples),
      actual: Math.round(value.actual / value.samples),
      samples: value.samples,
    }))
    .sort((a, b) => b.samples - a.samples);

  const failedTopicIds = new Set(inWeek.filter((task) => task.status === 'failed').map((task) => task.topicId));
  const struggling = topics
    .filter((topic) => failedTopicIds.has(topic.id) || topic.easeFactor < WEAK_EASE)
    .sort((a, b) => a.easeFactor - b.easeFactor)
    .slice(0, MAX_LISTED_TOPICS);

  const nextWeekEnd = addDays(weekEnd, 7);
  const nextWeekReviews = topics
    .filter((topic) => topic.nextReviewOn !== null && topic.nextReviewOn > weekEnd && topic.nextReviewOn <= nextWeekEnd)
    .sort((a, b) => (a.nextReviewOn ?? '').localeCompare(b.nextReviewOn ?? ''))
    .slice(0, MAX_LISTED_TOPICS);

  const completionRate = total === 0 ? 0 : completedTasks.length / total;
  const checkinDays = new Set(checkinDates.filter((date) => date >= weekStart && date <= weekEnd)).size;

  return {
    weekStart,
    weekEnd,
    completed: completedTasks.length,
    failed,
    open,
    total,
    completionRate,
    measuredMinutes,
    estimatedMinutes,
    hasMeasuredTime: measuredMinutes > 0,
    checkinDays,
    byDay,
    byGroup,
    calibration,
    struggling,
    nextWeekReviews,
    headline: headlineFor({ total, completed: completedTasks.length, failed, completionRate, checkinDays }),
  };
}

function headlineFor({
  total,
  completed,
  failed,
  completionRate,
  checkinDays,
}: {
  total: number;
  completed: number;
  failed: number;
  completionRate: number;
  checkinDays: number;
}): string {
  if (total === 0) return 'Bu hafta planlanmış iş yoktu.';
  if (completed === 0) return `${total} görev planlandı, hiçbiri kapanmadı. Gelecek hafta daha küçük bir planla başla.`;
  if (completionRate >= 0.9) return `${completed}/${total} görev bitti. Plan gerçeğe oturmuş.`;
  if (completionRate >= 0.6) {
    return failed > 0
      ? `${completed}/${total} görev bitti, ${failed} tanesi takıldı.`
      : `${completed}/${total} görev bitti. Kalanı gelecek haftaya taşındı.`;
  }
  return checkinDays <= 2
    ? `${completed}/${total} görev bitti. Değerlendirme az yazıldığı için plan da körlemesine ilerledi.`
    : `${completed}/${total} görev bitti. Plan haftaya sığmıyor; kapasiteyi düşürmek gerekebilir.`;
}
