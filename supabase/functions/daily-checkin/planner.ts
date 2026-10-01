// Deterministic translation of an LLM extraction into database effects.
// The LLM only classifies what happened; dates, SM-2 and task generation are
// decided here so they are testable and cannot be hallucinated.
import type { CheckinExtraction } from '../_shared/contracts/daily-checkin.contract.ts';
import type {
  IsoDate,
  TaskSource as TaskSourceValue,
  TaskStatus,
  TaskType,
} from '../_shared/contracts/enums.contract.ts';
import { DEFAULT_DAILY_CAPACITY } from '../_shared/domain/capacity.ts';
import { addDays, diffInDays, isoWeekday } from '../_shared/domain/dates.ts';
import { type ClearedTask, planDayClearance } from '../_shared/domain/day-clearance.ts';
import type { DayBudget } from '../_shared/domain/workload.ts';
import {
  qualityForAccuracy,
  qualityForCompletion,
  qualityForFailure,
  type RecallQuality,
  scheduleReview,
  type SrsState,
  WEAK_ACCURACY,
} from '../_shared/domain/spaced-repetition.ts';

export interface CandidateTask {
  id: string;
  topicId: string;
  title: string;
  type: TaskType;
  /** Closed tasks are candidates too, so a later report can correct them. */
  status: TaskStatus;
  dueDate: IsoDate;
  targetCount: number | null;
  completedCount: number;
  estimatedMinutes: number | null;
  instructions: string | null;
  /** Where the task came from; homework carries a deadline that may not slip. */
  source: TaskSourceValue;
}

export interface CandidateTopic {
  id: string;
  title: string;
  courseName: string;
  /** Which teaching week this topic belongs to; scopes "sadece ilk haftanın". */
  weekNumber: number | null;
  srs: SrsState;
  /** When the next review is due; null/absent = never scheduled (counts as due). */
  nextReviewOn?: IsoDate | null;
  /**
   * The last day a review of this topic was counted — by a tap in the app or an
   * earlier report. A report describing the same day must not count it again.
   */
  lastReviewedOn?: IsoDate | null;
}

/** Courses, only so a newly announced exam can be attached to one. */
export interface CandidateCourse {
  id: string;
  name: string;
}

export interface CandidateExam {
  id: string;
  courseId: string;
  title: string;
  examDate: IsoDate;
}

/** Open entries in the mistake book, so the student can close one by saying so. */
export interface CandidateMistake {
  id: string;
  topicId: string;
  body: string;
}

// Row shapes consumed by public.apply_daily_checkin (snake_case on purpose).
export type TaskUpdateRow = {
  task_id: string;
  new_status: TaskStatus;
  confidence_level: number | null;
  /** Solved in this session — added to the running total. */
  problems_solved: number | null;
  /** Corrected total — replaces the running total. Set only for corrections. */
  completed_count: number | null;
  /** How many of them were right, when the student said. */
  correct_count: number | null;
  note: string | null;
};

export type TopicReviewRow = {
  topic_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_on: IsoDate;
  // The rest is for the review history (record_checkin_reviews); the
  // transactional RPC reads only the columns above.
  quality: RecallQuality;
  /** The day the work happened, which is what the schedule counts from. */
  reviewed_on: IsoDate;
  confidence: number | null;
  correct_count: number | null;
  attempted_count: number | null;
  /** Practice before the due day: logged, but the interval did not grow. */
  early: boolean;
  task_id: string | null;
};

/** A task this report closed for an earlier day: its completion is dated to that day. */
export type CompletionDayRow = {
  task_id: string;
  completed_on: IsoDate;
};

export type TaskSource = 'ai_checkin_reschedule' | 'ai_attachment' | 'homework';

/**
 * A task the report asks to get rid of. Whether it is deleted outright or
 * merely set aside is decided in SQL, where the task's notes, sessions and
 * progress are visible: work the student actually touched is never destroyed.
 */
export type TaskRemovalRow = {
  task_id: string;
  reason: string | null;
};

export type NewTaskRow = {
  /**
   * Generated here rather than by the database, because a step needs its
   * parent's id before either row exists.
   */
  id: string;
  parent_task_id: string | null;
  topic_id: string;
  type: TaskType;
  title: string;
  instructions: string | null;
  target_count: number | null;
  estimated_minutes: number | null;
  due_date: IsoDate;
  source: TaskSource;
  rescheduled_from_task_id: string | null;
};

/** A task that keeps everything it has and only changes the day it is due. */
export type TaskMoveRow = {
  task_id: string;
  due_date: IsoDate;
};

export type TopicFlagRow = {
  topic_id: string;
  has_advanced_material: boolean;
};

/**
 * Something the student got wrong, kept for the next time they meet the topic.
 * `body` is their own sentence — that is the part they read later; `concept`
 * is only a short label to group and deduplicate by.
 */
export type TopicMistakeRow = {
  topic_id: string;
  body: string;
  concept: string | null;
  task_id: string | null;
  /** Written down, but already behind them: kept for the record, not for review. */
  resolved: boolean;
};

/**
 * The editable fields of a task, in the column names SQL expects. A key that
 * is absent means "leave it alone" — the undo snapshot is built from exactly
 * the keys that are here, so nothing is restored that was never changed.
 */
export interface TaskEditFields {
  /** Present so the object can travel to the RPC as plain JSON. */
  [field: string]: string | number | Record<string, number> | undefined;
  title?: string;
  instructions?: string;
  type?: TaskType;
  target_count?: number;
  estimated_minutes?: number;
  starts_on?: IsoDate;
  day_allocations?: Record<IsoDate, number>;
}

export type TaskEditRow = {
  task_id: string;
  fields: TaskEditFields;
};

/** Existing tasks becoming the steps of one piece of work. */
export type TaskGroupRow = {
  parent_task_id: string;
  child_task_ids: string[];
};

export type TaskNoteRow = {
  task_id: string;
  body: string;
};

/** Time the student says they spent, stored exactly like a hand-logged session. */
export type TimeLogRow = {
  task_id: string;
  minutes: number;
  on_date: IsoDate;
};

