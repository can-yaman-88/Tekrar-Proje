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
import { onlineManager } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback } from 'react';

const fail = (error: unknown) => showToast(`${describeError(error).message} Değişiklik geri alındı.`, 'danger');

/** Said once per write, so the student knows an offline change is not lost. */
const queuedNote = () => (onlineManager.isOnline() ? '' : ' Bağlantı gelince kaydedilecek.');

const TOO_SHORT = 'Takıldığın yeri en az iki harfle yaz.';

/**
 * Everything the student can do to a book entry, with the feedback each one
 * deserves: a resolve can be taken back from the toast, a delete is asked for
 * first (by the screen), and nothing fails silently.
 *
 * Every write shows at once and waits in the offline queue when there is no
 * connection; a write the server refuses is rolled back with a toast.
 */
export function useMistakeActions() {
  const resolveMutation = useResolveMistake();
  const reopenMutation = useReopenMistake();
  const deleteMutation = useDeleteMistake();
  const updateMutation = useUpdateMistake();
  const addMutation = useAddMistake();

  const { mutate: reopenMutate } = reopenMutation;
  const reopen = useCallback(
    (mistakeId: string, quiet = false) => {
      reopenMutate(mistakeId, { onError: fail });
      if (!quiet) showToast(`Madde yeniden açıldı; konunun görevlerinde yine karşına çıkacak.${queuedNote()}`, 'info');
    },
    [reopenMutate],
  );

  const { mutate: resolveMutate } = resolveMutation;
  const resolve = useCallback(
    (mistakeId: string) => {
      resolveMutate({ mistakeId, at: new Date().toISOString() }, { onError: fail });
      showToast(`Çözüldü olarak işaretlendi.${queuedNote()}`, 'success', {
        label: 'Geri al',
        onPress: () => reopen(mistakeId, true),
      });
    },
    [reopen, resolveMutate],
  );

  const { mutate: deleteMutate } = deleteMutation;
  const remove = useCallback(
    (mistakeId: string) => {
      deleteMutate(mistakeId, { onError: fail });
      showToast(`Madde silindi.${queuedNote()}`, 'info');
    },
    [deleteMutate],
  );

  const { mutate: updateMutate } = updateMutation;
  /** True when the change was taken, so an inline editor knows to close. */
  const update = useCallback(
    (mistakeId: string, body: string, concept: string | null): boolean => {
      if (!normalizeMistake(body, concept)) {
        showToast(TOO_SHORT, 'danger');
        return false;
      }
      updateMutate({ mistakeId, body, concept }, { onError: fail });
      const note = queuedNote();
      if (note) showToast(`Düzeltildi.${note}`, 'info');
      return true;
    },
    [updateMutate],
  );

  const { mutate: addMutate } = addMutation;
  const add = useCallback(
    (topicId: string, body: string, concept: string | null): boolean => {
      if (!normalizeMistake(body, concept)) {
        showToast(TOO_SHORT, 'danger');
        return false;
      }
      addMutate({ id: Crypto.randomUUID(), topicId, body, concept }, { onError: fail });
      showToast(`Deftere eklendi; bu konunun görevini açtığında karşına çıkacak.${queuedNote()}`, 'success');
      return true;
    },
    [addMutate],
  );

  // A write waiting for the network is not "busy": the entry already shows
  // the result, and the queue keeps the order.
  const inFlight = <T,>(mutation: { isPending: boolean; isPaused: boolean; variables: T | undefined }) =>
    mutation.isPending && !mutation.isPaused ? mutation.variables : undefined;

  const busyId =
    inFlight(resolveMutation)?.mistakeId ??
    inFlight(reopenMutation) ??
    inFlight(deleteMutation) ??
    inFlight(updateMutation)?.mistakeId ??
    null;

  return {
    resolve,
    reopen: (mistakeId: string) => reopen(mistakeId),
    remove,
    update,
    add,
    busyId,
  };
}

export type MistakeActions = ReturnType<typeof useMistakeActions>;
