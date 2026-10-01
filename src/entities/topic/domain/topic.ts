import type { IsoDate } from '@contracts/enums.contract';

export interface Topic {
  id: string;
  courseId: string;
  title: string;
  weekNumber: number | null;
  easeFactor: number;
  repetitions: number;
  /** Days between the last counted review and the next one. */
  intervalDays: number;
  nextReviewOn: IsoDate | null;
  lastReviewedAt: string | null;
  /** Only the student sets this; the planner refuses advanced work without it. */
  hasAdvancedMaterial: boolean;
  /** Rollups over this topic's tasks. */
  openTasks: number;
  failedTasks: number;
  solvedProblems: number;
}

export type MasteryLevel = 'new' | 'weak' | 'learning' | 'solid';

const WEAK_EASE = 2.2;

export function masteryOf(topic: Topic): MasteryLevel {
  if (topic.failedTasks > 0 || topic.easeFactor < WEAK_EASE) return 'weak';
  if (topic.repetitions === 0 && topic.lastReviewedAt === null) return 'new';
  return topic.repetitions >= 3 && topic.easeFactor >= 2.4 ? 'solid' : 'learning';
}

export const MASTERY_LABEL: Record<MasteryLevel, string> = {
  new: 'Yeni',
  weak: 'Zayıf',
  learning: 'Öğreniliyor',
  solid: 'Sağlam',
};

export const isWeak = (topic: Topic): boolean => masteryOf(topic) === 'weak';

/** Review due on or before `today`. */
export const isReviewDue = (topic: Topic, today: IsoDate): boolean =>
  topic.nextReviewOn !== null && topic.nextReviewOn <= today;
