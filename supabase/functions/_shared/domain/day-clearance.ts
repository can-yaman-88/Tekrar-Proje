// Emptying a day the student cannot work.
//
// "Pazar gününü boşalt, o gün hiçbir şey yapamam" is an instruction with a
// hard part and an easy part. The easy part is taking the work off Sunday.
// The hard part is that the work still has to go somewhere, and the honest
// answer is rarely "tomorrow": it is whichever days still have room.
//
// Two rules the greedy spread in `backlog.ts` does not have:
//
//   · A deadline is not negotiable. Homework due Sunday cannot be moved to
//     Monday to make Sunday easier — it is pulled FORWARD instead, into the
//     days before the deadline, and only lands after it when there is nowhere
//     earlier left at all.
//   · The day gets emptied either way. If nothing fits anywhere, the work
//     still leaves the closed day and goes to the emptiest day in the window.
//     Overfilling a day the student can work on is a compromise; leaving work
//     on a day they told us they cannot is not.
import type { IsoDate } from '../contracts/enums.contract.ts';
import type { DayBudget } from './workload.ts';

export interface ClearedTask {
  id: string;
  /** The day it is being taken off — also the deadline, when it has one. */
  dueDate: IsoDate;
  estimatedMinutes: number;
  /** Work with a real deadline (homework, a handed-in sheet). */
  hasDeadline: boolean;
}

export interface ClearancePlacement {
  taskId: string;
  date: IsoDate;
}

export interface ClearancePlan {
  placements: ClearancePlacement[];
  /** Minutes that had to be placed on a day that was already full. */
  overflowMinutes: number;
  /** Deadline work that could not be fitted before its own deadline. */
  lateTaskIds: string[];
}

/** A task with no estimate still takes time; this is the assumption. */
const DEFAULT_TASK_MINUTES = 30;

const minutesOf = (task: ClearedTask): number =>
  task.estimatedMinutes > 0 ? task.estimatedMinutes : DEFAULT_TASK_MINUTES;

export function planDayClearance({
  days,
  tasks,
}: {
  days: readonly DayBudget[];
  tasks: readonly ClearedTask[];
}): ClearancePlan {
  if (days.length === 0) return { placements: [], overflowMinutes: 0, lateTaskIds: [] };

  const free = new Map<IsoDate, number>(
    days.map((day) => [day.date, Math.max(0, day.capacityMinutes - day.committedMinutes)]),
  );

  const placements: ClearancePlacement[] = [];
  const lateTaskIds: string[] = [];
  let overflowMinutes = 0;

  const take = (date: IsoDate, minutes: number): void => {
    const room = free.get(date) ?? 0;
    if (minutes > room) overflowMinutes += minutes - room;
    free.set(date, room - minutes);
  };

  /** The day with the most room left; ties go to the earliest, as always. */
  const emptiestDay = (): IsoDate =>
    days.reduce((best, day) => ((free.get(day.date) ?? 0) > (free.get(best.date) ?? 0) ? day : best), days[0]!).date;

  // Deadlines first, earliest deadline first: they have the fewest days to
  // choose from, so they choose before anything else takes the room.
  const ordered = [...tasks].sort(
    (a, b) =>
      Number(b.hasDeadline) - Number(a.hasDeadline) ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.id.localeCompare(b.id),
  );

  for (const task of ordered) {
    const minutes = minutesOf(task);
    const beforeDeadline = task.hasDeadline
      ? days.find((day) => day.date < task.dueDate && (free.get(day.date) ?? 0) >= minutes)
      : undefined;
    const anyRoom = beforeDeadline ?? days.find((day) => (free.get(day.date) ?? 0) >= minutes);
    const date = anyRoom?.date ?? emptiestDay();

    if (task.hasDeadline && date > task.dueDate) lateTaskIds.push(task.id);
    take(date, minutes);
    placements.push({ taskId: task.id, date });
  }

  return { placements, overflowMinutes, lateTaskIds };
}
