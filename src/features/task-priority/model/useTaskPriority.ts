import { type Task, taskKeys, taskMutationKeys, taskRepository } from '@entities/task';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface SetPriorityVariables {
  taskId: string;
  isPriority: boolean;
}

/**
 * "Acil" by hand — the same flag a report sets with "fizik ödevi acil". The
 * report can do what the student can do, and the student can do what the
 * report can: neither is the only way to reach a setting.
 */
export function useTaskPriority(task: Task | null) {
  const queryClient = useQueryClient();
  const mutation = useMutation<Task, Error, SetPriorityVariables>({
    // Registered in mutationDefaults, so a tap made offline is sent later.
    mutationKey: taskMutationKeys.setPriority,
    mutationFn: ({ taskId, isPriority }) => taskRepository.setPriority(taskId, isPriority),
    onSuccess: (updated) => {
      queryClient.setQueryData(taskKeys.detail(updated.id), updated);
      showToast(updated.isPriority ? 'Acil olarak işaretlendi; listede en üste çıkar.' : 'Artık acil değil.', 'success');
    },
    onError: (error) => showToast(describeError(error).title, 'danger'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });

  return {
    isPriority: mutation.isPending ? (mutation.variables?.isPriority ?? false) : (task?.isPriority ?? false),
    isSaving: mutation.isPending,
    toggle: () => {
      if (task) mutation.mutate({ taskId: task.id, isPriority: !task.isPriority });
    },
  };
}

export type TaskPriorityController = ReturnType<typeof useTaskPriority>;
