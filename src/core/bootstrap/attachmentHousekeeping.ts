import { attachmentMutationKeys, attachmentRepository, sweepOutbox, type NewAttachment } from '@entities/attachment';
import { useSessionStore } from '@entities/session';
import { queryClient } from '@shared/api/query';
import { matchMutation, onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Once the offline queue is back from disk: files in the outbox that no
 * queued upload refers to any more are left-overs (an upload that failed for
 * good) and are deleted.
 */
export function sweepAttachmentOutbox(): void {
  const keep = new Set<string>();
  for (const mutation of queryClient.getMutationCache().getAll()) {
    if (!matchMutation({ mutationKey: attachmentMutationKeys.add }, mutation)) continue;
    if (mutation.state.status === 'success') continue;
    const id = (mutation.state.variables as NewAttachment | undefined)?.id;
    if (id) keep.add(id);
  }
  sweepOutbox(keep);
}

/**
 * Files of deleted attachments — deleted on another device, or along with a
 * topic or a course — are removed from storage when the app comes to the
 * foreground signed in and online.
 */
export function useAttachmentTrash(): void {
  const signedIn = useSessionStore((s) => s.status === 'signedIn');

  useEffect(() => {
    if (!signedIn) return;
    const drain = () => {
      if (onlineManager.isOnline()) void attachmentRepository.drainTrash().catch(() => undefined);
    };
    drain();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') drain();
    });
    return () => subscription.remove();
  }, [signedIn]);
}
