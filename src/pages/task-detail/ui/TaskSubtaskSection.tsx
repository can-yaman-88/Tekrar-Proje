import type { Task } from '@entities/task';
import { SubtaskSection, useSubtasks } from '@features/task-subtasks';
import { useRouter } from 'expo-router';

/** Mounted with a loaded task; the hook decides whether steps apply at all. */
export function TaskSubtaskSection({ task }: { task: Task }) {
  const router = useRouter();
  // A taken-apart group has no screen left to show: go back to the list.
  return <SubtaskSection subtasks={useSubtasks(task, { onUngrouped: () => router.back() })} />;
}
