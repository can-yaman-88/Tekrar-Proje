import type { DailyCheckinResponse } from '@contracts/daily-checkin.contract';
import { BaseRepository } from '@shared/api/repository';
import type { NewDailyLog } from '../domain/daily-log';

export type CheckinOutcome =
  | { state: 'succeeded'; result: DailyCheckinResponse }
  | { state: 'processing' }
  | { state: 'failed'; message: string | null }
  | { state: 'missing' };

export class DailyLogRepository extends BaseRepository {
  /** The most recent day the student reported on, or null if they never have. */
  async lastCheckinDate(): Promise<string | null> {
    const row = await this.execute(
      'daily_logs.lastCheckinDate',
      this.db
        .from('daily_logs')
        .select('log_date')
        .eq('status', 'succeeded')
        .order('log_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return row?.log_date ?? null;
  }

  /**
   * What became of a check-in that the app lost track of.
   *
   * A submission can reach the server and still look like a failure to the
   * phone — a dropped connection, a paused mutation, an app that was closed.
   * Rather than making the student write the day again (and the second write
   * being refused as a duplicate), the result is read back from what the
   * check-in actually wrote.
   */
  async fetchOutcome(dailyLogId: string): Promise<CheckinOutcome> {
    const log = await this.execute(
      'daily_logs.outcome',
      this.db
        .from('daily_logs')
        .select('id, status, summary, error_message, log_date')
        .eq('id', dailyLogId)
        .maybeSingle(),
    );
    if (!log) return { state: 'missing' };
    if (log.status === 'pending' || log.status === 'processing') return { state: 'processing' };
    if (log.status === 'failed') return { state: 'failed', message: log.error_message };

    const [updates, created, removed, mistakes, reviews] = await Promise.all([
      this.execute(
        'daily_logs.outcomeUpdates',
        this.db
          .from('daily_log_task_updates')
          .select('task_id, previous_due_date')
          .eq('daily_log_id', dailyLogId),
      ),
      this.execute(
        'daily_logs.outcomeCreated',
        this.db.from('tasks').select('id').eq('origin_daily_log_id', dailyLogId),
      ),
      this.execute(
        'daily_logs.outcomeRemoved',
        this.db.from('daily_log_task_deletions').select('task_id').eq('daily_log_id', dailyLogId),
      ),
      this.execute(
        'daily_logs.outcomeMistakes',
        this.db.from('topic_mistakes').select('id').eq('source_daily_log_id', dailyLogId),
      ),
      this.execute(
        'daily_logs.outcomeReviews',
        this.db
          .from('topic_review_events')
          .select('topic_id, next_review_on, interval_after, was_early, topic:topics!topic_review_events_topic_fk(title)')
          .eq('daily_log_id', dailyLogId),
      ),
    ]);

    return {
      state: 'succeeded',
      result: {
        dailyLogId,
        summary: log.summary ?? 'Değerlendirmen işlendi.',
        coveredDates: [log.log_date],
        attachmentNotes: [],
        updatedTaskIds: updates.map((row) => row.task_id),
        // A row carrying the day it came from is a move, not a status change.
        movedTaskIds: updates.filter((row) => row.previous_due_date !== null).map((row) => row.task_id),
        createdTaskIds: created.map((row) => row.id),
        removedTaskIds: removed.map((row) => row.task_id),
        mistakesRecorded: mistakes.length,
        reviewedTopicIds: reviews.map((row) => row.topic_id),
        scheduledReviews: reviews.flatMap((row) =>
          row.next_review_on === null
            ? []
            : [
                {
                  topicId: row.topic_id,
                  topicTitle: row.topic.title,
                  nextReviewOn: row.next_review_on,
                  intervalDays: row.interval_after,
                  early: row.was_early,
                },
              ],
        ),
        unmatchedMentions: [],
      },
    };
  }

  /** Creates a `pending` log (RLS only allows that state); returns its id. */
  async create(input: NewDailyLog): Promise<string> {
    const userId = await this.requireUserId();
    const row = await this.execute(
      'daily_logs.create',
      this.db
        .from('daily_logs')
        .insert({ user_id: userId, log_date: input.logDate, raw_text: input.rawText })
        .select('id')
        .single(),
    );
    return row.id;
  }
}

export const dailyLogRepository = new DailyLogRepository();
