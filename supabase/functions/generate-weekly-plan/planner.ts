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
import { addDays, diffInDays } from '../_shared/domain/dates.ts';
import { bySyllabusOrder } from '../_shared/domain/syllabus-order.ts';
import { planDeadlineWork } from '../_shared/domain/workload.ts';
import {
  effortOf,
  FIRST_CYCLE,
  REVIEW_CYCLE,
  SAME_DAY_OR_LATER_STEPS,
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
  /** Place within its week, as the syllabus lists it. */
  position: number;
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
  /**
   * The concept page and the Feynman page of one topic share this key and
   * become a single learning task with two steps. null for work that stands
   * on its own — the quiz, the advanced problems, a lone Feynman page.
   */
  learningGroupKey: string | null;
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
  /**
   * The day planning starts from. A plan made mid-week only fills the days
   * still ahead; untouched work on the days behind is replaced and its topics
   * are planned again from here. Defaults to weekStart.
   */
  today?: IsoDate;
  topics: readonly PlanTopic[];
  exams: readonly PlanExam[];
  /** Work with its own deadline; it takes its share of the week first. */
  commitments?: readonly PlanCommitment[];
  classLoad?: ClassLoad;
  courseClassDays?: CourseClassDays;
  /** Minutes of study per ISO weekday, learned from what the student finishes. */
  capacityByWeekday?: Readonly<Record<number, number>>;
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
import { DEFAULT_DAILY_CAPACITY } from '../_shared/domain/capacity.ts';
/** A class hour costs this share of the day's study budget. */
const CLASS_MINUTE_COST = 0.5;
/**
 * However full the timetable, a day keeps room for one concept + Feynman
 * sitting (55 minutes). At 30, every weekday of a four-class week fell to the
 * floor, no sitting ever fit on one, and new topics got a lone concept page
 * with the rest of their loop dropped. Never more than the day's own budget,
 * though: a day the student closed, or rarely studies, stays what it is.
 */
const CLASS_DAY_FLOOR = 60;
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
 * What this topic needs next, in order. Never skips ahead: the Feynman page
 * waits for the concept page — the two are one sitting — and the quiz waits
 * for the Feynman page, which is what makes it recall. The harder set is a
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
  today = weekStart,
  topics,
  exams,
  commitments,
  classLoad,
  courseClassDays,
  capacityByWeekday,
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
    // Equal urgency goes in syllabus order: week 2 before week 6, whatever the
    // topics are called. Ties across courses keep a fixed, name-blind order.
    .sort(
      (a, b) =>
        b.score - a.score ||
        bySyllabusOrder(a.topic, b.topic) ||
        a.topic.courseId.localeCompare(b.topic.courseId) ||
        a.topic.id.localeCompare(b.topic.id),
    )
    .slice(0, MAX_TOPICS_PER_WEEK);

  if (planned.length === 0) {
    notes.push('Planlanacak uygun konu bulunamadı; açık görevlerin zaten var.');
    return { weekStart, weekEnd, slots: [], notes };
  }

  // Exam days are for sitting the exam, not for new work — and days already
  // behind are for nothing at all: work planned onto yesterday is overdue the
  // moment it is written.
  const examDays = new Set(plannedExams.map((exam) => exam.examDate));
  const days = Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i)).filter(
    (day) => day >= today && !examDays.has(day),
  );
  if (days.length === 0) {
    notes.push(
      today > weekEnd ? 'Bu haftanın planlanacak günü kalmadı.' : 'Bu hafta kalan günlerin tamamı sınav günü; plan oluşturulmadı.',
    );
    return { weekStart, weekEnd, slots: [], notes };
  }

  // Class hours (labs included) eat into the day's study budget.
  const remaining = new Map(
    days.map((day) => {
      const weekday = isoWeekday(day);
      const budget = capacityByWeekday?.[weekday] ?? fallbackCapacity;
      const classMinutes = classLoad?.[weekday] ?? 0;
      const floor = Math.min(budget, CLASS_DAY_FLOOR);
      return [day, Math.max(floor, Math.round(budget - classMinutes * CLASS_MINUTE_COST))];
    }),
  );

  // Homework answers to a date the student did not choose, so it is booked
  // before the loop: the study plan fills what is left, not the other way
  // round. Same arithmetic the app shows on the task card.
  let reservedForHomework = 0;
  if (commitments && commitments.length > 0) {
    const reserved = planDeadlineWork({
      today: days[0] ?? today,
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
    // as one batch. The quiz is its own task: the same day or a later one,
    // never before the page.
    const batches: StudyStep[][] = [];
    const sameDay = plan.steps.filter((step) => SAME_DAY_PAIR.includes(step));
    if (sameDay.length > 0) batches.push(sameDay);
    for (const step of plan.steps) {
      if (!SAME_DAY_PAIR.includes(step)) batches.push([step]);
    }

    let lastIndex = -1; // steps never run backwards in time
    let cursor = 0; // round-robin across the course's own days

    // One key per topic per cycle: the pair keeps it even when the two halves
    // end up on different days, because they are still one piece of work.
    const pairKey = `${plan.topic.id}:${plan.isReview ? 'review' : 'first'}`;

    const place = (steps: readonly StudyStep[], minIndex: number, groupKey: string | null): number | null => {
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
          learningGroupKey: groupKey,
          ...stepCopy(step, plan.topic.title, { isReview: plan.isReview, useTeacherMaterial }),
        });
      }
      return days.indexOf(day);
    };

    for (const batch of batches) {
      // Steps never run backwards in time; the quiz may share the page's day,
      // and tries that day first — the earliest day that keeps the order.
      const minIndex = Math.max(0, lastIndex);
      if (lastIndex >= 0 && batch.some((step) => SAME_DAY_OR_LATER_STEPS.includes(step))) {
        const position = ordered.indexOf(days[lastIndex] as IsoDate);
        if (position >= 0) cursor = position;
      }

      // Only a real pair is a group; a batch of one is just a task.
      const groupKey = batch.length > 1 && batch.every((step) => SAME_DAY_PAIR.includes(step)) ? pairKey : null;
      const placed = place(batch, minIndex, groupKey);
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
          const single = place([step], index, groupKey);
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
