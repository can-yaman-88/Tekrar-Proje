// Pure business rules for tasks — no React, no Supabase.
import type { IsoDate } from '@contracts/enums.contract';
import { diffInDays } from '@shared/lib/date';
import type { Task, TaskSource, TaskStatus, TaskType } from './task.types';

export const isOpen = (task: Pick<Task, 'status'>): boolean =>
  task.status === 'pending' || task.status === 'in_progress';

export const isOverdue = (task: Pick<Task, 'status' | 'dueDate'>, today: IsoDate): boolean =>
  isOpen(task) && task.dueDate < today;

/** Work the student was given, with a deadline of its own. */
export const HOMEWORK_SOURCES: readonly TaskSource[] = ['homework', 'ai_attachment'];

export const isHomework = (task: Pick<Task, 'source'>): boolean => HOMEWORK_SOURCES.includes(task.source);

/** Work the review schedule put on the board: finishing it asks how it went. */
export const isReviewTask = (task: Pick<Task, 'source'>): boolean => task.source === 'spaced_repetition';

/**
 * Work that has to be spread over the days before its deadline.
 *
 * Only homework qualifies: the weekly planner already chose a day for every
 * loop task, and pulling those forward would undo its work. A homework's
 * deadline, on the other hand, comes from outside and says nothing about when
 * to sit down for it.
 */
export const isDeadlineWork = (task: Pick<Task, 'source' | 'status' | 'dueDate'>, today: IsoDate): boolean =>
  isOpen(task) && task.dueDate > today && isHomework(task);

export function progressRatio(task: Pick<Task, 'status' | 'targetCount' | 'completedCount'>): number {
  if (task.status === 'completed') return 1;
  if (!task.targetCount) return 0;
  return Math.min(1, task.completedCount / task.targetCount);
}

/** Tapping the checkbox toggles completion; un-completing keeps partial progress visible. */
export function nextStatusOnToggle(task: Pick<Task, 'status' | 'completedCount'>): TaskStatus {
  if (task.status === 'completed') return task.completedCount > 0 ? 'in_progress' : 'pending';
  return 'completed';
}

export function withStatus(task: Task, status: TaskStatus, now: Date = new Date()): Task {
  return { ...task, status, completedAt: status === 'completed' ? now.toISOString() : null };
}

const TYPE_WEIGHT: Record<TaskType, number> = {
  mock_exam: 4,
  // The loop's own order: finishing a started topic beats starting a new one.
  advanced_problems: 4,
  feynman: 4,
  quiz: 3,
  concept_note: 2,
  problem_set: 3,
  derivation: 3,
  spaced_review: 2,
  concept_review: 1,
};

/**
 * Higher = do first. Overdue work dominates, then exam proximity, then
 * low self-reported confidence, then task type.
 */
export function priorityScore(task: Task, today: IsoDate, daysToNextExam: number | null): number {
  const overdueDays = Math.max(0, diffInDays(task.dueDate, today));
  const examPressure = daysToNextExam === null ? 0 : Math.max(0, 14 - daysToNextExam) * 2;
  const confidenceGap = task.confidenceLevel === null ? 0 : (5 - task.confidenceLevel) * 3;
  // Homework answers to a date someone else set, so it climbs as that date
  // approaches — but never above work that is already late.
  const deadlinePressure = isHomework(task)
    ? Math.max(0, DEADLINE_HORIZON_DAYS - Math.max(0, diffInDays(today, task.dueDate))) * 3
    : 0;
  return overdueDays * 10 + examPressure + confidenceGap + deadlinePressure + TYPE_WEIGHT[task.type];
}

/** Beyond this many days a deadline exerts no pull on today's order. */
const DEADLINE_HORIZON_DAYS = 8;

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Bekliyor',
  in_progress: 'Devam ediyor',
  completed: 'Tamamlandı',
  failed: 'Takıldım',
  rescheduled: 'Ertelendi',
  skipped: 'Atlandı',
};

/** Statuses the user can set by hand; `rescheduled` is only produced by check-ins. */
export const EDITABLE_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'skipped'] as const;

/**
 * Tasks are shown under four labels: the three steps of the study loop, plus
 * homework. Older task types (and the harder problem set) fold into the label
 * that matches what they ask for.
 */
export type TaskGroup = 'concepts' | 'quiz' | 'feynman' | 'homework';

export const TASK_GROUPS: readonly TaskGroup[] = ['concepts', 'quiz', 'feynman', 'homework'];

export const TASK_GROUP_LABEL: Record<TaskGroup, string> = {
  concepts: 'Concepts',
  quiz: 'Sınav',
  feynman: 'Feynman',
  homework: 'Ödev',
};

const GROUP_BY_TYPE: Record<TaskType, TaskGroup> = {
  concept_note: 'concepts',
  concept_review: 'concepts',
  quiz: 'quiz',
  advanced_problems: 'quiz',
  problem_set: 'quiz',
  mock_exam: 'quiz',
  feynman: 'feynman',
  derivation: 'feynman',
  spaced_review: 'feynman',
};

/**
 * Homework is told apart by where it came from, not by its type: a problem set
 * the teacher set and a problem set the planner invented are the same type but
 * a different kind of obligation.
 */
export const taskGroupOf = (task: Pick<Task, 'type' | 'source'>): TaskGroup =>
  isHomework(task) ? 'homework' : GROUP_BY_TYPE[task.type];

/** The task type each label creates when the user picks it by hand. */
export type EditableTaskType = 'concept_note' | 'quiz' | 'feynman';

/** Homework keeps whatever type it has; the label is derived, not chosen. */
export const TASK_TYPE_BY_GROUP: Record<Exclude<TaskGroup, 'homework'>, EditableTaskType> = {
  concepts: 'concept_note',
  quiz: 'quiz',
  feynman: 'feynman',
};

/** Which of the three editable labels a task sits under, homework included. */
export const editableGroupOf = (task: Pick<Task, 'type' | 'source'>): Exclude<TaskGroup, 'homework'> =>
  GROUP_BY_TYPE[task.type] === 'homework' ? 'quiz' : (GROUP_BY_TYPE[task.type] as Exclude<TaskGroup, 'homework'>);

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  concept_note: 'Concepts',
  concept_review: 'Concepts',
  quiz: 'Sınav',
  advanced_problems: 'Sınav · ileri seviye',
  problem_set: 'Sınav',
  mock_exam: 'Sınav',
  feynman: 'Feynman',
  derivation: 'Feynman',
  spaced_review: 'Feynman',
};
