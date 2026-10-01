import { zodResolver } from '@hookform/resolvers/zod';
import {
  TASK_TYPE_BY_GROUP,
  editableGroupOf,
  taskKeys,
  taskMutationKeys,
  taskRepository,
  type Task,
  type TaskPatch,
  type TaskStatus,
} from '@entities/task';
import { reviewKeys, topicKeys } from '@entities/topic';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { TaskEditSchema, type TaskEditOutput, type TaskEditValues } from '../domain/task-edit.schema';

const toFormValues = (task: Task): TaskEditValues => ({
  // Homework has no label of its own to edit; it falls back to what it is.
  type: TASK_TYPE_BY_GROUP[editableGroupOf(task)],
  instructions: task.instructions ?? '',
  dueDate: task.dueDate,
  startsOn: task.startsOn ?? '',
  targetCount: task.targetCount ?? '',
  completedCount: task.completedCount,
  estimatedMinutes: task.estimatedMinutes ?? '',
});

/**
 * Edit form + status change + delete for one task.
 * Only ever called with a loaded task: mounting it with a placeholder would
 * freeze the form on the placeholder's values (RHF reads defaults once).
 */
export function useTaskEditForm(task: Task, options: { onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: taskKeys.all });

  const form = useForm<TaskEditValues, unknown, TaskEditOutput>({
    resolver: zodResolver(TaskEditSchema),
    defaultValues: toFormValues(task),
  });

  // A check-in or a status change can rewrite the task while this screen is
  // open; adopt the new values unless the user has unsaved edits.
  const isDirty = form.formState.isDirty;
  useEffect(() => {
    if (!isDirty) form.reset(toFormValues(task));
  }, [task, isDirty, form]);

  const save = useMutation({
    mutationKey: taskMutationKeys.update,
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) => taskRepository.update(taskId, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(taskKeys.detail(task.id), updated);
      form.reset(toFormValues(updated));
      showToast('Görev güncellendi.', 'success');
      return invalidate();
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const changeStatus = useMutation({
    mutationKey: taskMutationKeys.setStatus,
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      taskRepository.updateStatus(taskId, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(taskKeys.detail(task.id), updated);
      // Finishing or failing work moves its topic's review schedule too.
      return Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: topicKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
      ]);
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const remove = useMutation({
    mutationKey: taskMutationKeys.remove,
    mutationFn: (taskId: string) => taskRepository.remove(taskId),
    onSuccess: async () => {
      await invalidate();
      showToast('Görev silindi.', 'success');
      options.onDeleted();
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  return {
    // Deleting a task never deletes its material: it stays with the topic.
    deleteMessage:
      task.attachmentCount > 0
        ? 'Bu görev ve notları kalıcı olarak silinecek. Ekleri silinmez; konunun eklerinde kalır.'
        : 'Bu görev ve notları kalıcı olarak silinecek.',
    control: form.control,
    errors: form.formState.errors,
    isDirty: form.formState.isDirty,
    // A failed validation used to do nothing visible when the offending field
    // was scrolled out of view; say it out loud instead.
    onSubmit: form.handleSubmit(
      (values) =>
        save.mutate({
          taskId: task.id,
          patch: {
            title: task.title,
            type: values.type,
            instructions: values.instructions,
            dueDate: values.dueDate,
            startsOn: values.startsOn,
            // The allocation table has its own card; editing the task must not
            // silently wipe the days the student pinned there.
            dayAllocations: task.dayAllocations,
            targetCount: values.targetCount,
            completedCount: values.completedCount,
            estimatedMinutes: values.estimatedMinutes,
            confidenceLevel: task.confidenceLevel,
          },
        }),
      (errors) => {
        const first = Object.values(errors).find((error) => error?.message);
        showToast(first?.message ?? 'Formda hatalı bir alan var.', 'danger');
      },
    ),
    isSaving: save.isPending,
    status: task.status,
    onChangeStatus: (status: TaskStatus) => changeStatus.mutate({ taskId: task.id, status }),
    isChangingStatus: changeStatus.isPending,
    onDelete: () => remove.mutate(task.id),
    isDeleting: remove.isPending,
  };
}

export type TaskEditController = ReturnType<typeof useTaskEditForm>;
