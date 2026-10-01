// Deterministic weekly planning around the student's own study loop.
//
// The loop (see study-cycle.ts) decides WHAT a topic needs next; scoring decides
// WHICH topics are urgent; the class timetable decides WHEN — work lands on the
// days that course is actually taught. No LLM is involved here; the model only
// rewords the finished plan.
//
// Two things are deliberately out of scope, because the student handles them
// alone: laboratory hours and school quizzes. Neither produces work, and
// neither steers the schedule.
import type { ExamKind, IsoDate, StudyStep, TaskType } from '../_shared/contracts/enums.contract.ts';
import { type CapacitySource, DEFAULT_DAILY_CAPACITY, planningBudget } from '../_shared/domain/capacity.ts';
import { addDays, diffInDays } from '../_shared/domain/dates.ts';
import { planDeadlineWork } from '../_shared/domain/workload.ts';
import {
  effortOf,
  FIRST_CYCLE,
  NEXT_DAY_STEPS,
  REVIEW_CYCLE,
  SAME_DAY_PAIR,
  stepCopy,
  taskTypeOf,
} from './study-cycle.ts';

export interface PlanTopic {
  id: string;
  title: string;
  courseId: string;
  courseLabel: string;
  weekNumber: number | null;
  easeFactor: number;
  repetitions: number;
  nextReviewOn: IsoDate | null;
  lastReviewedAt: string | null;
  /** Study steps already finished for this topic. */
  completedSteps: readonly StudyStep[];
  /** Study steps that already have an open task — never scheduled twice. */
  openSteps: readonly StudyStep[];
  /** Tasks failed in the recent past — a strong signal to revisit. */
  recentFailures: number;
  /** The student stated they have harder problems for this topic. */
  hasAdvancedMaterial: boolean;
  /** An open task created from a teacher's file covers this topic's practice. */
  hasTeacherMaterial: boolean;
}

export interface PlanExam {
  id: string;
  courseId: string;
  kind: ExamKind;
  title: string;
  examDate: IsoDate;
  topicIds: string[];
}

/** Minutes of class per ISO weekday (labs included: they still fill the day). */
export type ClassLoad = Readonly<Record<number, number>>;

/** Teaching days per course, ISO weekday, labs excluded. */
export type CourseClassDays = Readonly<Record<string, readonly number[]>>;

export interface PlanSlot {
  topicId: string;
  courseId: string;
  courseLabel: string;
  topicTitle: string;
  type: TaskType;
  step: StudyStep;
  targetCount: number | null;
  estimatedMinutes: number;
  dueDate: IsoDate;
  /** Why it was scheduled — drives the prompt and the fallback wording. */
  reason: 'cycle' | 'review' | 'exam' | 'weak' | 'new';
  title: string;
  instructions: string;
}

/** Homework already on the board, with a deadline of its own. */
export interface PlanCommitment {
  id: string;
  dueDate: IsoDate;
  startsOn: IsoDate | null;
  remainingMinutes: number;
}

export interface PlanInput {
  weekStart: IsoDate;
  topics: readonly PlanTopic[];
  exams: readonly PlanExam[];
  /** Work with its own deadline; it takes its share of the week first. */
  commitments?: readonly PlanCommitment[];
  classLoad?: ClassLoad;
  courseClassDays?: CourseClassDays;
  /** Minutes of study per ISO weekday, learned from what the student finishes. */
  capacityByWeekday?: Readonly<Record<number, number>>;
  /**
   * Where each weekday's number came from. A learned or hand-set budget is the
   * student's real day, classes included, so class hours are not taken off it
   * a second time. Weekdays without a source are treated as a guess.
   */
  capacitySources?: Readonly<Record<number, CapacitySource>>;
  /** Days the student never studies on: no work lands there, whatever else says so. */
  blockedWeekdays?: readonly number[];
  /** Flat fallback for weekdays with no history. */
  dailyCapacityMinutes?: number;
}

export interface PlanResult {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  slots: PlanSlot[];
  notes: string[];
}

const DAYS = 7;
const MAX_TOPICS_PER_WEEK = 10;
/** Concept page, quiz, Feynman page, and the optional harder set. */
const MAX_STEPS_PER_TOPIC = 4;

