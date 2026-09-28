import type { Task } from '@entities/task';
import { SubtaskSection, useSubtasks } from '@features/task-subtasks';

/** Mounted with a loaded task; the hook decides whether steps apply at all. */
export function TaskSubtaskSection({ task }: { task: Task }) {
  return <SubtaskSection subtasks={useSubtasks(task)} />;
}
