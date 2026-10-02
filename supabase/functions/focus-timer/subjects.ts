import type { FocusTimerSubjectsResponse } from '../_shared/contracts/focus-timer.contract.ts';

export type TimerTask = FocusTimerSubjectsResponse['tasks'][number];

export interface OpenTaskRow {
  id: string;
  topic_id: string;
  parent_task_id: string | null;
  title: string;
  type: string;
  due_date: string;
  estimated_minutes: number | null;
}

/** How far back an open task is still offered (it is overdue, not forgotten), and how far ahead. */
export const TASK_WINDOW = { pastDays: 42, futureDays: 21 } as const;

/**
 * The work the timer can file time under. A group task is only a container —
 * its steps carry the minutes, and timing the container as well would count
 * the same hour twice in the capacity learner — so containers are left out
 * and their steps carry the container's title for context.
 *
 * @param containerIds every task that has steps, open or not, in or out of the window
 * @param titles titles of the containers the listed steps belong to
 * @param measured minutes already measured per task, from both clocks
 */
export function buildTaskList(
  open: readonly OpenTaskRow[],
  containerIds: ReadonlySet<string>,
  titles: ReadonlyMap<string, string>,
  measured: ReadonlyMap<string, number>,
): TimerTask[] {
  return open
    .filter((task) => !containerIds.has(task.id))
    .map((task) => ({
      id: task.id,
      topicId: task.topic_id,
      title: task.title,
      parentTitle: task.parent_task_id ? (titles.get(task.parent_task_id) ?? null) : null,
      type: task.type,
      dueDate: task.due_date,
      estimatedMinutes: task.estimated_minutes,
      measuredMinutes: measured.get(task.id) ?? 0,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, 'tr'));
}

/** Adds up minutes per task from rows of either clock. */
export function sumByTask(rows: readonly { task_id: string | null; minutes: number | null }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.task_id === null || row.minutes === null) continue;
    totals.set(row.task_id, (totals.get(row.task_id) ?? 0) + row.minutes);
  }
  return totals;
}

export function addDaysUtc(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
