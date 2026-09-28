import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import type { CheckinRecord, CheckinTaskChange } from '../domain/daily-log';
import { ATTACHMENT_BUCKET } from './attachment.repository';

const LOG_SELECT = 'id, log_date, raw_text, summary, created_at, reverted_at';

export class CheckinHistoryRepository extends BaseRepository {
  /** Processed check-ins, newest first, with a count of what each one changed. */
  async listRecent(limit = 30): Promise<CheckinRecord[]> {
    const logs = await this.execute(
      'daily_logs.history',
      this.db
        .from('daily_logs')
        .select(LOG_SELECT)
        .eq('status', 'succeeded')
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    if (logs.length === 0) return [];

    const ids = logs.map((log) => log.id);
    const [taskChanges, topicChanges, createdTasks, deletedTasks] = await Promise.all([
      this.execute(
        'daily_logs.taskChangeCounts',
        this.db.from('daily_log_task_updates').select('daily_log_id').in('daily_log_id', ids),
      ),
      this.execute(
        'daily_logs.topicChangeCounts',
        this.db.from('daily_log_topic_updates').select('daily_log_id').in('daily_log_id', ids),
      ),
      this.execute(
        'daily_logs.createdTaskCounts',
        this.db.from('tasks').select('origin_daily_log_id').in('origin_daily_log_id', ids),
      ),
      this.execute(
        'daily_logs.deletedTaskCounts',
        this.db.from('daily_log_task_deletions').select('daily_log_id').in('daily_log_id', ids),
      ),
    ]);

    const count = (rows: { daily_log_id: string }[]) => {
      const map = new Map<string, number>();
      for (const row of rows) map.set(row.daily_log_id, (map.get(row.daily_log_id) ?? 0) + 1);
      return map;
    };
    const taskCounts = count(taskChanges);
    const topicCounts = count(topicChanges);
    const deletedCounts = count(deletedTasks);
    const createdCounts = new Map<string, number>();
    for (const row of createdTasks) {
      if (!row.origin_daily_log_id) continue;
      createdCounts.set(row.origin_daily_log_id, (createdCounts.get(row.origin_daily_log_id) ?? 0) + 1);
    }

    return logs.map((log) => ({
      id: log.id,
      logDate: log.log_date,
      rawText: log.raw_text,
      summary: log.summary,
      createdAt: log.created_at,
      revertedAt: log.reverted_at,
      taskChanges: taskCounts.get(log.id) ?? 0,
      removedTasks: deletedCounts.get(log.id) ?? 0,
      topicChanges: topicCounts.get(log.id) ?? 0,
      createdTasks: createdCounts.get(log.id) ?? 0,
    }));
  }

  /**
   * Everything this check-in did to individual tasks — transitions first, then
   * the ones it deleted. A deleted task has no row to join to any more, so its
   * title comes out of the snapshot that was taken for the undo.
   */
  async listTaskChanges(dailyLogId: string): Promise<CheckinTaskChange[]> {
    const [rows, deletions] = await Promise.all([
      this.execute(
        'daily_logs.taskChanges',
        this.db
          .from('daily_log_task_updates')
          .select(
            'id, previous_status, new_status, note, problems_solved, task:tasks!daily_log_task_updates_task_fk(title)',
          )
          .eq('daily_log_id', dailyLogId)
          .order('created_at', { ascending: true }),
      ),
      this.execute(
        'daily_logs.taskDeletions',
        this.db
          .from('daily_log_task_deletions')
          .select('id, snapshot, reason')
          .eq('daily_log_id', dailyLogId)
          .order('created_at', { ascending: true }),
      ),
    ]);

    const transitions: CheckinTaskChange[] = rows.map((row) => ({
      id: row.id,
      taskTitle: row.task.title,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      note: row.note,
      problemsSolved: row.problems_solved,
    }));

    const removed: CheckinTaskChange[] = deletions.map((row) => {
      const snapshot = (row.snapshot ?? {}) as { title?: unknown; status?: unknown };
      return {
        id: row.id,
        taskTitle: typeof snapshot.title === 'string' ? snapshot.title : 'Silinen görev',
        previousStatus: typeof snapshot.status === 'string' ? snapshot.status : 'pending',
        newStatus: null,
        note: row.reason,
        problemsSolved: null,
      };
    });

    return [...transitions, ...removed];
  }

  /** Puts everything this check-in touched back the way it was. */
  async revert(dailyLogId: string): Promise<void> {
    const { error } = await this.db.rpc('revert_daily_checkin', { p_daily_log_id: dailyLogId });
    if (error) throw this.toRevertError(error);
  }

  /**
   * Removes the record itself.
   *
   * `revert` is the whole decision: with it the plan goes back to what it was
   * and then the record goes; without it the plan keeps everything the check-in
   * did and only the record disappears — which also throws away the snapshots
   * the undo would have needed, so it can never be taken back.
   */
  async delete(dailyLogId: string, revert: boolean): Promise<void> {
    const { data, error } = await this.db.rpc('delete_daily_checkin', {
      p_daily_log_id: dailyLogId,
      p_revert: revert,
    });
    if (error) {
      throw /already undone/i.test(error.message)
        ? new AppError('conflict', 'Bu değerlendirme zaten geri alınmış.', { cause: error })
        : new AppError('server', 'Değerlendirme silinemedi.', { cause: error });
    }

    // The rows are gone; their files are not. Losing a file here leaves a few
    // unreachable bytes in storage, which is not worth failing the delete over.
    const paths = storagePathsOf(data);
    if (paths.length > 0) {
      const { error: storageError } = await this.db.storage.from(ATTACHMENT_BUCKET).remove(paths);
      if (storageError) console.warn('[checkin] ek dosyalar silinemedi', storageError.message);
    }
  }

  private toRevertError(error: { message: string }) {
    return /already undone/i.test(error.message)
      ? new AppError('conflict', 'Bu değerlendirme zaten geri alınmış.', { cause: error })
      : new AppError('server', 'Geri alma başarısız oldu.', { cause: error });
  }
}

/** The RPC answers with json; only the file paths matter to the caller. */
function storagePathsOf(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const paths = (payload as { storage_paths?: unknown }).storage_paths;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];
}

export const checkinHistoryRepository = new CheckinHistoryRepository();
