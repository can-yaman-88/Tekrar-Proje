import type { IsoDate } from '@contracts/enums.contract';
import { isOverdue, priorityScore, toTaskCardModel, type DailyShare, type Task } from '@entities/task';
import type { TaskSection } from '@widgets/today-task-list';

export interface MissionSummary {
  sections: TaskSection[];
  done: number;
  total: number;
  overdue: number;
}

/** Pure: groups and orders the day's tasks. Unit-testable without React. */
export function buildMissionSections(
  all: readonly Task[],
  today: IsoDate,
  nextExamDays: ReadonlyMap<string, number>,
  /** Today's slice of each piece of homework, keyed by task id. */
  shares: ReadonlyMap<string, DailyShare> = new Map(),
): MissionSummary {
  const score = (t: Task) => priorityScore(t, today, nextExamDays.get(t.course.id) ?? null);
  const byPriority = (a: Task, b: Task) => score(b) - score(a);

  // A group task is one card: its steps ride inside it rather than competing
  // with it in the list. A step whose parent is out of view keeps its own card,
  // which is better than vanishing.
  const byParent = new Map<string, Task[]>();
  const ids = new Set(all.map((task) => task.id));
  for (const task of all) {
    if (task.parentTaskId === null || !ids.has(task.parentTaskId)) continue;
    byParent.set(task.parentTaskId, [...(byParent.get(task.parentTaskId) ?? []), task]);
  }
  const subtasksOf = (task: Task): Task[] => byParent.get(task.id) ?? [];
  const tasks = all.filter((task) => task.parentTaskId === null || !ids.has(task.parentTaskId));

  const overdue = tasks.filter((t) => isOverdue(t, today)).sort(byPriority);
  const open = tasks.filter((t) => !isOverdue(t, today) && (t.status === 'pending' || t.status === 'in_progress'));
  const closed = tasks.filter((t) => t.status === 'completed' || t.status === 'failed');

  const sections: TaskSection[] = [
    { key: 'overdue' as const, title: 'Geciken', data: overdue },
    { key: 'today' as const, title: 'Bugün', data: open.sort(byPriority) },
    { key: 'done' as const, title: 'Bitenler', data: closed },
  ]
    .filter((s) => s.data.length > 0)
    .map((s) => ({ ...s, data: s.data.map((t) => toTaskCardModel(t, today, shares.get(t.id), subtasksOf(t))) }));

  const todayTasks = tasks.filter((t) => t.dueDate === today);
  return {
    sections,
    done: todayTasks.filter((t) => t.status === 'completed').length,
    total: todayTasks.length,
    overdue: overdue.length,
  };
}
