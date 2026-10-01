// After the exam: turning "it went badly" into a real review schedule.
//
// The student answers one question and optionally ticks the topics that hurt.
// That is enough to run SM-2 over everything the exam covered — an exam is the
// most honest recall test the app ever gets, so it is treated as one.
import type { IsoDate } from '@contracts/enums.contract';
import { reviewSm2, type RecallQuality } from '@domain/spaced-repetition';
import { addDays } from '@shared/lib/date';

export type ExamOutcome = 1 | 2 | 3 | 4 | 5;

export const EXAM_OUTCOME_LABEL: Record<ExamOutcome, string> = {
  1: 'Kötü geçti',
  2: 'Beklediğimden kötü',
  3: 'İdare eder',
  4: 'İyi geçti',
  5: 'Çok iyi geçti',
};

/** How the exam as a whole maps to recall quality. */
const OUTCOME_QUALITY: Record<ExamOutcome, RecallQuality> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
/** A topic the student flagged failed, however well the exam went overall. */
const FLAGGED_QUALITY: RecallQuality = 2;

export interface RetroTopic {
  id: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface TopicReview {
  topic_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_on: IsoDate;
  /** Written into the topic's review history next to the schedule change. */
  quality: RecallQuality;
}

export function buildExamReviews(
  topics: readonly RetroTopic[],
  outcome: ExamOutcome,
  flaggedTopicIds: readonly string[],
  today: IsoDate,
): TopicReview[] {
  const flagged = new Set(flaggedTopicIds);
  return topics.map((topic) => {
    const quality = flagged.has(topic.id)
      ? FLAGGED_QUALITY
      : (Math.min(OUTCOME_QUALITY[outcome], 5) as RecallQuality);
    const next = reviewSm2(
      { easeFactor: topic.easeFactor, intervalDays: topic.intervalDays, repetitions: topic.repetitions },
      quality,
    );
    return {
      topic_id: topic.id,
      ease_factor: next.easeFactor,
      interval_days: next.intervalDays,
      repetitions: next.repetitions,
      next_review_on: addDays(today, next.intervalDays),
      quality,
    };
  });
}
