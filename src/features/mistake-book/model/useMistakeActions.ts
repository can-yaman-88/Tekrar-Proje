import {
  normalizeMistake,
  useAddMistake,
  useDeleteMistake,
  useReopenMistake,
  useResolveMistake,
  useUpdateMistake,
} from '@entities/topic-mistake';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useCallback } from 'react';

const fail = (error: unknown) => showToast(describeError(error).message, 'danger');

/**
 * Everything the student can do to a book entry, with the feedback each one
 * deserves: a resolve can be taken back from the toast, a delete is asked for
 * first (by the screen), and nothing fails silently any more.
 */
export function useMistakeActions() {
  const resolveMutation = useResolveMistake();
  const reopenMutation = useReopenMistake();
  const deleteMutation = useDeleteMistake();
  const updateMutation = useUpdateMistake();
  const addMutation = useAddMistake();

  const { mutate: reopenMutate } = reopenMutation;
  const reopen = useCallback(
    (mistakeId: string, quiet = false) =>
      reopenMutate(mistakeId, {
        onSuccess: () => {
          if (!quiet) showToast('Madde yeniden açıldı; konunun görevlerinde yine karşına çıkacak.', 'info');
        },
        onError: fail,
      }),
    [reopenMutate],
  );

  const { mutate: resolveMutate } = resolveMutation;
  const resolve = useCallback(
    (mistakeId: string) =>
      resolveMutate(mistakeId, {
        onSuccess: () =>
          showToast('Çözüldü olarak işaretlendi.', 'success', {
            label: 'Geri al',
            onPress: () => reopen(mistakeId, true),
          }),
        onError: fail,
      }),
    [reopen, resolveMutate],
  );

  const { mutate: deleteMutate } = deleteMutation;
  const remove = useCallback(
    (mistakeId: string) =>
      deleteMutate(mistakeId, { onSuccess: () => showToast('Madde silindi.', 'info'), onError: fail }),
    [deleteMutate],
  );

  const { mutateAsync: updateAsync } = updateMutation;
  /** Resolves true when saved, so an inline editor knows to close. */
  const update = useCallback(
    async (mistakeId: string, body: string, concept: string | null): Promise<boolean> => {
      if (!normalizeMistake(body, concept)) {
        showToast('Takıldığın yeri en az iki harfle yaz.', 'danger');
        return false;
      }
      try {
        await updateAsync({ mistakeId, body, concept });
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [updateAsync],
  );

  const { mutateAsync: addAsync } = addMutation;
  const add = useCallback(
    async (topicId: string, body: string, concept: string | null): Promise<boolean> => {
      if (!normalizeMistake(body, concept)) {
        showToast('Takıldığın yeri en az iki harfle yaz.', 'danger');
        return false;
      }
      try {
        await addAsync({ topicId, body, concept });
        showToast('Deftere eklendi; bu konunun görevini açtığında karşına çıkacak.', 'success');
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [addAsync],
  );

  const busyId =
    (resolveMutation.isPending ? resolveMutation.variables : null) ??
    (reopenMutation.isPending ? reopenMutation.variables : null) ??
    (deleteMutation.isPending ? deleteMutation.variables : null) ??
    (updateMutation.isPending ? updateMutation.variables?.mistakeId : null) ??
    null;

  return {
    resolve,
    reopen: (mistakeId: string) => reopen(mistakeId),
    remove,
    update,
    add,
    busyId,
    isAdding: addMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}

export type MistakeActions = ReturnType<typeof useMistakeActions>;
