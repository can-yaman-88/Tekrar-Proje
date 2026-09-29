import { isHomework, nextStatusOnToggle, taskKeys, taskMutationKeys, taskRepository, type Task } from '@entities/task';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

const MAX_STEPS = 10;

/**
 * The steps of one task.
 *
 * Steps are a homework thing: the loop's own tasks (konsept, Feynman, sınav)
 * are single sittings and stay that way. Anything else already carries steps
 * because the student asked for them in a check-in, and those keep working.
 */
export function useSubtasks(task: Task, { onUngrouped }: { onUngrouped?: () => void } = {}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  // The same mutation key the task board uses, so a step ticked here is
  // queued and replayed exactly like one ticked on the card.
  const toggle = useMutation({
    mutationKey: taskMutationKeys.toggle,
    mutationFn: (step: Task) => taskRepository.updateStatus(step.id, nextStatusOnToggle(step)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const subtasks = useQuery({
    queryKey: taskKeys.subtasks(task.id),
    queryFn: () => taskRepository.listSubtasks(task.id),
  });

  const rows = subtasks.data ?? [];
  const canAdd = isHomework(task) || rows.length > 0;

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    [queryClient],
  );

  const add = useMutation({
    networkMode: 'always' as const,
    mutationFn: (title: string) =>
      taskRepository.addSubtask(task, {
        title,
        // The parent's estimate is shared out as steps are added, so a group
        // never costs more than the work it was created from.
        estimatedMinutes:
          task.estimatedMinutes === null ? null : Math.max(5, Math.round(task.estimatedMinutes / (rows.length + 1))),
        targetCount: null,
      }),
    onSuccess: async () => {
      setDraft('');
      await invalidate();
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  // "Grubu dağıt": the steps become tasks of their own. The container is
  // usually gone afterwards, so the screen showing it is told to leave.
  const ungroup = useMutation({
    mutationFn: () => taskRepository.ungroup(task.id),
    onSuccess: async (result) => {
      await invalidate();
      showToast(`${result.freed} adım ayrı görev oldu.`, 'success');
      if (result.container !== 'kept') onUngrouped?.();
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const remove = useMutation({
    networkMode: 'always' as const,
    mutationFn: (subtaskId: string) => taskRepository.remove(subtaskId),
    onSuccess: invalidate,
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  return {
    canAdd,
    isLoading: subtasks.isPending && canAdd,
    rows: rows.map((step) => ({
      id: step.id,
      title: step.title,
      isDone: step.status === 'completed',
      dueDate: step.dueDate,
      estimatedMinutes: step.estimatedMinutes,
    })),
    draft,
    onChangeDraft: setDraft,
    canSubmit: draft.trim().length > 1 && rows.length < MAX_STEPS && !add.isPending,
    isAdding: add.isPending,
    onAdd: () => {
      const title = draft.trim();
      if (title.length < 2) return;
      if (rows.length >= MAX_STEPS) {
        showToast(`Bir görevde en fazla ${MAX_STEPS} adım olabilir.`, 'info');
        return;
      }
      add.mutate(title.slice(0, 200));
    },
    onToggle: (subtaskId: string) => {
      const step = (subtasks.data ?? []).find((row) => row.id === subtaskId);
      if (step) toggle.mutate(step);
    },
    togglingId: toggle.isPending ? (toggle.variables?.id ?? null) : null,
    onRemove: (subtaskId: string) => remove.mutate(subtaskId),
    isRemoving: remove.isPending,
    /** Only a task that has steps can be taken apart. */
    canUngroup: rows.length > 0 && task.parentTaskId === null,
    onUngroup: () => ungroup.mutate(),
    isUngrouping: ungroup.isPending,
  };
}

export type SubtaskController = ReturnType<typeof useSubtasks>;
