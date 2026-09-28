// Clearing the pile.
//
// Every planner eventually produces a backlog: a week goes badly, the list
// keeps the debt, and the debt is what makes the app unpleasant to open. The
// answer is not to hide it but to make settling it a two-minute decision —
// spread what still matters over the days ahead, close what does not.
//
// Spreading is greedy on purpose: the oldest work goes first, onto the
// earliest day that can hold it. Nobody wants a clever algorithm here; they
// want the pile gone by Friday.
import type { IsoDate } from '../contracts/enums.contract.ts';
import type { DayBudget } from './workload.ts';

export interface BacklogTask {
  id: string;
  /** The day it was originally due — the oldest debt is settled first. */
  dueDate: IsoDate;
  estimatedMinutes: number;
}

export interface BacklogPlacement {
  taskId: string;
  date: IsoDate;
}

export interface BacklogPlan {
  placements: BacklogPlacement[];
  /** Work that did not fit anywhere in the window, at its original size. */
  unplacedMinutes: number;
}

/** A task with no estimate still takes time; this is the assumption. */
const DEFAULT_TASK_MINUTES = 30;

export function rescheduleBacklog({
  days,
  tasks,
}: {
  days: readonly DayBudget[];
  tasks: readonly BacklogTask[];
}): BacklogPlan {
  const free = new Map<IsoDate, number>(
    days.map((day) => [day.date, Math.max(0, day.capacityMinutes - day.committedMinutes)]),
  );

  const ordered = [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const placements: BacklogPlacement[] = [];
  let unplacedMinutes = 0;

  for (const task of ordered) {
    const minutes = task.estimatedMinutes > 0 ? task.estimatedMinutes : DEFAULT_TASK_MINUTES;
    const day = days.find((candidate) => (free.get(candidate.date) ?? 0) >= minutes);

    if (!day) {
      // Nothing left anywhere: the student is told rather than handed a day
      // that was already full.
      unplacedMinutes += minutes;
      continue;
    }

    free.set(day.date, (free.get(day.date) ?? 0) - minutes);
    placements.push({ taskId: task.id, date: day.date });
  }

  return { placements, unplacedMinutes };
}

/** Work older than this is debt, not "today's list running late". */
export const BACKLOG_AFTER_DAYS = 3;
