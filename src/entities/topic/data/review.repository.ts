import type { IsoDate } from '@contracts/enums.contract';
import { BaseRepository } from '@shared/api/repository';
import type { ReviewDigest, ReviewEvent, ReviewSource } from '../domain/review';

const EVENT_SELECT =
  'id, topic_id, reviewed_on, source, quality, confidence, correct_count, attempted_count, was_early, interval_before, interval_after, repetitions_after, next_review_on, created_at, task:tasks!topic_review_events_task_fk(title)';

const SOURCES: readonly ReviewSource[] = ['task', 'manual', 'checkin', 'exam'];
const toSource = (value: string): ReviewSource =>
  (SOURCES as readonly string[]).includes(value) ? (value as ReviewSource) : 'task';

export interface LoggedReview {
  counted: boolean;
  nextReviewOn: IsoDate | null;
  intervalDays: number | null;
  early: boolean;
  tasksClosed: number;
}

export interface EnsuredReviews {
  topics: number;
  tasks: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The review history, read-only to the app; the database writes it as reviews are counted. */
export class ReviewRepository extends BaseRepository {
  async listForTopic(topicId: string, limit = 40): Promise<ReviewEvent[]> {
    const rows = await this.execute(
      'topic_review_events.listForTopic',
      this.db
        .from('topic_review_events')
        .select(EVENT_SELECT)
        .eq('topic_id', topicId)
        .order('reviewed_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map((row) => ({
      id: row.id,
      topicId: row.topic_id,
      reviewedOn: row.reviewed_on,
      source: toSource(row.source),
      quality: row.quality,
      confidence: row.confidence,
      correctCount: row.correct_count,
      attemptedCount: row.attempted_count,
      wasEarly: row.was_early,
      intervalBefore: row.interval_before,
      intervalAfter: row.interval_after,
      repetitionsAfter: row.repetitions_after,
      nextReviewOn: row.next_review_on,
      taskTitle: row.task?.title ?? null,
      createdAt: row.created_at,
    }));
  }

  /** Recent reviews across every topic, newest first: "last studied, last confidence" in lists. */
  async listSince(since: IsoDate): Promise<ReviewDigest[]> {
    const rows = await this.execute(
      'topic_review_events.listSince',
      this.db
        .from('topic_review_events')
        .select('topic_id, reviewed_on, quality, confidence, correct_count, attempted_count, created_at')
        .gte('reviewed_on', since)
        .order('reviewed_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000),
    );
    return rows.map((row) => ({
      topicId: row.topic_id,
      reviewedOn: row.reviewed_on,
      quality: row.quality,
      confidence: row.confidence,
      correctCount: row.correct_count,
      attemptedCount: row.attempted_count,
      createdAt: row.created_at,
    }));
  }

  /**
   * "Bugün tekrar ettim", rated 1–5. The database applies the same rules as a
   * check-in would, and closes the topic's open review tasks with it.
   */
  async logReview(topicId: string, confidence: number, on: IsoDate): Promise<LoggedReview> {
    const result = asRecord(
      await this.execute(
        'topic_review_events.logReview',
        this.db.rpc('log_topic_review', { p_topic_id: topicId, p_confidence: confidence, p_on: on }),
      ),
    );
    const review = asRecord(result.review);
    return {
      counted: review.counted === true,
      nextReviewOn: typeof review.next_review_on === 'string' ? review.next_review_on : null,
      intervalDays: typeof review.interval_days === 'number' ? review.interval_days : null,
      early: review.early === true,
      tasksClosed: typeof result.tasks_closed === 'number' ? result.tasks_closed : 0,
    };
  }

  /** Turns today's due reviews into work on the board — at most once per scheduled date. */
  async ensureReviewTasks(today: IsoDate, maxTopics: number, budgetMinutes: number | null): Promise<EnsuredReviews> {
    const result = asRecord(
      await this.execute(
        'topic_review_events.ensureReviewTasks',
        this.db.rpc('ensure_review_tasks', {
          p_today: today,
          p_max_topics: maxTopics,
          ...(budgetMinutes === null ? {} : { p_budget_minutes: budgetMinutes }),
        }),
      ),
    );
    return {
      topics: typeof result.topics === 'number' ? result.topics : 0,
      tasks: typeof result.tasks === 'number' ? result.tasks : 0,
    };
  }
}

export const reviewRepository = new ReviewRepository();
