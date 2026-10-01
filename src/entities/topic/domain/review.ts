// The review history of a topic, and how to read it.
import type { IsoDate } from '@contracts/enums.contract';
import { diffInDays } from '@shared/lib/date';

export type ReviewSource = 'task' | 'manual' | 'checkin' | 'exam';

/** One counted review: when, how well, and what it did to the schedule. */
export interface ReviewEvent {
  id: string;
  topicId: string;
  reviewedOn: IsoDate;
  source: ReviewSource;
  /** SM-2 quality, 0–5. */
  quality: number;
  /** The student's own 1–5, when they gave one. */
  confidence: number | null;
  correctCount: number | null;
  attemptedCount: number | null;
  /** Came before the due day: logged, but the interval did not grow. */
  wasEarly: boolean;
  intervalBefore: number;
  intervalAfter: number;
  repetitionsAfter: number;
  nextReviewOn: IsoDate | null;
  /** The task it was counted from, when there was one. */
  taskTitle: string | null;
  createdAt: string;
}

/** The fields of a review the lists need: enough for "son: 3 gün önce · güven 4/5". */
export type ReviewDigest = Pick<
  ReviewEvent,
  'topicId' | 'reviewedOn' | 'quality' | 'confidence' | 'correctCount' | 'attemptedCount' | 'createdAt'
>;

export const REVIEW_SOURCE_LABEL: Record<ReviewSource, string> = {
  task: 'Görev',
  manual: 'Elle kayıt',
  checkin: 'Değerlendirme',
  exam: 'Sınav sonucu',
};

export type ReviewTone = 'danger' | 'warning' | 'success' | 'primary';

/** How a quality score reads to a student. */
export function qualityLabel(quality: number): { label: string; tone: ReviewTone } {
  if (quality <= 2) return { label: 'Hatırlayamadın', tone: 'danger' };
  if (quality === 3) return { label: 'Zorlandın', tone: 'warning' };
  if (quality === 4) return { label: 'İyi', tone: 'success' };
  return { label: 'Çok iyi', tone: 'primary' };
}

/** The labels the 1–5 rating is offered with. */
export const CONFIDENCE_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Hiç hatırlamadım',
  2: 'Zorlandım',
  3: 'Kısmen',
  4: 'İyi hatırladım',
  5: 'Çok rahat',
};

/** Latest review per topic, from a list ordered newest first. */
export function latestReviewByTopic<T extends Pick<ReviewEvent, 'topicId' | 'reviewedOn' | 'createdAt'>>(
  events: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const event of events) {
    const current = latest.get(event.topicId);
    if (
      !current ||
      event.reviewedOn > current.reviewedOn ||
      (event.reviewedOn === current.reviewedOn && event.createdAt > current.createdAt)
    ) {
      latest.set(event.topicId, event);
    }
  }
  return latest;
}

export type MemoryState = 'new' | 'fresh' | 'fading' | 'due' | 'overdue';

export interface Memory {
  state: MemoryState;
  /** Share of the interval already gone, 0…1 (capped). */
  elapsed: number;
  label: string;
}

/**
 * Where a topic sits between two reviews.
 *
 * Plain arithmetic on the schedule, nothing more: past half the gap the
 * memory is "fading", on the day it is due, after it is late.
 */
export function memoryOf(
  topic: { nextReviewOn: IsoDate | null; intervalDays: number },
  today: IsoDate,
): Memory {
  if (topic.nextReviewOn === null) return { state: 'new', elapsed: 0, label: 'Takvime girmedi' };
  const left = diffInDays(today, topic.nextReviewOn);
  if (left < 0) return { state: 'overdue', elapsed: 1, label: `${-left} gün gecikti` };
  if (left === 0) return { state: 'due', elapsed: 1, label: 'Tekrar zamanı' };
  const interval = Math.max(1, topic.intervalDays);
  const elapsed = Math.min(1, Math.max(0, (interval - left) / interval));
  return elapsed >= 0.5
    ? { state: 'fading', elapsed, label: 'Zayıflıyor' }
    : { state: 'fresh', elapsed, label: 'Taze' };
}

/** "8/10 doğru" when an accuracy was measured. */
export const accuracyLabel = (review: Pick<ReviewEvent, 'correctCount' | 'attemptedCount'>): string | null =>
  review.correctCount !== null && review.attemptedCount !== null && review.attemptedCount > 0
    ? `${review.correctCount}/${review.attemptedCount} doğru`
    : null;