/** Labs and quizzes are the student's own business; the planner ignores them. */
const PLANNED_EXAM_KINDS: ReadonlySet<ExamKind> = new Set<ExamKind>(['midterm', 'final', 'other']);

interface TopicPlan {
  topic: PlanTopic;
  score: number;
  steps: StudyStep[];
  isReview: boolean;
  reason: PlanSlot['reason'];
}

function examPressure(daysAway: number): number {
  if (daysAway < 0) return 0;
  if (daysAway <= 3) return 40;
  if (daysAway <= 7) return 30;
  if (daysAway <= 14) return 20;
  if (daysAway <= 21) return 10;
  return 0;
}

const isoWeekday = (date: IsoDate): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
};

/** The first cycle counts as finished once the quiz and the Feynman page are done. */
const finishedFirstCycle = (topic: PlanTopic): boolean =>
  topic.completedSteps.includes('feynman') && topic.completedSteps.includes('quiz');

/**
 * What this topic needs next, in order. Never skips ahead: the quiz waits for
 * the concept page, the Feynman page waits for the quiz. The harder set is a
 * fourth task in the same batch, and only when the student said they have one.
 */
function stepsFor(topic: PlanTopic, reviewDue: boolean): { steps: StudyStep[]; isReview: boolean } {
  if (reviewDue && finishedFirstCycle(topic)) {
    return { steps: REVIEW_CYCLE.filter((step) => !topic.openSteps.includes(step)), isReview: true };
  }

  const steps: StudyStep[] = [];
  for (const step of FIRST_CYCLE) {
    if (step === 'advanced_problems' && !topic.hasAdvancedMaterial) continue;
    if (topic.completedSteps.includes(step)) continue;
    if (topic.openSteps.includes(step)) break; // work already waiting: don't pile on
    steps.push(step);
  }
  return { steps, isReview: false };
}

function planTopic(
  topic: PlanTopic,
  exams: readonly PlanExam[],
  weekStart: IsoDate,
  weekEnd: IsoDate,
): TopicPlan | null {
  let bestPressure = 0;
  for (const exam of exams) {
    if (exam.courseId !== topic.courseId) continue;
    const linked = exam.topicIds.includes(topic.id);
    const pressure = examPressure(diffInDays(weekStart, exam.examDate)) * (linked ? 1 : 0.5);
    if (pressure > bestPressure) bestPressure = pressure;
  }

  const reviewDue = topic.nextReviewOn !== null && topic.nextReviewOn <= weekEnd;
  const overdueReview = topic.nextReviewOn !== null && topic.nextReviewOn < weekStart;
  const { steps, isReview } = stepsFor(topic, reviewDue);
  if (steps.length === 0) return null;

  const neverStudied = topic.completedSteps.length === 0;
  const score =
    bestPressure +
    (reviewDue ? 25 : 0) +
    (overdueReview ? 10 : 0) +
    (topic.easeFactor < 2.2 ? 15 : 0) +
    Math.min(20, topic.recentFailures * 10) +
    (neverStudied ? 12 : 0) +
    // A half-finished loop is worth more than an untouched one: finish what you started.
    (!neverStudied && !isReview ? 18 : 0);

  if (score <= 0) return null;

  const reason: PlanSlot['reason'] = isReview
    ? 'review'
    : topic.recentFailures > 0 || topic.easeFactor < 2.2
      ? 'weak'
      : bestPressure >= 30
        ? 'exam'
        : neverStudied
          ? 'new'
          : 'cycle';

  return { topic, score, steps: steps.slice(0, MAX_STEPS_PER_TOPIC), isReview, reason };
}

