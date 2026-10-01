import type { IsoDate, TaskSource, TaskStatus, TaskType } from '@contracts/enums.contract';
import type { CourseRef } from '@entities/course';

export type { TaskSource, TaskStatus, TaskType };

/** Fields the user may edit from the task detail screen. */
export interface TaskPatch {
  title: string;
  type: TaskType;
  instructions: string | null;
  dueDate: IsoDate;
  targetCount: number | null;
  completedCount: number;
  estimatedMinutes: number | null;
  confidenceLevel: number | null;
  /** Earliest day this work should appear in the daily plan; null = derived. */
  startsOn: IsoDate | null;
  /** Days the student fixed by hand: minutes per day, 0 = that day is off. */
  dayAllocations: Readonly<Record<IsoDate, number>> | null;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  instructions: string | null;
  targetCount: number | null;
  completedCount: number;
  /** How many of the completed questions were right; null when never reported. */
  correctCount: number | null;
  estimatedMinutes: number | null;
  dueDate: IsoDate;
  /** Earliest day the work may be scheduled; null means a week before the deadline. */
  startsOn: IsoDate | null;
  /** Days the student fixed by hand: minutes per day, 0 = that day is off. */
  dayAllocations: Readonly<Record<IsoDate, number>> | null;
  /** The task this one is a step of; null for ordinary and parent tasks. */
  parentTaskId: string | null;
  status: TaskStatus;
  confidenceLevel: number | null;
  source: TaskSource;
  /** Marked urgent by the student, by hand or in a report: first on the board. */
  isPriority: boolean;
  completedAt: string | null;
  topic: { id: string; title: string };
  course: CourseRef;
  /** PDFs, photos and links added to this task (not its topic's others). */
  attachmentCount: number;
}

/** A task with its steps, as the board shows it. */
export interface TaskGroupModel {
  task: Task;
  subtasks: Task[];
}
