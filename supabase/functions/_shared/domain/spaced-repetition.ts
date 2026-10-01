// SM-2 (Wozniak, 1990). Pure and deterministic — unit-testable without I/O.
import type { IsoDate } from '../contracts/enums.contract.ts';
import { addDays } from './dates.ts';

export interface SrsState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

/** 0–2 = failed recall, 3 = correct with serious difficulty, 4 = hesitation, 5 = perfect. */
export type RecallQuality = 0 | 1 | 2 | 3 | 4 | 5;

const MIN_EASE = 1.3;

export function reviewSm2(state: SrsState, quality: RecallQuality): SrsState {
  const easeFactor = Math.max(
    MIN_EASE,
    Math.round((state.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))) * 100) / 100,
  );

  // Interval uses the pre-review EF, as in the original algorithm.
  if (quality < 3) return { easeFactor, intervalDays: 1, repetitions: 0 };

  const repetitions = state.repetitions + 1;
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round(state.intervalDays * state.easeFactor));
  return { easeFactor, intervalDays, repetitions };
}

/**
 * Maps measured accuracy to SM-2 quality.
 *
 * This is the one objective signal the app ever gets: ten questions, six
 * correct. Where it exists it outranks the student's own sense of how it went,
 * which tends to be generous right after finishing something.
 */
export function qualityForAccuracy(ratio: number): RecallQuality {
  if (ratio >= 0.9) return 5;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.4) return 2;
  return 1;
}

/** Below this the topic is treated as failed, whatever the student felt. */
export const WEAK_ACCURACY = 0.6;

/** Maps a self-reported 1–5 confidence on a finished task to SM-2 quality (always a pass). */
export function qualityForCompletion(confidence: number | null): RecallQuality {
  if (confidence === null) return 4;
  if (confidence <= 2) return 3;
  return confidence === 3 ? 4 : 5;
}

/** Maps confidence on a failed attempt / struggle to SM-2 quality (always a fail). */
export function qualityForFailure(confidence: number | null): RecallQuality {
  if (confidence === null || confidence <= 1) return 0;
  return confidence === 2 ? 1 : 2;
}

// ---------------------------------------------------------------------------
// When a review counts.
//
// The same rules run in SQL (public.apply_topic_review) for work ticked off in
// the app, and here for check-ins — a tap in the afternoon and a report in the
// evening describe the same study session, and must not count it twice.
// ---------------------------------------------------------------------------

export interface ReviewTiming {
  /** The student's local day the review happened on. */
  reviewedOn: IsoDate;
  /** When the topic was due; null = never scheduled, which counts as due. */
  dueOn: IsoDate | null;
  /** The last day a review of this topic was counted; null = never. */
  lastReviewedOn: IsoDate | null;
}

export type ReviewDecision =
  | { counted: false }
  | { counted: true; state: SrsState; nextReviewOn: IsoDate; early: boolean };

/**
 * · once a day: a second pass on a day already counted changes nothing — but
 *   a failure always counts, because it is news
 * · a review older than the last counted one is history, not news
 * · a pass before the due day is practice: the clock restarts from that day,
 *   the interval does not grow (otherwise three days of homework in a row
 *   would stretch the interval to weeks without a single real gap)
 * · otherwise: one SM-2 step, counted from the day it happened
 */
export function scheduleReview(state: SrsState, quality: RecallQuality, timing: ReviewTiming): ReviewDecision {
  const { reviewedOn, dueOn, lastReviewedOn } = timing;
  const failed = quality < 3;
  if (lastReviewedOn !== null && (lastReviewedOn > reviewedOn || (lastReviewedOn === reviewedOn && !failed))) {
    return { counted: false };
  }

  if (!failed && dueOn !== null && reviewedOn < dueOn) {
    const restarted = addDays(reviewedOn, Math.max(1, state.intervalDays));
    return { counted: true, state: { ...state }, nextReviewOn: restarted > dueOn ? restarted : dueOn, early: true };
  }

  const next = reviewSm2(state, quality);
  return { counted: true, state: next, nextReviewOn: addDays(reviewedOn, next.intervalDays), early: false };
}
