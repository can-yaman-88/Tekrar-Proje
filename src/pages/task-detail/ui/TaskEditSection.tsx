import type { Task } from '@entities/task';
import { TaskEditForm, useTaskEditForm } from '@features/task-edit';
import { useRouter } from 'expo-router';

/**
 * Own component on purpose: the edit form must be created with the real task,
 * never with a placeholder, or its fields would stay frozen on the placeholder.
 */
export function TaskEditSection({ task }: { task: Task }) {
  const router = useRouter();
  const form = useTaskEditForm(task, { onDeleted: () => router.back() });
  return <TaskEditForm form={form} />;
}