export type ExamChangeRow = {
  action: 'insert' | 'update' | 'delete';
  exam_id: string | null;
  course_id: string | null;
  kind: 'midterm' | 'final' | 'quiz' | 'other' | null;
  title: string | null;
  exam_date: IsoDate | null;
};

export type MistakeResolutionRow = {
  mistake_id: string;
};

export interface CheckinPlan {
  summary: string;
  /** Distinct days the report talked about, oldest first. */
  coveredDates: IsoDate[];
  taskUpdates: TaskUpdateRow[];
  /** Work finished on an earlier day than the report: capacity counts it there. */
  completionDays: CompletionDayRow[];
  topicReviews: TopicReviewRow[];
  topicFlags: TopicFlagRow[];
  topicMistakes: TopicMistakeRow[];
  newTasks: NewTaskRow[];
  taskRemovals: TaskRemovalRow[];
  /** Re-specified work: title, instructions, size, estimate, start day, day split. */
  taskEdits: TaskEditRow[];
  /** Existing tasks gathered under one parent, on request only. */
  taskGroups: TaskGroupRow[];
  taskNotes: TaskNoteRow[];
  timeLogs: TimeLogRow[];
  examChanges: ExamChangeRow[];
  /** Book entries the student says they have now. */
  mistakeResolutions: MistakeResolutionRow[];
  /** Work taken off a day the student closed. */
  taskMoves: TaskMoveRow[];
  /** Weekdays the student said they can never work on; empty when unchanged. */
  blockWeekdays: number[];
  /** Days that were emptied, for the sentence the app shows afterwards. */
  clearedDates: IsoDate[];
  unmatchedMentions: string[];
  /** Ids the model returned that were not in the candidate lists (hallucinations). */
  droppedReferences: number;
}

export interface PlanInput {
  logDate: IsoDate;
  extraction: CheckinExtraction;
  tasks: readonly CandidateTask[];
  topics: readonly CandidateTopic[];
  /** Only needed to place a newly announced exam; empty when nothing is announced. */
  courses?: readonly CandidateCourse[];
  exams?: readonly CandidateExam[];
  openMistakes?: readonly CandidateMistake[];
  /** What this student actually manages per weekday; the default is used when unknown. */
  capacityByWeekday?: Readonly<Record<number, number>>;
  /** Weekdays already closed on the profile: work is never moved onto them. */
  blockedWeekdays?: readonly number[];
}

/** Caps applied to model output: the wire schema no longer advertises limits. */
const MAX_TASK_OUTCOMES = 30;
const MAX_STRUGGLES = 10;
const MAX_MENTIONS = 10;
const MAX_PROBLEMS_SOLVED = 9_999;

/** Rescheduled work is spread so no single day receives more than this many new tasks. */
const MAX_NEW_TASKS_PER_DAY = 3;
const MAX_NEW_TASKS = 12;
const STRUGGLE_DRILL_PROBLEMS = 5;
const MAX_ATTACHMENT_TASKS = 10;
const MAX_PLANNED_WORK = 10;
const MAX_REMOVALS = 40;
const MAX_EDITS = 20;
const MAX_GROUPS = 5;
const MAX_GROUP_CHILDREN = 20;
const MAX_NOTES = 10;
const MAX_TIME_LOGS = 20;
const MAX_EXAM_CHANGES = 10;
const MAX_RESOLUTIONS = 20;
/** A hand-written split covers a week or two, not a term. */
const MAX_ALLOCATION_DAYS = 14;
const MAX_TOPIC_FLAGS = 10;
/** Enough to be useful before a review, few enough to actually read. */
const MAX_MISTAKES_PER_TOPIC = 3;
/** A catch-up report can reach back two weeks; older than that is history. */
const MAX_DAYS_AGO = 14;
/** A deadline further out than this is a misread, not a deadline. */
const MAX_DAYS_AHEAD = 120;
/** How far ahead a day may be closed, and how far the work may be spread. */
const CLEAR_WINDOW_DAYS = 14;
const MAX_CLEARANCES = 7;
const MAX_MOVES = 40;
/**
 * Work that can still be moved: only what is left to do. A finished or set-aside
 * task keeps the day it happened on, and a `rescheduled` one has already been
 * replaced by a fresh task with a day of its own.
 */
const MOVABLE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['pending', 'in_progress']);
/** A task with no estimate still takes time; the same assumption the spread makes. */
const ASSUMED_TASK_MINUTES = 30;

const clamp = (text: string | null, max: number): string | null =>
  text === null ? null : text.trim().slice(0, max) || null;

/** Confidence is a 1–5 scale; anything else is coerced rather than rejected. */
const clampConfidence = (value: number | null): number | null =>
  value === null ? null : Math.min(5, Math.max(1, Math.round(value)));

/** Keeps `problems_solved` inside the column's smallint range. */
const clampSolved = (value: number | null): number | null =>
  value === null ? null : Math.min(MAX_PROBLEMS_SOLVED, Math.max(0, Math.round(value)));

/**
 * What the retry task should say. The student's own description of the slip is
 * more use here than a tidy label, so it is passed straight through.
 */
function remedialInstructions(concept: string | null, detail: string | null, fallback: string | null): string | null {
  if (concept === null && detail === null) return fallback;
  const subject = concept ?? 'takıldığın yer';
  const because = detail === null ? '' : ` Kendi notun: "${detail}".`;
  return `Önce ${subject} konusunu kaynağa bakmadan yeniden çıkar, sonra sorulara dön.${because}`;
}

/** A draft without a date: the scheduler assigns one unless the file gave a deadline. */
type Draft = Omit<NewTaskRow, 'due_date' | 'id' | 'parent_task_id'> & {
  fixed_due_date?: IsoDate;
  id?: string;
  parent_task_id?: string | null;
  /** Steps take their parent's day, whatever day that turns out to be. */
  follows_parent?: string;
};

const MAX_STEPS_PER_TASK = 10;

/** What a review rested on: shown later as "güven 4/5 · 8/10 doğru". */
interface ReviewDetail {
  confidence: number | null;
  correctCount: number | null;
  attemptedCount: number | null;
  taskId: string | null;
}

