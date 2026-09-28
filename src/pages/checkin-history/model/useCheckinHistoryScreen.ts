import {
  isRevertable,
  useCheckinChanges,
  useCheckinHistory,
  useDeleteCheckin,
  useRevertCheckin,
  type CheckinRecord,
} from '@entities/daily-log';
import { TASK_STATUS_LABEL, type TaskStatus } from '@entities/task';
import { formatLongDate } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useCallback, useMemo, useState } from 'react';

export interface CheckinCardModel {
  id: string;
  dateLabel: string;
  summary: string;
  rawText: string;
  changesLabel: string;
  canRevert: boolean;
  isReverted: boolean;
}

const changesLabel = (record: CheckinRecord): string => {
  const parts: string[] = [];
  if (record.taskChanges > 0) parts.push(`${record.taskChanges} görev`);
  if (record.topicChanges > 0) parts.push(`${record.topicChanges} konu tekrarı`);
  if (record.createdTasks > 0) parts.push(`${record.createdTasks} yeni görev`);
  if (record.removedTasks > 0) parts.push(`${record.removedTasks} kaldırılan görev`);
  return parts.length === 0 ? 'Plana dokunmadı' : parts.join(' · ');
};

/** What each past report did, and the way back if it got something wrong. */
export function useCheckinHistoryScreen() {
  const history = useCheckinHistory();
  const revert = useRevertCheckin();
  const remove = useDeleteCheckin();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const changes = useCheckinChanges(expandedId);
  const [isRefreshing, setRefreshing] = useState(false);

  const records = useMemo(() => history.data ?? [], [history.data]);

  const cards = useMemo<CheckinCardModel[]>(
    () =>
      records.map((record) => ({
        id: record.id,
        dateLabel: formatLongDate(record.logDate),
        summary: record.summary ?? '—',
        rawText: record.rawText,
        changesLabel: changesLabel(record),
        canRevert: isRevertable(record),
        isReverted: record.revertedAt !== null,
      })),
    [records],
  );

  const { refetch } = history;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return {
    isLoading: history.isPending && history.data === undefined,
    error: history.data === undefined && history.isError ? describeError(history.error) : null,
    cards,
    expandedId,
    onToggleExpand: (id: string) => setExpandedId((current) => (current === id ? null : id)),
    changes: (changes.data ?? []).map((change) => ({
      id: change.id,
      title: change.taskTitle,
      transition:
        change.newStatus === null
          ? `${TASK_STATUS_LABEL[change.previousStatus as TaskStatus] ?? change.previousStatus} → kaldırıldı`
          : `${TASK_STATUS_LABEL[change.previousStatus as TaskStatus] ?? change.previousStatus} → ${
              TASK_STATUS_LABEL[change.newStatus as TaskStatus] ?? change.newStatus
            }`,
      detail: [change.problemsSolved === null ? null : `${change.problemsSolved} problem`, change.note]
        .filter(Boolean)
        .join(' · '),
    })),
    changesLoading: changes.isPending && expandedId !== null,
    onRevert: (id: string) =>
      revert.mutate(id, {
        onSuccess: () => showToast('Değerlendirme geri alındı; plan eski haline döndü.', 'success'),
        onError: (error) => showToast(describeError(error).message, 'danger'),
      }),
    isReverting: revert.isPending,
    /**
     * Deleting the record is not the same as undoing it, so the caller says
     * which it meant: `revert` puts the plan back first, without it the plan
     * keeps what the check-in did and only the record goes.
     */
    onDelete: (id: string, revertFirst: boolean) =>
      remove.mutate(
        { dailyLogId: id, revert: revertFirst },
        {
          onSuccess: () =>
            showToast(
              revertFirst ? 'Değerlendirme geri alındı ve silindi.' : 'Değerlendirme kaydı silindi.',
              'success',
            ),
          onError: (error) => showToast(describeError(error).message, 'danger'),
        },
      ),
    isDeleting: remove.isPending,
    isRefreshing,
    refresh,
  };
}
