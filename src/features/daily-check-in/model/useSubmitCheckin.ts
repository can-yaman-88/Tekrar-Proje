import type { DailyCheckinResponse } from '@contracts/daily-checkin.contract';
import { attachmentRepository, checkinHistoryKeys, dailyLogKeys, dailyLogRepository } from '@entities/daily-log';
import { examKeys } from '@entities/exam';
import { taskKeys } from '@entities/task';
import { taskNoteKeys } from '@entities/task-note';
import { taskSessionKeys } from '@entities/task-session';
import { topicKeys } from '@entities/topic';
import { topicMistakeKeys } from '@entities/topic-mistake';
import { isAppError } from '@shared/lib/errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { processCheckin } from '../data/checkin.api';
import { decideRecovery } from '../domain/recovery';
import { reportDateFor } from '../domain/report-date';
import { useCheckinDraftStore } from './checkin-draft.store';
import type { PickedAttachment } from './useCheckinAttachments';

export interface CheckinSubmission {
  report: string;
  attachments: readonly PickedAttachment[];
}

/**
 * Retry-safe submission:
 *  1. insert a `pending` daily_log (reused if a previous attempt created it),
 *  2. upload the attachments that are not uploaded yet,
 *  3. ask the Edge Function to process the log.
 * A failure at any step leaves the log in place, so retrying continues where it stopped.
 */
export function useSubmitCheckin() {
  const queryClient = useQueryClient();

  return useMutation<DailyCheckinResponse, Error, CheckinSubmission>({
    mutationKey: ['daily-checkin', 'submit'],
    // The check-in screen shows its own progress and result, so this must run
    // and report rather than sit paused in a queue.
    networkMode: 'always',
    mutationFn: async ({ report, attachments }) => {
      const store = useCheckinDraftStore.getState();
      // After midnight the report is still about the evening before.
      const today = reportDateFor();
      const reusable = store.pending && store.pending.date === today && store.pending.text === report;

      let pending = reusable && store.pending ? store.pending : null;
      if (!pending) {
        const id = await dailyLogRepository.create({ logDate: today, rawText: report });
        pending = { id, date: today, text: report, uploadedUris: [] };
        useCheckinDraftStore.getState().setPending(pending);
      }

      for (const file of attachments) {
        if (pending.uploadedUris.includes(file.uri)) continue;
        const bytes = await new File(file.uri).arrayBuffer();
        const extension = file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType.split('/')[1];
        await attachmentRepository.add(pending.id, {
          objectName: `${Crypto.randomUUID()}.${extension}`,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: bytes.byteLength,
          bytes,
        });
        pending = { ...pending, uploadedUris: [...pending.uploadedUris, file.uri] };
        useCheckinDraftStore.getState().setPending(pending);
      }

      try {
        return await processCheckin(pending.id);
      } catch (error) {
        // The request may have reached the server even though the phone
        // believes it failed: a dropped connection, a paused mutation, an app
        // that was closed mid-flight. Before reporting anything, look at what
        // the check-in actually did.
        const recovered = await recoverOutcome(pending.id);
        if (recovered) return recovered;
        throw error;
      }
    },
    onSuccess: async () => {
      useCheckinDraftStore.getState().reset();
      // A check-in touches nearly everything the app shows: tasks, the review
      // schedule, the mistake book and its own history. Refreshing only the
      // task board left the Defter tab showing yesterday's truth.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.all }),
        queryClient.invalidateQueries({ queryKey: topicKeys.all }),
        queryClient.invalidateQueries({ queryKey: topicMistakeKeys.all }),
        queryClient.invalidateQueries({ queryKey: checkinHistoryKeys.all }),
        queryClient.invalidateQueries({ queryKey: dailyLogKeys.all }),
        // A report can now also move an exam, note something against a task and
        // log the time it took, so those screens are stale too.
        queryClient.invalidateQueries({ queryKey: examKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskNoteKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskSessionKeys.all }),
      ]);
    },
    onError: (error) => {
      // Already processed elsewhere (e.g. a retry that raced): nothing left to resend.
      if (isAppError(error) && error.kind === 'conflict') useCheckinDraftStore.getState().setPending(null);
    },
  });
}

/**
 * How long a check-in the server is still working on is given to finish. The
 * server gives the model 75 s; a connection that dropped early in that wait
 * should still end in the answer, not in an error.
 */
const RECOVERY_WINDOW_MS = 90_000;
const RECOVERY_DELAY_MS = 3_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turns "we do not know what happened" into an answer.
 *
 * Returns the result when the check-in went through despite the error, and
 * null when there is genuinely nothing on the server — in which case the
 * original error is the honest thing to show.
 */
async function recoverOutcome(dailyLogId: string): Promise<DailyCheckinResponse | null> {
  const giveUpAt = Date.now() + RECOVERY_WINDOW_MS;

  for (;;) {
    const outcome = await dailyLogRepository.fetchOutcome(dailyLogId).catch(() => null);
    if (outcome === null) return null; // cannot even read it: report the original error

    const step = decideRecovery(outcome);
    if (step.action === 'use-result') return outcome.state === 'succeeded' ? outcome.result : null;
    if (step.action === 'report-error' || Date.now() + RECOVERY_DELAY_MS > giveUpAt) return null;
    await wait(RECOVERY_DELAY_MS);
  }
}