const NO_DETAIL: ReviewDetail = { confidence: null, correctCount: null, attemptedCount: null, taskId: null };

export function planCheckinEffects({
  logDate,
  extraction,
  tasks,
  topics,
  capacityByWeekday,
  blockedWeekdays = [],
  courses = [],
  exams = [],
  openMistakes = [],
}: PlanInput): CheckinPlan {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const topicById = new Map(topics.map((t) => [t.id, t]));

  /**
   * Homework is usually announced by course, not by topic ("fizikten bir ödev
   * var"). Rather than dropping it, the course is matched against the topic
   * list and the most recent topic of that course takes it — that is where the
   * student is working right now. Ambiguity is not guessed at: two matching
   * courses mean no match.
   */
  const topicForCourseMention = (text: string): string | null => {
    const haystack = text.toLocaleLowerCase('tr');
    const byCourse = new Map<string, CandidateTopic[]>();
    for (const topic of topics) {
      byCourse.set(topic.courseName, [...(byCourse.get(topic.courseName) ?? []), topic]);
    }

    const hits: CandidateTopic[] = [];
    for (const [courseName, courseTopics] of byCourse) {
      const token = courseName.toLocaleLowerCase('tr').split(/[\s·-]+/)[0] ?? '';
      if (token.length < 3 || !haystack.includes(token)) continue;
      const latest = [...courseTopics].sort((a, b) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0)).at(-1);
      if (latest) hits.push(latest);
    }
    return hits.length === 1 ? (hits[0]?.id ?? null) : null;
  };

  const taskUpdates: TaskUpdateRow[] = [];
  const drafts: Draft[] = [];
  // A catch-up report ("pazartesi şunu, dün bunu") spreads over several days;
  // the review schedule must start from the day the work really happened.
  const worstQualityByTopic = new Map<string, RecallQuality>();
  /** What the worst review rested on, for the history the student reads later. */
  const reviewDetailByTopic = new Map<string, ReviewDetail>();
  const reviewDateByTopic = new Map<string, IsoDate>();
  const coveredDates = new Set<IsoDate>();
  const completionDays: CompletionDayRow[] = [];

  const dayOf = (daysAgo: number | null): IsoDate => {
    if (daysAgo === null || !Number.isFinite(daysAgo)) return logDate;
    const clamped = Math.min(MAX_DAYS_AGO, Math.max(0, Math.round(daysAgo)));
    return addDays(logDate, -clamped);
  };
  const handledTaskIds = new Set<string>();
  const remediatedTopicIds = new Set<string>();
  // The mistake book: what went wrong, attached to the topic it belongs to.
  const mistakesByTopic = new Map<string, TopicMistakeRow[]>();
  const noteMistake = (
    topicId: string,
    detail: string | null,
    concept: string | null,
    taskId: string | null,
    resolved = false,
  ): void => {
    // The student's own words first; the label is the fallback, not the entry.
    const text = clamp(detail, 300) ?? clamp(concept, 300);
    if (!text) return;
    const current = mistakesByTopic.get(topicId) ?? [];
    if (current.length >= MAX_MISTAKES_PER_TOPIC) return;
    if (current.some((entry) => entry.body.toLocaleLowerCase('tr') === text.toLocaleLowerCase('tr'))) return;
    mistakesByTopic.set(topicId, [
      ...current,
      { topic_id: topicId, body: text, concept: clamp(concept, 120), task_id: taskId, resolved },
    ]);
  };
  let droppedReferences = 0;

  const recordQuality = (topicId: string, quality: RecallQuality, day: IsoDate, detail: ReviewDetail = NO_DETAIL) => {
    const previous = worstQualityByTopic.get(topicId);
    if (previous === undefined || quality < previous) {
      worstQualityByTopic.set(topicId, quality);
      reviewDetailByTopic.set(topicId, detail);
    }
    // The most recent day wins: that is when the topic was last seen.
    const currentDay = reviewDateByTopic.get(topicId);
    if (currentDay === undefined || day > currentDay) reviewDateByTopic.set(topicId, day);
  };

  for (const outcome of extraction.taskOutcomes.slice(0, MAX_TASK_OUTCOMES)) {
    const task = taskById.get(outcome.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    if (handledTaskIds.has(task.id)) continue;
    handledTaskIds.add(task.id);

    const weakConcept = clamp(outcome.weakConcept, 120);
    const weakDetail = clamp(outcome.weakDetail, 300);
    // "Takıldım ama hallettim" is a solved problem, not an open weakness: it is
    // written down, but it neither shortens the review interval nor breeds a
    // remedial task.
    const weakResolved = outcome.weakResolved === true;
    // A sticking point the student names goes in the book whatever the outcome
    // was: "bitirdim ama molde hesaplamalarda takıldım" is exactly the sentence
    // worth reading before the next round — in their words, not summarised.
    noteMistake(task.topicId, weakDetail, weakConcept, task.id, weakResolved);
    const confidence = clampConfidence(outcome.confidence);
    const problemsSolved = clampSolved(outcome.problemsSolved);
    const happenedOn = dayOf(outcome.daysAgo);
    coveredDates.add(happenedOn);
    const remaining = task.targetCount === null ? null : Math.max(0, task.targetCount - task.completedCount);
    const correct = clampSolved(outcome.correctCount);
    const base = {
      task_id: task.id,
      confidence_level: confidence,
      note: weakConcept,
      completed_count: null,
      correct_count: correct,
    };

    // Accuracy, when it was reported, is what the review schedule listens to:
    // "ten done" says nothing that "six of ten right" does not say better.
    const attempted = problemsSolved ?? remaining ?? task.targetCount;
    const accuracy = correct !== null && attempted !== null && attempted > 0 ? correct / attempted : null;
    const qualityOf = (fallback: RecallQuality): RecallQuality =>
      accuracy === null ? fallback : qualityForAccuracy(accuracy);
    const accuracyIsWeak = accuracy !== null && accuracy < WEAK_ACCURACY;
    const detail: ReviewDetail = {
      confidence,
      correctCount: accuracy === null ? null : correct,
      attemptedCount: accuracy === null ? null : attempted,
      taskId: task.id,
    };
    /** A solved difficulty is scored as the finish it was, not as a failure. */
    const qualityAfterStruggle = (fallback: RecallQuality): RecallQuality =>
      weakResolved && accuracy === null ? qualityForCompletion(confidence) : qualityOf(fallback);

    // --- Correction: the reported number is the new TOTAL, and the status is
    // recomputed from it — including re-opening a task that was marked done.
    if (outcome.correctsEarlierReport) {
      const total = problemsSolved ?? task.completedCount;
      const reachedTarget = task.targetCount !== null && total >= task.targetCount;
      const status: TaskStatus =
        outcome.outcome === 'failed'
          ? 'failed'
          : outcome.outcome === 'not_attempted'
            ? 'pending'
            : reachedTarget || (task.targetCount === null && outcome.outcome === 'completed')
              ? 'completed'
              : total > 0
                ? 'in_progress'
                : 'pending';

      taskUpdates.push({
        ...base,
        new_status: status,
        problems_solved: null,
        completed_count: Math.max(0, total),
        note: weakConcept ?? 'Önceki rapor düzeltildi.',
      });

      if (outcome.outcome === 'failed') {
        recordQuality(task.topicId, qualityOf(qualityForFailure(confidence)), happenedOn, detail);
      } else if (status === 'completed') {
        recordQuality(task.topicId, qualityOf(qualityForCompletion(confidence)), happenedOn, detail);
      }
      continue; // a correction never creates follow-up work on its own
    }

    switch (outcome.outcome) {
      case 'completed': {
        taskUpdates.push({ ...base, new_status: 'completed', problems_solved: problemsSolved ?? remaining });
        if (happenedOn < logDate) completionDays.push({ task_id: task.id, completed_on: happenedOn });
        recordQuality(task.topicId, qualityOf(qualityForCompletion(confidence)), happenedOn, detail);
        // Finished, but mostly wrong: the work is done and the topic is not.
        if (accuracyIsWeak && weakConcept === null && weakDetail === null) {
          noteMistake(task.topicId, `${task.title}: isabet ${correct}/${attempted}`, null, task.id);
        }
        if (accuracyIsWeak && !remediatedTopicIds.has(task.topicId)) {
          remediatedTopicIds.add(task.topicId);
          drafts.push({
            topic_id: task.topicId,
            type: task.type,
            title: clamp(`Tekrar: ${task.title}`, 200) ?? task.title,
            instructions: weakConcept
              ? `Bu turda isabet düşüktü (${correct}/${attempted}). Önce ${weakConcept} konusunu tekrar çıkar, sonra soruya dön.`
              : `Bu turda isabet düşüktü (${correct}/${attempted}). Yanlışlarını tek tek çöz.`,
            target_count: remaining === null ? null : Math.max(1, Math.ceil((task.targetCount ?? 0) / 2)),
            estimated_minutes: task.estimatedMinutes,
            source: 'ai_checkin_reschedule',
            rescheduled_from_task_id: task.id,
          });
        }
        break;
      }
      case 'partial': {
        const solved = problemsSolved;
        const finished = remaining !== null && solved !== null && solved >= remaining;
        // "Made progress but understood little" is a failed attempt in every way
        // that matters: it needs re-spacing and a remedial task.
        if (!finished && confidence !== null && confidence <= 2) {
          taskUpdates.push({ ...base, new_status: 'failed', problems_solved: solved });
          if (weakConcept === null && weakDetail === null) {
            noteMistake(task.topicId, `${task.title}: anlamadan ilerledim`, null, task.id, weakResolved);
          }
          recordQuality(task.topicId, qualityAfterStruggle(qualityForFailure(confidence)), happenedOn, detail);
          if (weakResolved) break; // sorted out already: no remedial work
          remediatedTopicIds.add(task.topicId);
          const left = remaining === null ? null : remaining - (solved ?? 0);
          drafts.push({
            topic_id: task.topicId,
            type: task.type,
            title: clamp(`Tekrar: ${task.title}`, 200) ?? task.title,
            instructions: remedialInstructions(weakConcept, weakDetail, task.instructions),
            target_count:
              task.targetCount === null ? null : Math.max(1, left !== null && left > 0 ? left : Math.ceil(task.targetCount / 2)),
            estimated_minutes: task.estimatedMinutes,
            source: 'ai_checkin_reschedule',
            rescheduled_from_task_id: task.id,
          });
          break;
        }
        taskUpdates.push({ ...base, new_status: finished ? 'completed' : 'in_progress', problems_solved: solved });
        if (finished && happenedOn < logDate) completionDays.push({ task_id: task.id, completed_on: happenedOn });
        break;
      }
      case 'failed': {
        taskUpdates.push({ ...base, new_status: 'failed', problems_solved: problemsSolved });
        if (weakConcept === null && weakDetail === null) {
          noteMistake(task.topicId, `${task.title}: takıldım`, null, task.id, weakResolved);
        }
        recordQuality(task.topicId, qualityAfterStruggle(qualityForFailure(confidence)), happenedOn, detail);
        if (weakResolved) break; // sorted out already: no remedial work
        remediatedTopicIds.add(task.topicId);
        const left = remaining === null ? null : remaining - (problemsSolved ?? 0);
        drafts.push({
          topic_id: task.topicId,
          type: task.type,
          title: clamp(`Tekrar: ${task.title}`, 200) ?? task.title,
          instructions: remedialInstructions(weakConcept, weakDetail, task.instructions),
          target_count:
            task.targetCount === null ? null : Math.max(1, left !== null && left > 0 ? left : Math.ceil(task.targetCount / 2)),
          estimated_minutes: task.estimatedMinutes,
          source: 'ai_checkin_reschedule',
          rescheduled_from_task_id: task.id,
        });
        break;
      }
      case 'not_attempted': {
        // A future task the student simply hasn't reached yet needs no change.
        if (task.dueDate > logDate) break;
        taskUpdates.push({ ...base, new_status: 'rescheduled', problems_solved: null });
        drafts.push({
          topic_id: task.topicId,
          type: task.type,
          title: task.title,
          instructions: task.instructions,
          target_count: remaining === null ? null : Math.max(1, remaining),
          estimated_minutes: task.estimatedMinutes,
          source: 'ai_checkin_reschedule',
          rescheduled_from_task_id: task.id,
        });
        break;
      }
    }
  }

  for (const struggle of extraction.topicStruggles.slice(0, MAX_STRUGGLES)) {
    const topic = topicById.get(struggle.topicId);
    if (!topic) {
      droppedReferences++;
      continue;
    }
    const struggleDay = dayOf(struggle.daysAgo);
    const struggleResolved = struggle.resolved === true;
    coveredDates.add(struggleDay);
    recordQuality(
      topic.id,
      struggleResolved
        ? qualityForCompletion(clampConfidence(struggle.confidence))
        : qualityForFailure(clampConfidence(struggle.confidence)),
      struggleDay,
      { ...NO_DETAIL, confidence: clampConfidence(struggle.confidence) },
    );

    const concept = clamp(struggle.concept, 120) ?? topic.title;
    noteMistake(topic.id, clamp(struggle.detail, 300), concept, null, struggleResolved);
    // Written down, but nothing to drill: they already got past it.
    if (struggleResolved) continue;
    if (remediatedTopicIds.has(topic.id)) continue; // a retry task already covers it
    remediatedTopicIds.add(topic.id);
    drafts.push({
      topic_id: topic.id,
      type: 'spaced_review',
      title: clamp(`Zayıf nokta: ${concept}`, 200) ?? topic.title,
      instructions: remedialInstructions(
        concept,
        clamp(struggle.detail, 300),
        `${topic.courseName} · ${topic.title}: bu noktayı izole eden sorular çöz.`,
      ),
      target_count: STRUGGLE_DRILL_PROBLEMS,
      estimated_minutes: 30,
      source: 'ai_checkin_reschedule',
      rescheduled_from_task_id: null,
    });
  }

  // --- Work found in attached files (homework sheets, photos of problem lists).
  for (const proposal of extraction.attachmentTasks.slice(0, MAX_ATTACHMENT_TASKS)) {
    const topic = topicById.get(proposal.topicId);
    if (!topic) {
      droppedReferences++;
      continue;
    }
    const title = clamp(proposal.title, 200);
    if (!title) continue;

    const count =
      proposal.problemCount === null ? null : Math.min(500, Math.max(1, Math.round(proposal.problemCount)));
    // A deadline is honoured only when the file gave a sane one.
    const stated = proposal.dueDate?.trim() ?? '';
    const validDeadline =
      /^\d{4}-\d{2}-\d{2}$/.test(stated) && stated >= logDate && diffInDays(logDate, stated) <= 120
        ? stated
        : undefined;

    drafts.push({
      topic_id: topic.id,
      type: proposal.type,
      title,
      instructions: clamp(proposal.instructions, 2000),
      target_count: count,
      estimated_minutes: count === null ? 45 : Math.min(240, Math.max(20, count * 6)),
      source: 'ai_attachment',
      rescheduled_from_task_id: null,
      ...(validDeadline ? { fixed_due_date: validDeadline } : {}),
    });
  }

  // --- Work the student states in the report itself: homework with deadlines.
  //
  // "Bu ödev bu haftaki 3 görevi karşılar" is two statements at once — a new
  // task and three that are no longer needed — so the replacements are
  // collected here and removed below.
  const removalIds = new Map<string, string | null>();
  const requestRemoval = (taskId: string, reason: string | null): void => {
    const task = taskById.get(taskId);
    if (!task) {
      droppedReferences++;
      return;
    }
    // A task they reported working on is not a task they asked to delete.
    if (handledTaskIds.has(taskId)) return;
    if (!removalIds.has(taskId)) removalIds.set(taskId, reason);
  };

  for (const proposal of extraction.plannedWork.slice(0, MAX_PLANNED_WORK)) {
    const title = clamp(proposal.title, 200);
    if (!title) continue;

    const replaced = proposal.replacesTaskIds
      .slice(0, MAX_REMOVALS)
      .map((id) => taskById.get(id))
      .filter((task): task is CandidateTask => task !== undefined);

    // The work has to live on a topic. The student's own choice first, then
    // the topic of the work it replaces — that is what "bu ödev o görevlerin
    // yerine geçiyor" means in practice.
    const topicId =
      (proposal.topicId !== null && topicById.has(proposal.topicId) ? proposal.topicId : null) ??
      replaced[0]?.topicId ??
      topicForCourseMention(title) ??
      null;

    if (topicId === null) {
      droppedReferences++;
      continue;
    }

    for (const task of replaced) requestRemoval(task.id, `"${title}" bu görevin yerine geçti`);

    const count =
      proposal.problemCount === null ? null : Math.min(500, Math.max(1, Math.round(proposal.problemCount)));
    const due =
      proposal.dueInDays === null || !Number.isFinite(proposal.dueInDays)
        ? undefined
        : addDays(logDate, Math.min(MAX_DAYS_AHEAD, Math.max(0, Math.round(proposal.dueInDays))));

    const parentId = crypto.randomUUID();
    const totalMinutes = count === null ? 45 : Math.min(240, Math.max(20, count * 6));
    // Only the student's own breakdown creates steps; nothing is split here
    // on a hunch.
    const steps = (proposal.subtasks ?? [])
      .map((step) => clamp(step, 200))
      .filter((step): step is string => step !== null)
      .slice(0, MAX_STEPS_PER_TASK);

    drafts.push({
      id: parentId,
      parent_task_id: null,
      topic_id: topicId,
      type: proposal.type,
      title,
      instructions: clamp(proposal.instructions, 2000),
      target_count: count,
      estimated_minutes: totalMinutes,
      source: 'homework',
      rescheduled_from_task_id: null,
      ...(due ? { fixed_due_date: due } : {}),
    });

    for (const step of steps) {
      drafts.push({
        id: crypto.randomUUID(),
        parent_task_id: parentId,
        follows_parent: parentId,
        topic_id: topicId,
        type: proposal.type,
        title: step,
        instructions: null,
        target_count: null,
        estimated_minutes: Math.max(5, Math.round(totalMinutes / steps.length)),
        source: 'homework',
        rescheduled_from_task_id: null,
        ...(due ? { fixed_due_date: due } : {}),
      });
    }
  }

  // --- "Şu görevi şu adımlara böl": only ever on request.
  for (const breakdown of extraction.taskBreakdowns.slice(0, MAX_PLANNED_WORK)) {
    const parent = taskById.get(breakdown.taskId);
    if (!parent) {
      droppedReferences++;
      continue;
    }
    const steps = breakdown.steps
      .map((step) => clamp(step, 200))
      .filter((step): step is string => step !== null)
      .slice(0, MAX_STEPS_PER_TASK);
    if (steps.length < 2) continue; // one "step" is just the task itself

    const perStep =
      parent.estimatedMinutes === null ? null : Math.max(5, Math.round(parent.estimatedMinutes / steps.length));
    for (const step of steps) {
      drafts.push({
        id: crypto.randomUUID(),
        parent_task_id: parent.id,
        topic_id: parent.topicId,
        type: parent.type,
        title: step,
        instructions: null,
        target_count: null,
        estimated_minutes: perStep,
        source: 'homework',
        rescheduled_from_task_id: null,
        fixed_due_date: parent.dueDate,
      });
    }
  }

  // --- Re-specifying work that already exists.
  //
  // Everything here is something the student can change on the task's own
  // screen; saying it in the report is meant to be the same act, so the same
  // bounds apply — a value the column would refuse is clamped, not sent.
  const taskEdits: TaskEditRow[] = [];
  const editedTaskIds = new Set<string>();
  for (const edit of extraction.taskEdits.slice(0, MAX_EDITS)) {
    const task = taskById.get(edit.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    if (editedTaskIds.has(task.id)) continue;

    const fields: TaskEditFields = {};
    const newTitle = clamp(edit.newTitle, 200);
    if (newTitle !== null) fields.title = newTitle;
    const newInstructions = clamp(edit.instructions, 2000);
    if (newInstructions !== null) fields.instructions = newInstructions;
    if (edit.type !== null) fields.type = edit.type;
    if (edit.targetCount !== null && Number.isFinite(edit.targetCount)) {
      fields.target_count = Math.min(500, Math.max(1, Math.round(edit.targetCount)));
    }
    if (edit.estimatedMinutes !== null && Number.isFinite(edit.estimatedMinutes)) {
      // The column accepts 5–600; a report is no place to discover that.
      fields.estimated_minutes = Math.min(600, Math.max(5, Math.round(edit.estimatedMinutes)));
    }
    if (edit.startsInDays !== null && Number.isFinite(edit.startsInDays)) {
      const startsOn = addDays(
        logDate,
        Math.min(MAX_DAYS_AHEAD, Math.max(-MAX_DAYS_AGO, Math.round(edit.startsInDays))),
      );
      // A window opening after the deadline would hide the work completely.
      fields.starts_on = startsOn > task.dueDate ? task.dueDate : startsOn;
    }

    const allocation: Record<IsoDate, number> = {};
    for (const slot of (edit.dayMinutes ?? []).slice(0, MAX_ALLOCATION_DAYS)) {
      if (!Number.isFinite(slot.daysAhead) || !Number.isFinite(slot.minutes)) continue;
      const day = addDays(logDate, Math.min(MAX_DAYS_AHEAD, Math.max(0, Math.round(slot.daysAhead))));
      // Zero is meaningful: it closes that day for this piece of work.
      allocation[day] = Math.min(600, Math.max(0, Math.round(slot.minutes)));
    }
    if (Object.keys(allocation).length > 0) fields.day_allocations = allocation;

    if (Object.keys(fields).length === 0) continue;
    editedTaskIds.add(task.id);
    taskEdits.push({ task_id: task.id, fields });
  }

  // --- "Şunları tek iş olarak grupla": only ever on request, one level deep.
  const taskGroups: TaskGroupRow[] = [];
  const groupedChildIds = new Set<string>();
  for (const group of extraction.taskGroups.slice(0, MAX_GROUPS)) {
    const children = [...new Set(group.childTaskIds)]
      .map((id) => taskById.get(id))
      .filter((task): task is CandidateTask => task !== undefined)
      .filter((task) => !groupedChildIds.has(task.id))
      .slice(0, MAX_GROUP_CHILDREN);
    if (children.length === 0) continue;

    const owner = group.parentTaskId === null ? undefined : taskById.get(group.parentTaskId);
    if (owner) {
      const steps = children.filter((child) => child.id !== owner.id);
      if (steps.length === 0) continue;
      for (const step of steps) groupedChildIds.add(step.id);
      taskGroups.push({ parent_task_id: owner.id, child_task_ids: steps.map((s) => s.id) });
      continue;
    }

    // No task among them is the whole, so the group gets a container of its
    // own. Two is the smallest thing worth calling a group.
    const title = clamp(group.newParentTitle, 200);
    const first = children[0];
    if (title === null || first === undefined || children.length < 2) continue;
    const parentId = crypto.randomUUID();
    // The container is due when its last step is: finishing it earlier would
    // mean nothing, and finishing it later would hide the deadline.
    const latest = [...children].map((child) => child.dueDate).sort().at(-1) ?? first.dueDate;
    drafts.push({
      id: parentId,
      parent_task_id: null,
      topic_id: first.topicId,
      type: first.type,
      title,
      instructions: null,
      target_count: null,
      estimated_minutes: null,
      source: 'homework',
      rescheduled_from_task_id: null,
      fixed_due_date: latest,
    });
    for (const child of children) groupedChildIds.add(child.id);
    taskGroups.push({ parent_task_id: parentId, child_task_ids: children.map((c) => c.id) });
  }

  // --- A note against a task: something to remember, not something done.
  const taskNotes: TaskNoteRow[] = [];
  for (const note of extraction.taskNotes.slice(0, MAX_NOTES)) {
    const task = taskById.get(note.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    const body = clamp(note.body, 2000);
    if (body === null) continue;
    taskNotes.push({ task_id: task.id, body });
  }

  // --- Time spent, when they actually said a duration.
  const timeLogs: TimeLogRow[] = [];
  for (const log of extraction.timeLogs.slice(0, MAX_TIME_LOGS)) {
    const task = taskById.get(log.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    if (!Number.isFinite(log.minutes)) continue;
    const minutes = Math.min(1440, Math.max(1, Math.round(log.minutes)));
    const onDate = dayOf(log.daysAgo);
    coveredDates.add(onDate);
    timeLogs.push({ task_id: task.id, minutes, on_date: onDate });
  }

  // --- The exam calendar.
  const examChanges: ExamChangeRow[] = [];
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const touchedExamIds = new Set<string>();
  for (const change of extraction.examChanges.slice(0, MAX_EXAM_CHANGES)) {
    const examDate =
      change.dateInDays === null || !Number.isFinite(change.dateInDays)
        ? null
        : addDays(logDate, Math.min(MAX_DAYS_AHEAD, Math.max(-MAX_DAYS_AGO, Math.round(change.dateInDays))));

    if (change.action === 'insert') {
      const course = change.courseId === null ? undefined : courseById.get(change.courseId);
      // An exam with no course has nowhere to live, and one with no date is
      // not yet an exam.
      if (!course || examDate === null) {
        droppedReferences++;
        continue;
      }
      examChanges.push({
        action: 'insert',
        exam_id: null,
        course_id: course.id,
        kind: change.kind,
        title: clamp(change.title, 120) ?? `${course.name} sınavı`,
        exam_date: examDate,
      });
      continue;
    }

    const exam = change.examId === null ? undefined : examById.get(change.examId);
    if (!exam || touchedExamIds.has(exam.id)) {
      if (!exam) droppedReferences++;
      continue;
    }
    const title = clamp(change.title, 120);
    // An update that changes nothing is not an update.
    if (change.action === 'update' && examDate === null && title === null && change.kind === null) continue;
    touchedExamIds.add(exam.id);
    examChanges.push({
      action: change.action,
      exam_id: exam.id,
      course_id: null,
      kind: change.action === 'delete' ? null : change.kind,
      title: change.action === 'delete' ? null : title,
      exam_date: change.action === 'delete' ? null : examDate,
    });
  }

  // --- Book entries they say are behind them now.
  const mistakeResolutions: MistakeResolutionRow[] = [];
  const openMistakeIds = new Set(openMistakes.map((mistake) => mistake.id));
  const resolvedIds = new Set<string>();
  for (const resolution of extraction.mistakeResolutions.slice(0, MAX_RESOLUTIONS)) {
    if (!openMistakeIds.has(resolution.mistakeId)) {
      droppedReferences++;
      continue;
    }
    if (resolvedIds.has(resolution.mistakeId)) continue;
    resolvedIds.add(resolution.mistakeId);
    mistakeResolutions.push({ mistake_id: resolution.mistakeId });
  }

  // --- Tasks the student asks to drop outright.
  for (const removal of extraction.taskRemovals.slice(0, MAX_REMOVALS)) {
    requestRemoval(removal.taskId, clamp(removal.reason, 200));
  }

  const taskRemovals: TaskRemovalRow[] = [...removalIds].map(([task_id, reason]) => ({ task_id, reason }));

  // --- Days the student cannot work.
  //
  // "Pazar gününü boşalt, o gün hiçbir şey yapamam, o günün görevlerini bugünden
  // başlayarak dağıt" is three instructions in one sentence: empty that day,
  // keep the work, and start putting it back from today. None of it is a
  // deletion, so none of it belongs anywhere else in this file.
  //
  // The model says WHICH day; which day each task lands on is worked out here,
  // against the student's own capacity — that is not a judgement a language
  // model gets to make.
  const closedWeekdays = new Set<number>(blockedWeekdays);
  const newlyClosedWeekdays = new Set<number>();
  const clearedDates = new Set<IsoDate>();
  /** null = they did not say, and the day the report covers is as early as it gets. */
  let statedSpreadFrom: number | null = null;

  for (const clearance of extraction.dayClearances.slice(0, MAX_CLEARANCES)) {
    if (!Number.isFinite(clearance.daysAhead)) continue;
    const offset = Math.min(CLEAR_WINDOW_DAYS, Math.max(0, Math.round(clearance.daysAhead)));
    const date = addDays(logDate, offset);
    clearedDates.add(date);

    // "Pazarları hiç çalışamam" is not a fact about this Sunday: it closes the
    // weekday itself, here and on the profile, so next week's plan knows too.
    if (clearance.everyWeek) {
      const weekday = isoWeekday(date);
      newlyClosedWeekdays.add(weekday);
      closedWeekdays.add(weekday);
      for (let ahead = 0; ahead <= CLEAR_WINDOW_DAYS; ahead++) {
        const day = addDays(logDate, ahead);
        if (isoWeekday(day) === weekday) clearedDates.add(day);
      }
    }

    if (clearance.spreadFromDaysAhead !== null && Number.isFinite(clearance.spreadFromDaysAhead)) {
      const from = Math.min(CLEAR_WINDOW_DAYS, Math.max(0, Math.round(clearance.spreadFromDaysAhead)));
      statedSpreadFrom = statedSpreadFrom === null ? from : Math.min(statedSpreadFrom, from);
    }
  }

  const moveByTaskId = new Map<string, IsoDate>();
  /**
   * Work the student reported on in the same breath still has to leave a closed
   * day: "5 soru çözdüm, pazarı boşalt" leaves five questions to do, and they
   * cannot be done on a day the student says is impossible. What counts is the
   * status the task ends this check-in with, not the one it started with.
   */
  const canMove = (task: CandidateTask): boolean => {
    if (removalIds.has(task.id)) return false;
    const update = taskUpdates.find((row) => row.task_id === task.id);
    return update === undefined ? MOVABLE_STATUSES.has(task.status) : MOVABLE_STATUSES.has(update.new_status);
  };

  // A single task the student named: their day wins, no arithmetic needed.
  for (const move of extraction.taskReschedules.slice(0, MAX_MOVES)) {
    const task = taskById.get(move.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    if (!canMove(task) || !Number.isFinite(move.dueInDays)) continue;
    const date = addDays(logDate, Math.min(MAX_DAYS_AHEAD, Math.max(0, Math.round(move.dueInDays))));
    if (date !== task.dueDate) moveByTaskId.set(task.id, date);
  }

  if (clearedDates.size > 0) {
    const movable = tasks.filter((task) => clearedDates.has(task.dueDate) && canMove(task) && !moveByTaskId.has(task.id));

    if (movable.length > 0) {
      const moving = new Set(movable.map((task) => task.id));
      // What each remaining day already owes, so the spread does not pile work
      // onto a day that is full of its own.
      const committed = new Map<IsoDate, number>();
      for (const task of tasks) {
        if (!MOVABLE_STATUSES.has(task.status) || moving.has(task.id) || removalIds.has(task.id)) continue;

        const minutes = task.estimatedMinutes ?? ASSUMED_TASK_MINUTES;
        committed.set(task.dueDate, (committed.get(task.dueDate) ?? 0) + minutes);
      }

      const days: DayBudget[] = [];
      for (let ahead = 0; ahead <= CLEAR_WINDOW_DAYS; ahead++) {
        const date = addDays(logDate, (statedSpreadFrom ?? 0) + ahead);
        if (clearedDates.has(date) || closedWeekdays.has(isoWeekday(date))) continue;
        days.push({
          date,
          capacityMinutes: capacityByWeekday?.[isoWeekday(date)] ?? DEFAULT_DAILY_CAPACITY,
          committedMinutes: committed.get(date) ?? 0,
        });
      }

      const cleared: ClearedTask[] = movable.slice(0, MAX_MOVES).map((task) => ({
        id: task.id,
        dueDate: task.dueDate,
        estimatedMinutes: task.estimatedMinutes ?? ASSUMED_TASK_MINUTES,
        // Homework has a real deadline behind it; a generated study step does not.
        hasDeadline: task.source === 'homework' || task.source === 'ai_attachment',
      }));

      for (const placement of planDayClearance({ days, tasks: cleared }).placements) {
        moveByTaskId.set(placement.taskId, placement.date);
      }
    }
  }

  const taskMoves: TaskMoveRow[] = [...moveByTaskId].map(([task_id, due_date]) => ({ task_id, due_date }));

  // A task that moved cannot keep day-level decisions made for the days it has
  // left: a start day and a per-day split both point at a deadline that is no
  // longer there. They are dropped from the edit rather than written and then
  // overwritten, so the undo snapshot stays a true picture of what changed.
  for (const edit of taskEdits) {
    if (!moveByTaskId.has(edit.task_id)) continue;
    delete edit.fields['starts_on'];
    delete edit.fields['day_allocations'];
  }

  // "Elimde bu konudan zor sorular var" — the one fact that unlocks advanced work.
  const topicFlags: TopicFlagRow[] = [];
  const flaggedTopics = new Set<string>();
  for (const flag of extraction.advancedMaterialTopics.slice(0, MAX_TOPIC_FLAGS)) {
    if (!topicById.has(flag.topicId) || flaggedTopics.has(flag.topicId)) {
      if (!topicById.has(flag.topicId)) droppedReferences++;
      continue;
    }
    flaggedTopics.add(flag.topicId);
    topicFlags.push({ topic_id: flag.topicId, has_advanced_material: flag.hasAdvancedMaterial });
  }

  const topicReviews: TopicReviewRow[] = [];
  for (const [topicId, quality] of worstQualityByTopic) {
    const topic = topicById.get(topicId);
    if (!topic) continue; // task's topic outside the candidate window: skip SRS, keep task update
    const seenOn = reviewDateByTopic.get(topicId) ?? logDate;
    // Same rules as a tap in the app: a session already counted today — say,
    // ticked off this afternoon — is not counted again tonight.
    const decision = scheduleReview(topic.srs, quality, {
      reviewedOn: seenOn,
      dueOn: topic.nextReviewOn ?? null,
      lastReviewedOn: topic.lastReviewedOn ?? null,
    });
    if (!decision.counted) continue;
    const detail = reviewDetailByTopic.get(topicId) ?? NO_DETAIL;
    // Never schedule a review in the past: a three-day-old session with a
    // one-day interval is due now, not yesterday.
    topicReviews.push({
      topic_id: topicId,
      ease_factor: decision.state.easeFactor,
      interval_days: decision.state.intervalDays,
      repetitions: decision.state.repetitions,
      next_review_on: decision.nextReviewOn < logDate ? logDate : decision.nextReviewOn,
      quality,
      reviewed_on: seenOn,
      confidence: detail.confidence,
      correct_count: detail.correctCount,
      attempted_count: detail.attemptedCount,
      early: decision.early,
      task_id: detail.taskId,
    });
  }

  let spread = 0;
  const dueByDraftId = new Map<string, IsoDate>();
  const newTasks: NewTaskRow[] = drafts
    .slice(0, MAX_NEW_TASKS)
    .map(({ fixed_due_date, follows_parent, id, parent_task_id, ...draft }) => {
      const taskId = id ?? crypto.randomUUID();
      const due =
        (follows_parent ? dueByDraftId.get(follows_parent) : undefined) ??
        fixed_due_date ??
        addDays(logDate, 1 + Math.floor(spread++ / MAX_NEW_TASKS_PER_DAY));
      dueByDraftId.set(taskId, due);
      return { ...draft, id: taskId, parent_task_id: parent_task_id ?? null, due_date: due };
    });

  return {
    summary: clamp(extraction.summary, 500) ?? 'Check-in processed.',
    coveredDates: [...coveredDates].sort(),
    taskUpdates,
    completionDays,
    topicReviews,
    topicFlags,
    topicMistakes: [...mistakesByTopic.values()].flat(),
    newTasks,
    taskRemovals,
    taskEdits,
    taskGroups,
    taskNotes,
    timeLogs,
    examChanges,
    mistakeResolutions,
    taskMoves,
    blockWeekdays: [...newlyClosedWeekdays].sort((a, b) => a - b),
    clearedDates: [...clearedDates].sort(),
    unmatchedMentions: extraction.unmatchedMentions
      .slice(0, MAX_MENTIONS)
      .map((m) => clamp(m, 200))
      .filter((m): m is string => m !== null),
    droppedReferences,
  };
}
