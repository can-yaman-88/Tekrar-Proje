import type { IsoDate } from '@contracts/enums.contract';
import { nextStatusOnToggle, type Task, taskKeys, taskMutationKeys, taskRepository, withStatus } from '@entities/task';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ToggleContext {
  previous: Task[] | undefined;
}

/**
 * Optimistically flips a task on the Mission list, rolls back on failure and
 * reconciles with the server afterwards.
 */
export function useToggleTaskStatus(today: IsoDate) {
  const queryClient = useQueryClient();
  const key = taskKeys.mission(today);

  const mutation = useMutation<Task, Error, Task, ToggleContext>({
    mutationKey: taskMutationKeys.toggle,
    mutationFn: (task) => taskRepository.updateStatus(task.id, nextStatusOnToggle(task)),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      const next = nextStatusOnToggle(task);
      queryClient.setQueryData<Task[]>(key, (tasks) => tasks?.map((t) => (t.id === task.id ? withStatus(t, next) : t)));
      return { previous };
    },
    onError: (error, _task, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      showToast(`${describeError(error).title} — değişiklik geri alındı.`, 'danger');
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Task[]>(key, (tasks) => tasks?.map((t) => (t.id === updated.id ? updated : t)));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });

  return {
    toggle: (task: Task) => mutation.mutate(task),
    pendingTaskId: mutation.isPending ? mutation.variables?.id ?? null : null,
  };
}