export function planWeek({
  weekStart,
  topics,
  exams,
  commitments,
  classLoad,
  courseClassDays,
  capacityByWeekday,
  capacitySources,
  blockedWeekdays = [],
  dailyCapacityMinutes,
}: PlanInput): PlanResult {
  const fallbackCapacity = dailyCapacityMinutes ?? DEFAULT_DAILY_CAPACITY;
  const weekEnd = addDays(weekStart, DAYS - 1);
  const notes: string[] = [];

  // Quizzes and labs never enter planning.
  const plannedExams = exams.filter((exam) => PLANNED_EXAM_KINDS.has(exam.kind));

  const planned = topics
    .map((topic) => planTopic(topic, plannedExams, weekStart, weekEnd))
    .filter((plan): plan is TopicPlan => plan !== null)
    .sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title))
    .slice(0, MAX_TOPICS_PER_WEEK);

  if (planned.length === 0) {
    notes.push('Planlanacak uygun konu bulunamadı; açık görevlerin zaten var.');
    return { weekStart, weekEnd, slots: [], notes };
  }

  // Exam days are for sitting the exam, not for new work — and a day the
  // student has closed is worth nothing. It used to be floored back up to half
  // an hour, so "pazarları çalışamam" still got Sunday work from the planner.
  const examDays = new Set(plannedExams.map((exam) => exam.examDate));
  const closed = new Set(blockedWeekdays);
  const isClosed = (day: IsoDate) =>
    closed.has(isoWeekday(day)) || (capacityByWeekday !== undefined && capacityByWeekday[isoWeekday(day)] === 0);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i)).filter(
    (day) => !examDays.has(day) && !isClosed(day),
  );
  if (days.length === 0) {
    notes.push('Bu haftanın bütün günleri sınav günü ya da kapalı; plan oluşturulmadı.');
    return { weekStart, weekEnd, slots: [], notes };
  }

  // Class hours (labs included) eat into a budget that is only a guess; a
  // learned or hand-set day already is the student's real day.
  const remaining = new Map(
    days.map((day) => {
      const weekday = isoWeekday(day);
      const minutes = capacityByWeekday?.[weekday] ?? fallbackCapacity;
      const source = capacitySources?.[weekday] ?? 'default';
      return [day, planningBudget({ minutes, source }, classLoad?.[weekday] ?? 0)];
    }),
  );

  // Homework answers to a date the student did not choose, so it is booked
  // before the loop: the study plan fills what is left, not the other way
  // round. Same arithmetic the app shows on the task card.
  let reservedForHomework = 0;
  if (commitments && commitments.length > 0) {
    const reserved = planDeadlineWork({
      today: weekStart,
      days: days.map((date) => ({
        date,
        capacityMinutes: remaining.get(date) ?? 0,
        committedMinutes: 0,
      })),
      tasks: commitments.map((commitment) => ({
        id: commitment.id,
        dueDate: commitment.dueDate,
        startsOn: commitment.startsOn,
        remainingMinutes: commitment.remainingMinutes,
        remainingCount: null,
        minutesPerUnit: null,
      })),
    });
    for (const share of reserved.shares) {
      remaining.set(share.date, Math.max(0, (remaining.get(share.date) ?? 0) - share.minutes));
      reservedForHomework += share.minutes;
    }
  }

  const slots: PlanSlot[] = [];
  let skippedForCapacity = 0;
  let usedFallbackDay = false;

  let splitPairs = 0;

  for (const plan of planned) {
    // Work lands on the days that course is taught: a Wednesday–Friday course
    // gets its steps on Wednesday and Friday, in that order.
    const teachingDays = courseClassDays?.[plan.topic.courseId] ?? [];
    const preferred = days.filter((day) => teachingDays.includes(isoWeekday(day)));
    const ordered = preferred.length > 0 ? preferred : days;

    // The concept page and the Feynman page are one sitting, so they are placed
    // as one batch; the quiz is deliberately not part of it — it waits for a
    // later day, which is what makes it a recall test rather than a re-read.
    const batches: StudyStep[][] = [];
    const sameDay = plan.steps.filter((step) => SAME_DAY_PAIR.includes(step));
    if (sameDay.length > 0) batches.push(sameDay);
    for (const step of plan.steps) {
      if (!SAME_DAY_PAIR.includes(step)) batches.push([step]);
    }

    // A review is a recall test after a gap: doing it before the day it is due
    // only shortens the gap. It waits for that day (an overdue one goes first).
    const notBefore =
      plan.isReview && plan.topic.nextReviewOn !== null && plan.topic.nextReviewOn > weekStart
        ? days.findIndex((day) => day >= (plan.topic.nextReviewOn as IsoDate))
        : 0;
    if (notBefore < 0) continue; // its day is closed or an exam day; the daily review job picks it up

    let lastIndex = -1; // steps never run backwards in time
    let cursor = 0; // round-robin across the course's own days

    const place = (steps: readonly StudyStep[], minIndex: number): number | null => {
      const minutes = steps.reduce((total, step) => total + effortOf(step, plan.isReview).minutes, 0);

      let day: IsoDate | null = null;
      for (let offset = 0; offset < ordered.length; offset++) {
        const candidate = ordered[(cursor + offset) % ordered.length] as IsoDate;
        if (days.indexOf(candidate) < minIndex) continue;
        if ((remaining.get(candidate) ?? 0) < minutes) continue;
        day = candidate;
        cursor = (cursor + offset + 1) % ordered.length;
        break;
      }

      // The course's own days are full: any remaining day beats postponing.
      if (day === null && preferred.length > 0) {
        day = days.find((d, i) => i >= minIndex && (remaining.get(d) ?? 0) >= minutes) ?? null;
        if (day !== null) usedFallbackDay = true;
      }
      if (day === null) return null;

      remaining.set(day, (remaining.get(day) ?? 0) - minutes);
      for (const step of steps) {
        const effort = effortOf(step, plan.isReview);
        const useTeacherMaterial = step === 'quiz' && plan.topic.hasTeacherMaterial && !plan.isReview;
        slots.push({
          topicId: plan.topic.id,
          courseId: plan.topic.courseId,
          courseLabel: plan.topic.courseLabel,
          topicTitle: plan.topic.title,
          type: taskTypeOf(step),
          step,
          targetCount: effort.targetCount,
          estimatedMinutes: effort.minutes,
          dueDate: day,
          reason: plan.reason,
          ...stepCopy(step, plan.topic.title, { isReview: plan.isReview, useTeacherMaterial }),
        });
      }
      return days.indexOf(day);
    };

    for (const batch of batches) {
      const needsLaterDay = batch.some((step) => NEXT_DAY_STEPS.includes(step));
      const minIndex = Math.max(notBefore, lastIndex + (needsLaterDay ? 1 : 0));

      const placed = place(batch, minIndex);
      if (placed !== null) {
        lastIndex = placed;
        continue;
      }

      // No single day can hold the pair. Splitting them is worse than dropping
      // the week's work, so they go on separate days and the student is told.
      if (batch.length > 1) {
        let index = minIndex;
        let anyPlaced = false;
        for (const step of batch) {
          const single = place([step], index);
          if (single === null) break;
          index = single;
          lastIndex = single;
          anyPlaced = true;
        }
        if (anyPlaced) {
          splitPairs++;
          continue;
        }
      }

      skippedForCapacity++;
      break; // the rest of this topic's loop waits for next week
    }
  }

  if (splitPairs > 0) {
    notes.push(`${splitPairs} konuda konsept ve Feynman aynı güne sığmadı, ayrı günlere konuldu.`);
  }
  if (reservedForHomework > 0) {
    notes.push(`Ödevler için ${reservedForHomework} dakika ayrıldı; plan kalan boşluğa kuruldu.`);
  }
  if (skippedForCapacity > 0) {
    notes.push(`${skippedForCapacity} adım haftalık kapasiteye sığmadı, gelecek haftaya kaldı.`);
  }
  if (usedFallbackDay) {
    notes.push('Bazı adımlar ders günlerine sığmadı, haftanın diğer günlerine dağıtıldı.');
  }
  if (planned.some((p) => !p.isReview && p.topic.hasTeacherMaterial)) {
    notes.push('Hocanın yüklediği materyal olan konularda otomasyon sınavı yerine o materyal planlandı.');
  }

  slots.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { weekStart, weekEnd, slots, notes };
}

/** Deterministic Turkish copy, used as-is when the LLM is unavailable. */
export function fallbackCopy(slot: PlanSlot): { title: string; instructions: string } {
  return { title: slot.title, instructions: slot.instructions };
}
