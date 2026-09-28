import { toCourseRef, type CourseRefRow } from '@entities/course';
import type { Tables } from '@shared/api/supabase';
import type { Task } from '../domain/task.types';

/** Single source of truth for the columns the Task domain model needs. */
export const TASK_SELECT =
  'id, type, title, instructions, target_count, completed_count, correct_count, estimated_minutes, due_date, starts_on, day_allocations, parent_task_id, status, confidence_level, source, completed_at, topic:topics!tasks_topic_fk(id, title, course:courses!topics_course_fk(id, name, code, color_hex))';

type TaskColumns = Pick<
  Tables<'tasks'>,
  | 'id'
  | 'type'
  | 'title'
  | 'instructions'
  | 'target_count'
  | 'completed_count'
  | 'correct_count'
  | 'estimated_minutes'
  | 'due_date'
  | 'starts_on'
  | 'day_allocations'
  | 'parent_task_id'
  | 'status'
  | 'confidence_level'
  | 'source'
  | 'completed_at'
>;

export interface TaskRow extends TaskColumns {
  topic: { id: string; title: string; course: CourseRefRow };
}

/**
 * The column is free-form JSON, so it is validated on the way in: anything
 * that is not "date → minutes" is dropped rather than trusted.
 */
function toDayAllocations(value: unknown): Record<string, number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const result: Record<string, number> = {};
  for (const [date, minutes] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) continue;
    result[date] = Math.round(minutes);
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    instructions: row.instructions,
    targetCount: row.target_count,
    completedCount: row.completed_count,
    correctCount: row.correct_count,
    estimatedMinutes: row.estimated_minutes,
    dueDate: row.due_date,
    startsOn: row.starts_on,
    dayAllocations: toDayAllocations(row.day_allocations),
    parentTaskId: row.parent_task_id,
    status: row.status,
    confidenceLevel: row.confidence_level,
    source: row.source,
    completedAt: row.completed_at,
    topic: { id: row.topic.id, title: row.topic.title },
    course: toCourseRef(row.topic.course),
  };
}
