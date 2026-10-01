import type { IsoDate } from '@contracts/enums.contract';
import { courseAccent, courseLabel } from '@entities/course';
import { diffInDays, formatShortDate } from '@shared/lib/date';
import {
  isOverdue,
  progressRatio,
  TASK_GROUP_LABEL,
  TASK_TYPE_LABEL,
  taskGroupOf,
  type TaskGroup,
} from '../domain/task.rules';
import type { Task } from '../domain/task.types';

/** Everything TaskCard renders, precomputed so the component stays dumb. */
export interface TaskCardModel {
  id: string;
  group: TaskGroup;
  title: string;
  subtitle: string;
  accent: string;
  meta: string[];
  dueLabel: string;
  isOverdue: boolean;
  isDone: boolean;
  isFailed: boolean;
  progress: number;
  progressLabel: string | null;
  /** Today's slice of a piece of homework, e.g. "bugün ~4 soru · 20 dk". */
  quotaLabel: string | null;
  /** The steps of a group task; empty for ordinary tasks. */
  subtasks: SubtaskRow[];
  /** "1/3" when this task has steps, else null. */
  subtaskProgress: string | null;
  /** Marked urgent by the student; open work only — a finished task is not urgent. */
  isUrgent: boolean;
  /** PDFs, photos and links on the task: the paperclip on the card. */
  attachmentCount: number;
}

export interface SubtaskRow {
  id: string;
  title: string;
  isDone: boolean;
  /** Steps for another day are shown but held back. */
  isToday: boolean;
  dueLabel: string | null;
}

export interface DailyShare {
  minutes: number;
  count: number | null;
}

export function toTaskCardModel(
  task: Task,
  today: IsoDate,
  share?: DailyShare | null,
  subtasks: readonly Task[] = [],
): TaskCardModel {
  const overdue = isOverdue(task, today);
  const lateBy = diffInDays(task.dueDate, today);
  // The card's own label has to agree with the chip it is filed under:
  // homework says "Ödev", not the type it happens to share with a quiz.
  const group = taskGroupOf(task);
  const meta = [group === 'homework' ? TASK_GROUP_LABEL.homework : TASK_TYPE_LABEL[task.type]];
  if (task.estimatedMinutes) meta.push(`${task.estimatedMinutes} dk`);
  if (task.source === 'ai_checkin_reschedule') meta.push('Ertelendi');
  if (task.source === 'spaced_repetition') meta.push('Aralıklı tekrar');

  return {
    id: task.id,
    group,
    title: task.title,
    subtitle: `${courseLabel(task.course)} · ${task.topic.title}`,
    accent: courseAccent(task.course),
    meta,
    dueLabel: overdue ? (lateBy === 1 ? 'Dün teslimdi' : `${lateBy} gün gecikti`) : `${formatShortDate(task.dueDate)} teslim`,
    isOverdue: overdue,
    isDone: task.status === 'completed',
    isFailed: task.status === 'failed',
    progress: progressRatio(task),
    // Accuracy is the more useful number when it exists: "6/10 doğru" says
    // what "10/10 çözüldü" hides.
    progressLabel:
      task.correctCount !== null && task.completedCount > 0
        ? `${task.correctCount}/${task.completedCount} doğru`
        : task.targetCount
          ? `${Math.min(task.completedCount, task.targetCount)}/${task.targetCount}`
          : null,
    quotaLabel: share
      ? share.count === null
        ? `Bugün ~${share.minutes} dk`
        : `Bugün ~${share.count} soru · ${share.minutes} dk`
      : null,
    subtasks: subtasks.map((step) => ({
      id: step.id,
      title: step.title,
      isDone: step.status === 'completed',
      isToday: step.dueDate <= today,
      dueLabel: step.dueDate === today ? null : formatShortDate(step.dueDate),
    })),
    subtaskProgress:
      subtasks.length === 0
        ? null
        : `${subtasks.filter((step) => step.status === 'completed').length}/${subtasks.length}`,
    isUrgent: task.isPriority && (task.status === 'pending' || task.status === 'in_progress'),
    attachmentCount: task.attachmentCount,
  };
}
