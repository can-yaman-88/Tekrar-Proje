// Deterministic translation of an LLM extraction into database effects.
// The LLM only classifies what happened; dates, SM-2 and task generation are
// decided here so they are testable and cannot be hallucinated.
import type { CheckinExtraction, CheckinReminder } from '../_shared/contracts/daily-checkin.contract.ts';
import type {
  IsoDate,
  TaskSource as TaskSourceValue,
  TaskStatus,
  TaskType,
} from '../_shared/contracts/enums.contract.ts';
import { DEFAULT_DAILY_CAPACITY } from '../_shared/domain/capacity.ts';
import { buildCramPlan, CRAM_WINDOW_DAYS, type CramTopic } from '../_shared/domain/cram-plan.ts';
import { addDays, diffInDays, isoWeekday } from '../_shared/domain/dates.ts';
import { type ClearedTask, planDayClearance } from '../_shared/domain/day-clearance.ts';
import { bySyllabusOrder } from '../_shared/domain/syllabus-order.ts';
import { planWeekShape, type ShapeDay, type ShapeTask, studyStepOf } from '../_shared/domain/week-shape.ts';
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
import { relativeDay, weekdayName } from './format.ts';

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
  /** Set when the task is a step of another: steps travel with their card. */
  parentTaskId: string | null;
  /** The exam a sprint task was made for; null for everything else. */
  originExamId: string | null;
  /** Marked urgent: kept where it is when a day has to shed work. */
  isPriority: boolean;
}

export interface CandidateTopic {
  id: string;
  /** "Kimyayı bu hafta dondur" reaches a task through its topic's course. */
  courseId: string;
  title: string;
  courseName: string;
  /** Which teaching week this topic belongs to; scopes "sadece ilk haftanın". */
  weekNumber: number | null;
  /** Place within its week, as the syllabus lists it. */
  position: number;
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

/** What "vize için plan çıkar" needs to build the same plan the exam screen would. */
export interface CramContext {
  examId: string;
  topics: CramTopic[];
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

/**
 * `manual` is work the student set themselves in the report: a day to do it on,
 * not a deadline. `exam_cram` is a sprint plan the report asked for.
 */
export type TaskSource = 'ai_checkin_reschedule' | 'ai_attachment' | 'homework' | 'manual' | 'exam_cram';

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

/** Study outside the plan, written down as work that is finished the moment it exists. */
export type ExtraWorkRow = {
  id: string;
  topic_id: string;
  type: TaskType;
  title: string;
  target_count: number | null;
  completed_count: number;
  correct_count: number | null;
  estimated_minutes: number;
  on_date: IsoDate;
  /** Minutes they said it took; a measured session, like one logged by hand. */
  session_minutes: number | null;
};

/** How an exam went, on the exam itself; its topics' schedule travels as topic reviews. */
export type ExamResultRow = {
  exam_id: string;
  outcome: number;
  note: string | null;
};

export type PriorityRow = {
  task_id: string;
  is_priority: boolean;
};

/** The topics an exam covers, as the report states them. */
export type ExamScopeRow = {
  exam_id: string;
  topic_ids: string[];
  /** The whole list, or an addition to the one already there. */
  replace: boolean;
};

/** A sprint task created by this check-in, and the exam it belongs to. */
export type ExamLinkRow = {
  task_id: string;
  exam_id: string;
};

/** A question from the report, with the day it asks about already worked out. */
export interface PlanQuestion {
  kind: CheckinExtraction['infoRequests'][number]['kind'];
  /** The day for an agenda question; null for every other kind. */
  date: IsoDate | null;
}

/**
 * Decisions about the shape of the coming days that are not rows of their own
 * but that the student should hear about: which days lost their work, which
 * got a time limit, which courses were set aside.
 */
export interface ScheduleFacts {
  /** Days a "hiç çalışamadım" emptied. */
  missedDates: IsoDate[];
  /** Days given a time limit, with the minutes they got. */
  dayBudgets: { date: IsoDate; minutes: number }[];
  holds: { mode: 'pause' | 'only'; courseIds: string[]; from: IsoDate; until: IsoDate }[];
  /** Tasks closed by one "hepsini bitirdim", so the change list can say it in one line. */
  bulkCompletedTaskIds: string[];
  /** Sprint plans built for an exam, told as one line each rather than task by task. */
  examPlans: { examId: string; tasks: number; days: number }[];
  swaps: { first: IsoDate; second: IsoDate }[];
  syllabusOrders: { from: IsoDate; until: IsoDate; moved: number }[];
  tidies: { from: IsoDate; until: IsoDate; paired: number }[];
  backlog: { action: 'spread' | 'close'; tasks: number }[];
}

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
  /** Closed weekdays the student said they can work on again. */
  reopenWeekdays: number[];
  /** Days that were emptied, for the sentence the app shows afterwards. */
  clearedDates: IsoDate[];
  extraWork: ExtraWorkRow[];
  /** Containers whose steps become cards of their own. */
  taskUngroups: string[];
  examScopes: ExamScopeRow[];
  examResults: ExamResultRow[];
  priorities: PriorityRow[];
  examLinks: ExamLinkRow[];
  /** Notifications for the phone to schedule. */
  reminders: CheckinReminder[];
  schedule: ScheduleFacts;
  questions: PlanQuestion[];
  /** What could not be done as asked, in the student's language. */
  notes: string[];
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
  /** Topics each exam covers, for a result the report gives; loaded only then. */
  examTopicIds?: Readonly<Record<string, readonly string[]>>;
  /** Readiness of an exam's topics, for a plan the report asks for; loaded only then. */
  cramContexts?: readonly CramContext[];
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
/** "Tüm görevleri İngilizce yap" renames the whole week, not a handful. */
const MAX_EDITS = 80;
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
const MAX_DAY_TARGETS = 7;
/** More cards than this in one day is not a target, it is a misread. */
const MAX_MAIN_TASKS_PER_DAY = 12;
const MAX_BULK_OUTCOMES = 7;
const MAX_DAY_LOADS = 7;
const MAX_HOLDS = 5;
const MAX_QUESTIONS = 6;
/**
 * "Yarın çok yoğunum, hafif olsun" names no number, and the model is not
 * allowed to invent one. The app's answer: half of what that weekday usually
 * holds — enough to keep the cycle moving, light enough to be believed.
 */
const LIGHT_DAY_SHARE = 0.5;
const MIN_LIGHT_DAY_MINUTES = 15;
/** A final can sit a term away; a date past this is a misread year. */
const MAX_EXAM_DAYS_AHEAD = 366;
/** Which card gives up a crowded day first: the one furthest along the cycle. */
const KEEP_RANK: Partial<Record<TaskType, number>> = {
  learning: 0,
  concept_note: 0,
  feynman: 1,
  quiz: 3,
  advanced_problems: 4,
};
/** Homework and everything outside the loop sits between the page and the quiz. */
const DEFAULT_KEEP_RANK = 2;
const MAX_EXTRA_WORK = 10;
const MAX_UNGROUPS = 30;
const MAX_SWAPS = 3;
const MAX_STRETCH_OPS = 2;
const MAX_SCOPES = 5;
/** "Haftayı düzenle" with no end named: the week that starts there. */
const DEFAULT_STRETCH_DAYS = 6;
/** The same words the weekly plan and the week tidier give a learning card. */
const LEARNING_INSTRUCTIONS =
  'Konsept sayfası ve Feynman anlatımı aynı oturum: önce sayfaya ekle, sonra kapat ve boş kâğıda anlat.';
const MAX_PRIORITIES = 10;
const MAX_EXAM_PLANS = 2;
/** A sprint is a week of evenings; more steps than this is not a sprint. */
const MAX_CRAM_TASKS = 40;
const MAX_REMINDERS = 5;
/** A reminder further out than this is the calendar's job, not a check-in's. */
const MAX_REMINDER_DAYS_AHEAD = 60;
/** "Yarın hatırlat" with no hour: the morning, when the day can still be arranged around it. */
const DEFAULT_REMINDER_TIME = '09:00';
/** A topic the student names as the hard part of an exam fails, however the exam went. */
const HARD_TOPIC_QUALITY: RecallQuality = 2;

/**
 * A score, as a verdict. The score is the one objective thing an exam leaves
 * behind, so when the student gives one it outranks how they felt about it.
 */
function outcomeForScore(percent: number): 1 | 2 | 3 | 4 | 5 {
  if (percent >= 85) return 5;
  if (percent >= 70) return 4;
  if (percent >= 55) return 3;
  if (percent >= 40) return 2;
  return 1;
}
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

/**
 * A `YYYY-MM-DD` the model wrote, when it is a real day inside the range.
 * "2026-02-30" is not a date, however well it matches the pattern, and a date
 * outside the range is a misread — dropped, never clamped into a wrong day.
 */
const validDate = (text: string | null, min: IsoDate, max: IsoDate): IsoDate | null => {
  const value = text?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return value >= min && value <= max ? value : null;
};

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
  examTopicIds = {},
  cramContexts = [],
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
  /** What could not be done as asked, in the student's language. */
  const notes: string[] = [];

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

  // --- Cards. A container and the steps listed under it are one piece of work:
  // they finish together and they move together.
  const leaderOf = (task: CandidateTask): string =>
    task.parentTaskId !== null && taskById.has(task.parentTaskId) ? task.parentTaskId : task.id;
  const cardMembers = new Map<string, CandidateTask[]>();
  for (const task of tasks) cardMembers.set(leaderOf(task), [...(cardMembers.get(leaderOf(task)) ?? []), task]);
  /** A container whose steps are listed: its status is theirs to decide, and its minutes are theirs. */
  const hasListedSteps = new Set(tasks.filter((task) => leaderOf(task) !== task.id).map(leaderOf));
  const courseOf = (task: CandidateTask): string | null => topicById.get(task.topicId)?.courseId ?? null;

  // --- "Bugünkü her şeyi bitirdim", "bugün hiç çalışamadım".
  //
  // The model says which DAY and which courses; which tasks that means is read
  // off the list here, where a missed task cannot be. A task the report names
  // on its own keeps its own outcome; a statement narrowed to some courses
  // beats the unnarrowed one ("fizikte hiçbir şey yapmadım, geri kalan her
  // şeyi bitirdim").
  /** The tasks named, and every step of any container among them. */
  const withSteps = (ids: readonly string[]): Set<string> =>
    new Set(
      ids.flatMap((id) => {
        const task = taskById.get(id);
        if (!task) return [];
        return leaderOf(task) === task.id ? (cardMembers.get(id) ?? [task]).map((member) => member.id) : [id];
      }),
    );
  const named = withSteps(extraction.taskOutcomes.map((outcome) => outcome.taskId));
  const bulkClaimed = new Set<string>();
  const bulkCompleted: CheckinExtraction['taskOutcomes'] = [];
  const missedTaskIds = new Set<string>();
  const missedDates = new Set<IsoDate>();
  const bulks = extraction.bulkOutcomes
    .slice(0, MAX_BULK_OUTCOMES)
    .sort((a, b) => Number(a.courseIds.length === 0) - Number(b.courseIds.length === 0));
  for (const bulk of bulks) {
    const day = dayOf(bulk.daysAgo);
    const onlyCourses = new Set(bulk.courseIds);
    const except = withSteps(bulk.exceptTaskIds);
    for (const task of tasks) {
      if (task.dueDate !== day || !MOVABLE_STATUSES.has(task.status) || bulkClaimed.has(task.id)) continue;
      if (named.has(task.id) || except.has(task.id)) continue;
      const course = courseOf(task);
      if (onlyCourses.size > 0 && (course === null || !onlyCourses.has(course))) continue;
      bulkClaimed.add(task.id);
      if (bulk.outcome === 'not_attempted') {
        missedTaskIds.add(task.id);
        missedDates.add(day);
      } else if (!hasListedSteps.has(task.id)) {
        // A container is finished by its steps, never directly.
        bulkCompleted.push({
          taskId: task.id,
          outcome: 'completed',
          problemsSolved: null,
          correctCount: null,
          daysAgo: bulk.daysAgo,
          correctsEarlierReport: false,
          confidence: null,
          weakConcept: null,
          weakResolved: false,
          weakDetail: null,
        });
      }
    }
  }

  for (const outcome of [...extraction.taskOutcomes.slice(0, MAX_TASK_OUTCOMES), ...bulkCompleted]) {
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

  // --- Study outside the plan: "plan dışı 15 türev sorusu çözdüm, 12 doğru".
  //
  // It used to land in "bunları bir göreve bağlayamadım", and with it went the
  // one thing it proves: that the topic was practised, and how well. It is now
  // a finished task on the day it happened — counted by the capacity learner,
  // shown in the week's summary — and its accuracy reaches the review schedule
  // exactly as a planned task's would.
  const extraWork: ExtraWorkRow[] = [];
  for (const item of extraction.extraWork.slice(0, MAX_EXTRA_WORK)) {
    const topic = topicById.get(item.topicId);
    if (!topic) {
      droppedReferences++;
      continue;
    }
    const solved = clampSolved(item.problemsSolved);
    const counted = solved !== null && solved > 0 ? solved : null;
    // Never more right than were solved; unsaid is unknown, not "all of them".
    const reportedCorrect = clampSolved(item.correctCount);
    const correctCount = counted === null || reportedCorrect === null ? null : Math.min(counted, reportedCorrect);
    const minutes =
      item.minutes !== null && Number.isFinite(item.minutes) ? Math.min(600, Math.max(1, Math.round(item.minutes))) : null;
    const day = dayOf(item.daysAgo);
    coveredDates.add(day);

    const accuracy = counted !== null && correctCount !== null ? correctCount / counted : null;
    recordQuality(topic.id, accuracy === null ? qualityForCompletion(null) : qualityForAccuracy(accuracy), day);
    if (accuracy !== null && accuracy < WEAK_ACCURACY) {
      noteMistake(topic.id, `Ek çalışma: isabet ${correctCount}/${counted}`, null, null);
    }

    extraWork.push({
      id: crypto.randomUUID(),
      topic_id: topic.id,
      type: counted === null ? 'concept_review' : 'problem_set',
      title: clamp(`Ek çalışma: ${topic.title}${counted === null ? '' : ` — ${counted} soru`}`, 200) ?? 'Ek çalışma',
      target_count: counted,
      completed_count: counted ?? 0,
      correct_count: correctCount,
      estimated_minutes: minutes ?? (counted === null ? ASSUMED_TASK_MINUTES : Math.min(240, Math.max(10, counted * 6))),
      on_date: day,
      session_minutes: minutes,
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
    // A named calendar date beats a count of days: it is what they wrote.
    const due =
      validDate(proposal.dueDate, logDate, addDays(logDate, MAX_DAYS_AHEAD)) ??
      (proposal.dueInDays === null || !Number.isFinite(proposal.dueInDays)
        ? undefined
        : addDays(logDate, Math.min(MAX_DAYS_AHEAD, Math.max(0, Math.round(proposal.dueInDays)))));
    // "Yarın 20 türev sorusu çözeceğim" is a day they chose, not a deadline
    // someone gave them: it must not be filed as homework, nor guarded like one.
    const source: TaskSource = proposal.isHomework === false ? 'manual' : 'homework';

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
      source,
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
        source,
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

  // --- "Grupları dağıt": the steps become cards of their own, and the empty
  // container goes — SQL decides whether it is deleted or set aside, and does
  // it after the steps are out, never before.
  const taskUngroups: string[] = [];
  for (const request of extraction.taskUngroups.slice(0, MAX_UNGROUPS)) {
    const task = taskById.get(request.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    const container = hasListedSteps.has(task.id) ? task : taskById.get(leaderOf(task));
    if (!container || !hasListedSteps.has(container.id) || taskUngroups.includes(container.id)) continue;
    taskUngroups.push(container.id);
  }
  const ungrouped = new Set(taskUngroups);
  /** A step whose card is being taken apart in this same report is already free. */
  const isLoose = (task: CandidateTask): boolean => task.parentTaskId === null || ungrouped.has(task.parentTaskId);

  // --- "Şunları tek iş olarak grupla": only ever on request, one level deep.
  //
  // Two shapes, and the model is not trusted to tell them apart:
  //   · a topic's concept page and Feynman page are ONE sitting — the learning
  //     card the weekly plan makes. They get a learning container, and one day.
  //   · anything else is a piece of work in parts; homework keeps its label.
  // A study step is never the whole of anything. "Konsepti Feynman'ın üstüne
  // koy" left a concept page that could no longer be ticked off by itself —
  // a container's status is its steps', not its own.
  const taskGroups: TaskGroupRow[] = [];
  const groupedChildIds = new Set<string>();
  /** Containers this report creates, and the steps whose final day they follow. */
  const containerDrafts: (Omit<NewTaskRow, 'due_date' | 'parent_task_id'> & { steps: string[] })[] = [];
  /** Learning pairs that must end up on one day. */
  const pairsToJoin: string[][] = [];
  const isDeadlineSource = (task: CandidateTask): boolean => task.source === 'homework' || task.source === 'ai_attachment';
  const isLearningPair = (members: readonly CandidateTask[]): boolean =>
    new Set(members.map((member) => member.topicId)).size === 1 &&
    members.every((member) => member.type === 'concept_note' || member.type === 'feynman') &&
    members.some((member) => member.type === 'concept_note') &&
    members.some((member) => member.type === 'feynman');
  const openContainer = (members: readonly CandidateTask[], title: string | null): string | null => {
    const first = members[0];
    if (!first) return null;
    const learning = isLearningPair(members);
    const topic = topicById.get(first.topicId);
    const name = title ?? (learning && topic ? `${topic.title} — öğrenme görevi` : null);
    if (name === null) return null;
    const id = crypto.randomUUID();
    containerDrafts.push({
      id,
      steps: members.map((member) => member.id),
      topic_id: first.topicId,
      type: learning ? 'learning' : first.type,
      title: name,
      instructions: learning ? LEARNING_INSTRUCTIONS : null,
      target_count: null,
      estimated_minutes: null,
      // Only work that has a deadline behind it is filed as homework.
      source: members.every(isDeadlineSource) ? 'homework' : 'manual',
      rescheduled_from_task_id: null,
    });
    for (const member of members) groupedChildIds.add(member.id);
    taskGroups.push({ parent_task_id: id, child_task_ids: members.map((member) => member.id) });
    if (learning) pairsToJoin.push(members.map((member) => member.id));
    return id;
  };

  for (const group of extraction.taskGroups.slice(0, MAX_GROUPS)) {
    const owner = group.parentTaskId === null ? undefined : taskById.get(group.parentTaskId);
    const ownerIsWhole = owner !== undefined && studyStepOf(owner.type) === null && owner.parentTaskId === null;
    const members = [...new Set([...group.childTaskIds, ...(owner && !ownerIsWhole ? [owner.id] : [])])]
      .map((id) => taskById.get(id))
      .filter((task): task is CandidateTask => task !== undefined)
      // A container cannot become a step, and a step stays in the card it is in.
      .filter((task) => !hasListedSteps.has(task.id) && isLoose(task) && !groupedChildIds.has(task.id))
      .filter((task) => !ownerIsWhole || task.id !== owner.id)
      .slice(0, MAX_GROUP_CHILDREN);

    if (ownerIsWhole) {
      if (members.length === 0) continue;
      for (const member of members) groupedChildIds.add(member.id);
      taskGroups.push({ parent_task_id: owner.id, child_task_ids: members.map((member) => member.id) });
      if (owner.type === 'learning') pairsToJoin.push([owner.id, ...members.map((member) => member.id)]);
      continue;
    }
    // Two is the smallest thing worth calling a group.
    if (members.length < 2) continue;
    openContainer(members, clamp(group.newParentTitle, 200));
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
    // "Vize 5 Aralığa ertelendi" is a date, and counting sixty-odd days to it
    // is the model's weakest arithmetic — so the date it copied wins.
    const examDate =
      validDate(change.exactDate, addDays(logDate, -MAX_DAYS_AGO), addDays(logDate, MAX_EXAM_DAYS_AHEAD)) ??
      (change.dateInDays === null || !Number.isFinite(change.dateInDays)
        ? null
        : addDays(logDate, Math.min(MAX_EXAM_DAYS_AHEAD, Math.max(-MAX_DAYS_AGO, Math.round(change.dateInDays)))));

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

  // --- What an exam covers: "vize 1 ilk beş haftayı kapsıyor". Weeks become
  // that course's topics here, from the list the student sees; a result or a
  // plan in the same report already reads the new list.
  const examScopes: ExamScopeRow[] = [];
  const scopedTopicIds: Record<string, readonly string[]> = { ...examTopicIds };
  for (const scope of extraction.examScopes.slice(0, MAX_SCOPES)) {
    const exam = examById.get(scope.examId);
    if (!exam) {
      droppedReferences++;
      continue;
    }
    if (examScopes.some((row) => row.exam_id === exam.id)) continue;
    const from = scope.fromWeek !== null && Number.isFinite(scope.fromWeek) ? scope.fromWeek : null;
    const until = scope.untilWeek !== null && Number.isFinite(scope.untilWeek) ? scope.untilWeek : null;
    const byWeek =
      from === null && until === null
        ? []
        : topics.filter(
            (topic) =>
              topic.courseId === exam.courseId &&
              topic.weekNumber !== null &&
              topic.weekNumber >= (from ?? 1) &&
              topic.weekNumber <= (until ?? Number.MAX_SAFE_INTEGER),
          );
    const named = scope.topicIds.filter((id) => topicById.has(id));
    const topicIds = [...new Set([...byWeek.map((topic) => topic.id), ...named])];
    if (topicIds.length === 0) {
      notes.push(`${exam.title} için söylenen haftalarda konu bulamadım; sınavın konuları değişmedi.`);
      continue;
    }
    examScopes.push({ exam_id: exam.id, topic_ids: topicIds, replace: scope.replace });
    scopedTopicIds[exam.id] = scope.replace
      ? topicIds
      : [...new Set([...(examTopicIds[exam.id] ?? []), ...topicIds])];
  }

  // --- How an exam went: "vizeden 65 aldım", "kötü geçti, Gauss'ta zorlandım".
  //
  // The same thing the exam screen's "Sınav nasıl geçti?" does, said instead
  // of tapped: every topic the exam covered is reviewed at the exam's quality,
  // a topic named as the hard part fails whatever the rest did, and what is
  // left of the sprint is no longer work. All of it through the paths the undo
  // already knows: topic reviews are snapshotted, removals are snapshotted.
  const examResults: ExamResultRow[] = [];
  for (const result of extraction.examResults.slice(0, MAX_EXAM_CHANGES)) {
    const exam = examById.get(result.examId);
    if (!exam) {
      droppedReferences++;
      continue;
    }
    if (examResults.some((row) => row.exam_id === exam.id)) continue;
    if (exam.examDate > logDate) {
      notes.push(`${exam.title} henüz yapılmadı; sonucunu sınavdan sonra yazabilirsin.`);
      continue;
    }

    const max = result.maxScore !== null && Number.isFinite(result.maxScore) && result.maxScore > 0 ? result.maxScore : 100;
    const percent =
      result.score === null || !Number.isFinite(result.score)
        ? null
        : Math.min(100, Math.max(0, (result.score / max) * 100));
    const outcome =
      percent !== null
        ? outcomeForScore(percent)
        : result.outcome !== null && Number.isFinite(result.outcome)
          ? (Math.min(5, Math.max(1, Math.round(result.outcome))) as 1 | 2 | 3 | 4 | 5)
          : null;
    if (outcome === null) continue;

    const hard = new Set(result.hardTopicIds.filter((id) => topicById.has(id)));
    for (const topicId of new Set([...(scopedTopicIds[exam.id] ?? []), ...hard])) {
      if (!topicById.has(topicId)) continue;
      recordQuality(topicId, hard.has(topicId) ? HARD_TOPIC_QUALITY : outcome, logDate);
    }
    for (const task of tasks) {
      if (task.originExamId === exam.id && task.source === 'exam_cram' && MOVABLE_STATUSES.has(task.status)) {
        requestRemoval(task.id, 'Sınav geçti');
      }
    }
    examResults.push({
      exam_id: exam.id,
      outcome,
      note: result.score === null || !Number.isFinite(result.score) ? null : `${result.score}/${max}`,
    });
  }

  // --- "Vize için plan çıkar": the sprint the exam screen would have built,
  // with the same rules — only in the last week, weakest topic first. Old
  // sprint tasks nobody has started make way for the new ones.
  const cramRows: NewTaskRow[] = [];
  const examLinks: ExamLinkRow[] = [];
  const examPlans: ScheduleFacts['examPlans'] = [];
  for (const request of extraction.examPlans.slice(0, MAX_EXAM_PLANS)) {
    const exam = examById.get(request.examId);
    if (!exam) {
      droppedReferences++;
      continue;
    }
    if (examPlans.some((plan) => plan.examId === exam.id)) continue;
    const daysLeft = diffInDays(logDate, exam.examDate);
    if (daysLeft < 0) {
      notes.push(`${exam.title} geçti; plan çıkarılmadı.`);
      continue;
    }
    if (daysLeft > CRAM_WINDOW_DAYS) {
      notes.push(
        `${exam.title} için ${daysLeft} gün var; sınav planı son ${CRAM_WINDOW_DAYS} güne kurulur. O zamana kadar haftalık plan işini görür.`,
      );
      continue;
    }
    const context = cramContexts.find((candidate) => candidate.examId === exam.id);
    if (!context) continue;

    const cram = buildCramPlan({ today: logDate, examDate: exam.examDate, topics: context.topics, capacityByWeekday });
    notes.push(...cram.notes);
    for (const task of tasks) {
      if (task.originExamId !== exam.id || task.source !== 'exam_cram') continue;
      if (task.status === 'pending' && task.completedCount === 0) requestRemoval(task.id, 'Sınav planı yenilendi');
    }
    let added = 0;
    for (const item of cram.days.flatMap((day) => day.items)) {
      if (cramRows.length >= MAX_CRAM_TASKS || !topicById.has(item.topicId)) continue;
      const id = crypto.randomUUID();
      cramRows.push({
        id,
        parent_task_id: null,
        topic_id: item.topicId,
        type: item.type,
        title: item.title,
        instructions: item.instructions,
        target_count: item.step === 'quiz' ? 10 : null,
        estimated_minutes: item.estimatedMinutes,
        due_date: item.dueDate,
        source: 'exam_cram',
        rescheduled_from_task_id: null,
      });
      examLinks.push({ task_id: id, exam_id: exam.id });
      added++;
    }
    examPlans.push({ examId: exam.id, tasks: added, days: cram.days.length });
  }

  // --- "Fizik ödevi acil" — and "artık acil değil". Urgency belongs to the
  // card the student sees, not to one of its steps.
  const urgentByLeader = new Map<string, boolean>();
  const priorities: PriorityRow[] = [];
  for (const request of extraction.priorities.slice(0, MAX_PRIORITIES)) {
    const task = taskById.get(request.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    const leader = taskById.get(leaderOf(task)) ?? task;
    if (urgentByLeader.has(leader.id)) continue;
    urgentByLeader.set(leader.id, request.urgent);
    if (leader.isPriority !== request.urgent) priorities.push({ task_id: leader.id, is_priority: request.urgent });
  }
  /** Urgent work keeps its day when a day has to shed some. */
  const isUrgent = (task: CandidateTask): boolean =>
    urgentByLeader.get(leaderOf(task)) ?? taskById.get(leaderOf(task))?.isPriority ?? task.isPriority;

  // --- "Yarın 9'da hatırlat". The phone schedules it; the server only makes
  // sure the day and the hour are real ones.
  const reminders: CheckinReminder[] = [];
  for (const request of extraction.reminders.slice(0, MAX_REMINDERS)) {
    const text = clamp(request.text, 120);
    if (text === null || !Number.isFinite(request.daysAhead)) continue;
    const clock = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(request.time?.trim() ?? '');
    reminders.push({
      date: addDays(logDate, Math.min(MAX_REMINDER_DAYS_AHEAD, Math.max(0, Math.round(request.daysAhead)))),
      time: clock ? `${clock[1]!.padStart(2, '0')}:${clock[2]}` : DEFAULT_REMINDER_TIME,
      text,
    });
  }

  // --- Tasks the student asks to drop outright.
  for (const removal of extraction.taskRemovals.slice(0, MAX_REMOVALS)) {
    requestRemoval(removal.taskId, clamp(removal.reason, 200));
  }

  // "Geciken işleri kapat": everything open and overdue, as whole cards. The
  // SQL keeps its usual rule — untouched work is deleted with a snapshot,
  // anything with progress, notes or time on it is only set aside.
  const backlog: ScheduleFacts['backlog'] = [];
  const isOverdue = (task: CandidateTask): boolean => MOVABLE_STATUSES.has(task.status) && task.dueDate < logDate;
  const backlogActions = new Set(extraction.backlogActions.map((request) => request.action));
  if (backlogActions.has('close')) {
    const leaders = new Set(tasks.filter((task) => isOverdue(task) && !handledTaskIds.has(task.id)).map(leaderOf));
    for (const leader of leaders) requestRemoval(leader, 'Geciken iş kapatıldı');
    backlog.push({ action: 'close', tasks: leaders.size });
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
  const clampAhead = (days: number): number => Math.min(CLEAR_WINDOW_DAYS, Math.max(0, Math.round(days)));
  /** "Cumadan pazartesiye kadar": every day of a stretch; a missing or backwards end means one day. */
  const stretch = (fromDays: number, untilDays: number | null): IsoDate[] => {
    const first = clampAhead(fromDays);
    const last = untilDays === null || !Number.isFinite(untilDays) ? first : Math.max(first, clampAhead(untilDays));
    return Array.from({ length: last - first + 1 }, (_, index) => addDays(logDate, first + index));
  };

  const closedWeekdays = new Set<number>(blockedWeekdays);
  const newlyClosedWeekdays = new Set<number>();
  const clearedDates = new Set<IsoDate>();
  /** null = they did not say, and the day the report covers is as early as it gets. */
  let statedSpreadFrom: number | null = null;

  for (const clearance of extraction.dayClearances.slice(0, MAX_CLEARANCES)) {
    if (!Number.isFinite(clearance.daysAhead)) continue;
    for (const date of stretch(clearance.daysAhead, clearance.untilDaysAhead)) {
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
    }

    if (clearance.spreadFromDaysAhead !== null && Number.isFinite(clearance.spreadFromDaysAhead)) {
      const from = clampAhead(clearance.spreadFromDaysAhead);
      statedSpreadFrom = statedSpreadFrom === null ? from : Math.min(statedSpreadFrom, from);
    }
  }

  // "Pazarları artık çalışabiliyorum" lifts the standing rule — for the spread
  // below as much as for next week's plan. A report that closes and reopens the
  // same weekday contradicts itself, and the stricter reading wins.
  const reopenedWeekdays = new Set<number>();
  for (const reopen of extraction.reopenedWeekdays.slice(0, 7)) {
    if (!Number.isFinite(reopen.daysAhead)) continue;
    const weekday = isoWeekday(addDays(logDate, clampAhead(reopen.daysAhead)));
    if (newlyClosedWeekdays.has(weekday) || reopenedWeekdays.has(weekday)) continue;
    if (!blockedWeekdays.includes(weekday)) {
      notes.push(`${weekdayName(weekday)} zaten kapalı bir gün değildi.`);
      continue;
    }
    reopenedWeekdays.add(weekday);
    closedWeekdays.delete(weekday);
  }

  // "Yarın sadece 1 saatim var": that day's own limit, in place of what it
  // usually holds. "Hafif olsun" names no number, and the model may not invent
  // one — the share below is the app's, applied the same way every time.
  const budgetByDate = new Map<IsoDate, number>();
  for (const load of extraction.dayLoads.slice(0, MAX_DAY_LOADS)) {
    if (!Number.isFinite(load.daysAhead)) continue;
    for (const date of stretch(load.daysAhead, load.untilDaysAhead)) {
      const usual = capacityByWeekday?.[isoWeekday(date)] ?? DEFAULT_DAILY_CAPACITY;
      budgetByDate.set(
        date,
        load.minutes !== null && Number.isFinite(load.minutes)
          ? Math.min(600, Math.max(0, Math.round(load.minutes)))
          : Math.max(MIN_LIGHT_DAY_MINUTES, Math.round((usual * LIGHT_DAY_SHARE) / 5) * 5),
      );
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
  const dayOfTask = (task: CandidateTask): IsoDate => moveByTaskId.get(task.id) ?? task.dueDate;
  /** Homework has a real deadline behind it; a generated study step does not. */
  const hasDeadline = (task: CandidateTask): boolean => task.source === 'homework' || task.source === 'ai_attachment';
  const capacityOn = (date: IsoDate): number =>
    budgetByDate.get(date) ?? capacityByWeekday?.[isoWeekday(date)] ?? DEFAULT_DAILY_CAPACITY;
  /** Days nothing may be moved onto: emptied, closed for good, or given up as missed. */
  const offLimits = (date: IsoDate): boolean =>
    clearedDates.has(date) || missedDates.has(date) || closedWeekdays.has(isoWeekday(date));

  const knownCourses = new Set([...courses.map((course) => course.id), ...topics.map((topic) => topic.courseId)]);

  // A single task the student named: their day wins, no arithmetic needed.
  //
  // It moves as the card it is. A container takes its steps along — "fizik
  // ödevini cumaya al" leaving the parts on their old days would be half a
  // move — and a step of a learning card takes the whole card, because the
  // concept page and the Feynman page are one sitting. A part of homework may
  // move on its own: "grafiği cumaya al" is exactly that.
  const explicitMoves = new Set<string>();
  const moveTo = (task: CandidateTask, date: IsoDate): void => {
    explicitMoves.add(task.id);
    if (date !== task.dueDate) moveByTaskId.set(task.id, date);
    else moveByTaskId.delete(task.id);
  };
  for (const move of extraction.taskReschedules.slice(0, MAX_MOVES)) {
    const task = taskById.get(move.taskId);
    if (!task) {
      droppedReferences++;
      continue;
    }
    if (!canMove(task) || !Number.isFinite(move.dueInDays)) continue;
    const date = addDays(logDate, Math.min(MAX_DAYS_AHEAD, Math.max(0, Math.round(move.dueInDays))));
    const leader = taskById.get(leaderOf(task)) ?? task;
    const wholeCard = hasListedSteps.has(task.id) || leader.type === 'learning';
    const riders = wholeCard ? (cardMembers.get(leader.id) ?? [task]).filter(canMove) : [task];
    for (const rider of riders) moveTo(rider, date);
  }


  /** The part of a card that can still go elsewhere: not done, not removed, not placed by the student. */
  const movingPart = (leader: string): CandidateTask[] =>
    (cardMembers.get(leader) ?? []).filter((member) => canMove(member) && !explicitMoves.has(member.id));
  /** A card costs what its steps cost; a container with listed steps adds nothing of its own. */
  const minutesOf = (members: readonly CandidateTask[]): number => {
    const own = members
      .filter((member) => !hasListedSteps.has(member.id))
      .reduce((sum, member) => sum + (member.estimatedMinutes ?? ASSUMED_TASK_MINUTES), 0);
    return own > 0 ? own : ASSUMED_TASK_MINUTES;
  };
  const lateTitles = new Set<string>();

  /**
   * Puts whole cards onto the given days through the spread a cleared day has
   * always used: deadlines first, the first day with room, and — when no day
   * has any — the emptiest one, because the day they came off is not an option.
   *
   * Cards, not rows: a learning task's two steps placed one by one could land
   * on different days, and the one sitting they stand for would be split.
   */
  const moveCards = (leaders: Iterable<string>, days: readonly IsoDate[]): void => {
    const cards = [...new Set(leaders)]
      .slice(0, MAX_MOVES)
      .map((leader) => ({ leader, members: movingPart(leader) }))
      .filter((card) => card.members.length > 0);
    if (cards.length === 0) return;
    if (days.length === 0) {
      notes.push('Taşınacak boş gün kalmadı; bazı görevler yerinde kaldı.');
      return;
    }

    const moving = new Set(cards.flatMap((card) => card.members.map((member) => member.id)));
    // What each day already owes, so the spread does not pile work onto a day
    // that is full of its own.
    const committed = new Map<IsoDate, number>();
    for (const task of tasks) {
      if (!canMove(task) || moving.has(task.id) || hasListedSteps.has(task.id)) continue;
      const day = dayOfTask(task);
      committed.set(day, (committed.get(day) ?? 0) + (task.estimatedMinutes ?? ASSUMED_TASK_MINUTES));
    }

    const budgets: DayBudget[] = days.map((date) => ({
      date,
      capacityMinutes: capacityOn(date),
      committedMinutes: committed.get(date) ?? 0,
    }));
    const cleared: ClearedTask[] = cards.map(({ leader, members }) => {
      const deadlines = members.filter(hasDeadline).map((member) => member.dueDate).sort();
      return {
        id: leader,
        // A deadline is where the work was due, wherever it sits today.
        dueDate: deadlines[0] ?? dayOfTask(members[0]!),
        estimatedMinutes: minutesOf(members),
        hasDeadline: deadlines.length > 0,
      };
    });

    const spread = planDayClearance({ days: budgets, tasks: cleared });
    for (const placement of spread.placements) {
      for (const member of movingPart(placement.taskId)) moveByTaskId.set(member.id, placement.date);
    }
    for (const leader of spread.lateTaskIds) {
      const title = taskById.get(leader)?.title;
      if (title) lateTitles.add(title);
    }
  };

  // A learning pair grouped in this report is one sitting, so one day: the
  // day the student gave, else the earlier of the two — pulling work forward
  // beats pushing it back — but never a day already behind them when one of
  // the pair is still ahead.
  for (const pair of pairsToJoin) {
    const members = pair.map((id) => taskById.get(id)).filter((task): task is CandidateTask => task !== undefined);
    const movable = members.filter(canMove);
    if (movable.length < 2) continue;
    const stated = movable.filter((member) => explicitMoves.has(member.id)).map(dayOfTask).sort()[0];
    const days = movable.map(dayOfTask).sort();
    const earliest = days[0]!;
    const day = stated ?? (earliest < logDate && days.some((d) => d >= logDate) ? logDate : earliest);
    for (const member of movable) moveTo(member, day);
  }

  // "Salı ile perşembenin görevlerini değiştir": whole cards trade days. Work
  // due on the earlier day cannot go to the later one past its deadline, so
  // it stays and is named.
  const swaps: ScheduleFacts['swaps'] = [];
  for (const swap of extraction.daySwaps.slice(0, MAX_SWAPS)) {
    if (!Number.isFinite(swap.firstDaysAhead) || !Number.isFinite(swap.secondDaysAhead)) continue;
    const first = addDays(logDate, clampAhead(swap.firstDaysAhead));
    const second = addDays(logDate, clampAhead(swap.secondDaysAhead));
    if (first === second) continue;
    const leadersOn = (date: IsoDate): string[] => [
      ...new Set(
        tasks
          .filter((task) => canMove(task) && !explicitMoves.has(task.id) && dayOfTask(task) === date)
          .map(leaderOf),
      ),
    ];
    const plan = [
      ...leadersOn(first).map((leader) => ({ leader, to: second })),
      ...leadersOn(second).map((leader) => ({ leader, to: first })),
    ];
    for (const { leader, to } of plan) {
      const members = movingPart(leader);
      if (members.some((member) => isDeadlineSource(member) && member.dueDate < to)) {
        notes.push(`"${taskById.get(leader)?.title}" teslimi ${relativeDay(to, logDate)} günden önce olduğu için yerinde kaldı.`);
        continue;
      }
      for (const member of members) moveTo(member, to);
    }
    swaps.push({ first, second });
  }

  // "Konu sırasına göre diz, günlerdeki görev sayısı aynı kalsın": the days
  // keep their number of cards and only the cards trade places — the earliest
  // topic week takes the earliest slot, and within a topic the loop's order
  // holds. Deadlines and urgent work keep their days; the repair below then
  // keeps every quiz from coming before its own Feynman page.
  const syllabusOrders: ScheduleFacts['syllabusOrders'] = [];
  const orderedDates = new Set<IsoDate>();
  for (const order of extraction.syllabusOrders.slice(0, MAX_STRETCH_OPS)) {
    if (!Number.isFinite(order.fromDaysAhead)) continue;
    const window = stretch(order.fromDaysAhead, order.untilDaysAhead ?? order.fromDaysAhead + DEFAULT_STRETCH_DAYS);
    const from = window[0]!;
    const until = window.at(-1)!;
    const onlyCourses = new Set(order.courseIds.filter((id) => knownCourses.has(id)));
    const leaders = [
      ...new Set(
        tasks
          .filter((task) => {
            const day = dayOfTask(task);
            if (!canMove(task) || explicitMoves.has(task.id) || isUrgent(task) || day < from || day > until) return false;
            const course = courseOf(task);
            return onlyCourses.size === 0 || (course !== null && onlyCourses.has(course));
          })
          .map(leaderOf),
      ),
    ].filter((leader) => {
      const members = movingPart(leader);
      return members.length > 0 && !members.some(isDeadlineSource);
    });

    const slots = leaders.map((leader) => dayOfTask(taskById.get(leader)!)).sort();
    // Syllabus order, then the loop's own order within a topic — never the
    // alphabet. Cards that rank the same share a run of slots, and within it a
    // card keeps the day it already has whenever that day is in the run: the
    // fewest moves that honour the order.
    const topicOf = (leader: string) => topicById.get(taskById.get(leader)!.topicId);
    const stepOf = (leader: string) =>
      Math.min(...(cardMembers.get(leader) ?? [taskById.get(leader)!]).map((m) => KEEP_RANK[m.type] ?? DEFAULT_KEEP_RANK));
    const compare = (a: string, b: string): number => {
      const topicA = topicOf(a);
      const topicB = topicOf(b);
      const bySyllabus =
        topicA && topicB ? bySyllabusOrder(topicA, topicB) : Number(topicA === undefined) - Number(topicB === undefined);
      return bySyllabus || stepOf(a) - stepOf(b);
    };
    const currentDay = (leader: string) => dayOfTask(taskById.get(leader)!);
    const ordered = [...leaders].sort((a, b) => compare(a, b) || currentDay(a).localeCompare(currentDay(b)));

    const target = new Map<string, IsoDate>();
    for (let start = 0; start < ordered.length; ) {
      let end = start + 1;
      while (end < ordered.length && compare(ordered[start]!, ordered[end]!) === 0) end++;
      const run = ordered.slice(start, end);
      const free = slots.slice(start, end);
      const waiting: string[] = [];
      for (const leader of run) {
        const keep = free.indexOf(currentDay(leader));
        if (keep >= 0) {
          target.set(leader, currentDay(leader));
          free.splice(keep, 1);
        } else {
          waiting.push(leader);
        }
      }
      waiting.forEach((leader, index) => target.set(leader, free[index]!));
      start = end;
    }

    let moved = 0;
    for (const leader of ordered) {
      const to = target.get(leader)!;
      if (currentDay(leader) === to) continue;
      moved++;
      for (const member of movingPart(leader)) {
        if (to !== member.dueDate) moveByTaskId.set(member.id, to);
        else moveByTaskId.delete(member.id);
      }
    }
    for (const date of window) orderedDates.add(date);
    syllabusOrders.push({ from, until, moved });
  }

  // Work off an emptied day, and off a day they say they never got to at all
  // ("bugün hiç çalışamadım"): kept, and spread over the days that can take it.
  const leaving = new Set<string>();
  for (const task of tasks) {
    if (!canMove(task) || explicitMoves.has(task.id)) continue;
    if (clearedDates.has(task.dueDate) || missedTaskIds.has(task.id)) leaving.add(leaderOf(task));
  }
  if (leaving.size > 0) {
    const days: IsoDate[] = [];
    for (let ahead = 0; ahead <= CLEAR_WINDOW_DAYS; ahead++) {
      const date = addDays(logDate, (statedSpreadFrom ?? 0) + ahead);
      if (!offLimits(date)) days.push(date);
    }
    moveCards(leaving, days);
  }

  // --- Whole courses set aside for a stretch.
  //
  // "Bu hafta kimyayı dondur" and "yarın sadece fiziğe çalışacağım" are one
  // instruction seen from two sides: some courses' work leaves some days. It
  // goes to the days right after the stretch, where it would have come next
  // anyway. Work due inside the stretch stays — pausing a course does not
  // pause the teacher who set the deadline.
  const holds: ScheduleFacts['holds'] = [];
  for (const hold of extraction.courseHolds.slice(0, MAX_HOLDS)) {
    if (!Number.isFinite(hold.fromDaysAhead)) continue;
    const listed = new Set(hold.courseIds.filter((id) => knownCourses.has(id)));
    if (listed.size === 0) {
      droppedReferences++;
      continue;
    }
    const window = stretch(hold.fromDaysAhead, hold.untilDaysAhead);
    const from = window[0]!;
    const until = window.at(-1)!;
    const covers = (task: CandidateTask): boolean => {
      const course = courseOf(task);
      const named = course !== null && listed.has(course);
      return hold.mode === 'pause' ? named : !named;
    };
    holds.push({ mode: hold.mode, courseIds: [...listed], from, until });

    const leaders = new Set<string>();
    for (const task of tasks) {
      const day = dayOfTask(task);
      if (!canMove(task) || explicitMoves.has(task.id) || day < from || day > until || !covers(task)) continue;
      leaders.add(leaderOf(task));
    }
    for (const leader of [...leaders]) {
      const members = movingPart(leader);
      if (members.some((member) => hasDeadline(member) && member.dueDate <= until)) {
        leaders.delete(leader);
        notes.push(`"${taskById.get(leader)?.title}" teslimi bu aralıkta olduğu için yerinde kaldı.`);
      } else if (members.some(isUrgent)) {
        leaders.delete(leader);
        notes.push(`"${taskById.get(leader)?.title}" acil işaretli olduğu için yerinde kaldı.`);
      }
    }

    const after: IsoDate[] = [];
    const lastOffset = diffInDays(logDate, until);
    for (let ahead = lastOffset + 1; ahead <= lastOffset + CLEAR_WINDOW_DAYS; ahead++) {
      const date = addDays(logDate, ahead);
      if (!offLimits(date)) after.push(date);
    }
    moveCards(leaders, after);
  }
  /** A set-aside course's work must not drift back into its stretch in the repair below. */
  const heldBack = (task: CandidateTask): boolean =>
    holds.some((hold) => {
      if (dayOfTask(task) > hold.until) return false;
      const course = courseOf(task);
      const named = course !== null && hold.courseIds.includes(course);
      return hold.mode === 'pause' ? named : !named;
    });

  // --- A day with a time limit keeps what fits, earliest in the cycle first.
  //
  // What leaves is what costs least to move — a quiz before the page it tests —
  // and never work due that very day or a day the student chose themselves.
  for (const [date, budget] of [...budgetByDate].sort(([a], [b]) => a.localeCompare(b))) {
    if (offLimits(date)) continue;
    const onDay = new Map<string, CandidateTask[]>();
    for (const task of tasks) {
      if (!canMove(task) || dayOfTask(task) !== date) continue;
      onDay.set(leaderOf(task), [...(onDay.get(leaderOf(task)) ?? []), task]);
    }
    const cards = [...onDay.entries()].map(([leader, members]) => ({
      leader,
      minutes: minutesOf(members),
      fixed: members.some(
        (member) => explicitMoves.has(member.id) || isUrgent(member) || (hasDeadline(member) && member.dueDate <= date),
      ),
      rank: Math.min(...members.map((member) => KEEP_RANK[member.type] ?? DEFAULT_KEEP_RANK)),
    }));
    cards.sort(
      (a, b) =>
        Number(b.fixed) - Number(a.fixed) || a.rank - b.rank || a.minutes - b.minutes || a.leader.localeCompare(b.leader),
    );

    let used = 0;
    const overflow: string[] = [];
    for (const card of cards) {
      if (card.fixed || used + card.minutes <= budget) used += card.minutes;
      else overflow.push(card.leader);
    }
    if (cards.some((card) => card.fixed) && used > budget) {
      notes.push(`${relativeDay(date, logDate)} için söylediğin süre, o gün teslimi olan işe yetmiyor.`);
    }

    const later: IsoDate[] = [];
    for (let ahead = diffInDays(logDate, date) + 1; ahead <= CLEAR_WINDOW_DAYS; ahead++) {
      const day = addDays(logDate, ahead);
      if (!offLimits(day)) later.push(day);
    }
    moveCards(overflow, later);
  }

  // --- "Geciken işleri dağıt": overdue cards into the coming week, the same
  // way an emptied day's work is spread — deadlines first, room first.
  if (backlogActions.has('spread') && !backlogActions.has('close')) {
    const leaders = new Set(
      tasks.filter((task) => canMove(task) && !explicitMoves.has(task.id) && dayOfTask(task) < logDate).map(leaderOf),
    );
    const days: IsoDate[] = [];
    for (let ahead = 0; ahead <= DEFAULT_STRETCH_DAYS; ahead++) {
      const date = addDays(logDate, ahead);
      if (!offLimits(date)) days.push(date);
    }
    moveCards(leaders, days);
    backlog.push({ action: 'spread', tasks: leaders.size });
  }

  // "Haftayı düzenle": the repair below, over a whole stretch rather than only
  // what this report touched — and loose concept/Feynman pairs that end up on
  // one day become one learning card.
  const tidies: ScheduleFacts['tidies'] = [];
  const tidyDates = new Set<IsoDate>();
  for (const tidy of extraction.weekTidies.slice(0, MAX_STRETCH_OPS)) {
    if (!Number.isFinite(tidy.fromDaysAhead)) continue;
    const window = stretch(tidy.fromDaysAhead, tidy.untilDaysAhead ?? tidy.fromDaysAhead + DEFAULT_STRETCH_DAYS);
    for (const date of window) tidyDates.add(date);
    tidies.push({ from: window[0]!, until: window.at(-1)!, paired: 0 });
  }

  // --- How much a day should carry, and the order the cycle has to keep.
  //
  // Clearing a day is a move, and a move that ignores the study cycle is how a
  // quiz ends up on the same day as the Feynman page it is meant to test. So
  // every move this check-in makes — the student's own, the clearance spread,
  // and any day they gave a size to — goes through one repair pass before it
  // is written down.
  const targetByDate = new Map<IsoDate, number>();
  for (const target of extraction.dayTargets.slice(0, MAX_DAY_TARGETS)) {
    if (!Number.isFinite(target.daysAhead) || !Number.isFinite(target.maxMainTasks)) continue;
    const date = addDays(logDate, clampAhead(target.daysAhead));
    targetByDate.set(date, Math.min(MAX_MAIN_TASKS_PER_DAY, Math.max(0, Math.round(target.maxMainTasks))));
  }

  if (
    clearedDates.size > 0 ||
    targetByDate.size > 0 ||
    moveByTaskId.size > 0 ||
    budgetByDate.size > 0 ||
    tidyDates.size > 0
  ) {
    const shapeDays: ShapeDay[] = [];
    for (let ahead = 0; ahead <= CLEAR_WINDOW_DAYS; ahead++) {
      const date = addDays(logDate, ahead);
      if (offLimits(date)) continue;
      shapeDays.push({ date, capacityMinutes: capacityOn(date), maxMainTasks: targetByDate.get(date) ?? null });
    }

    // The repair stays inside what this report actually touched. A topic whose
    // order was already crooked yesterday is not this check-in's business —
    // that is what the week tidier is for, and it asks first.
    const affectedTopics = new Set<string>();
    const affectedDates = new Set<IsoDate>([
      ...clearedDates,
      ...targetByDate.keys(),
      ...budgetByDate.keys(),
      ...orderedDates,
      ...tidyDates,
    ]);
    for (const [taskId, date] of moveByTaskId) {
      affectedDates.add(date);
      const task = taskById.get(taskId);
      if (task) affectedTopics.add(task.topicId);
    }
    for (const task of tasks) {
      if (clearedDates.has(task.dueDate)) affectedTopics.add(task.topicId);
    }

    const shapeTasks: ShapeTask[] = tasks.map((task) => ({
      id: task.id,
      topicId: task.topicId,
      step: studyStepOf(task.type),
      // The clearance spread has already had its say; the repair starts there.
      dueDate: dayOfTask(task),
      // A container's time is its steps' time; counting it again made a
      // one-hour learning card weigh ninety minutes.
      estimatedMinutes: hasListedSteps.has(task.id) ? 0 : (task.estimatedMinutes ?? ASSUMED_TASK_MINUTES),
      parentId: task.parentTaskId,
      hasDeadline: hasDeadline(task),
      // Work already sitting on its own deadline has nowhere left to go: later
      // is past it, and the repair never pulls work earlier.
      isMovable:
        canMove(task) &&
        !heldBack(task) &&
        !isUrgent(task) &&
        !(hasDeadline(task) && dayOfTask(task) >= task.dueDate) &&
        (affectedTopics.has(task.topicId) || affectedDates.has(dayOfTask(task))),
    }));

    const shaped = planWeekShape({
      today: logDate,
      days: shapeDays,
      tasks: shapeTasks,
      groupExistingPairs: tidyDates.size > 0,
    });
    for (const move of shaped.moves) moveByTaskId.set(move.taskId, move.to);
    notes.push(...shaped.notes);

    // Pairs the repair left on one day, inside a stretch the student asked to
    // tidy: one sitting, so one learning card — made the same way a grouping
    // in the report makes one, and undone the same way.
    for (const pairing of shaped.pairings) {
      if (!tidyDates.has(pairing.date)) continue;
      const pair = [pairing.conceptTaskId, pairing.feynmanTaskId].map((id) => taskById.get(id));
      if (pair.some((task) => !task || groupedChildIds.has(task.id) || !isLoose(task))) continue;
      if (openContainer(pair as CandidateTask[], null) === null) continue;
      const tidy = tidies.find((entry) => entry.from <= pairing.date && pairing.date <= entry.until);
      if (tidy) tidy.paired++;
    }
  }

  // A learning card is one sitting: its container stands on the day its
  // steps are, whichever of the moves above put them there.
  for (const container of tasks) {
    if (container.type !== 'learning' || !hasListedSteps.has(container.id) || ungrouped.has(container.id)) continue;
    if (!canMove(container)) continue;
    const stepDays = (cardMembers.get(container.id) ?? [])
      .filter((member) => member.id !== container.id && canMove(member))
      .map(dayOfTask)
      .sort();
    const day = stepDays[0];
    if (day === undefined || day === dayOfTask(container)) continue;
    if (day !== container.dueDate) moveByTaskId.set(container.id, day);
    else moveByTaskId.delete(container.id);
  }
  for (const title of lateTitles) notes.push(`"${title}" teslim tarihinden önce yer bulamadı; teslimden sonraya kondu.`);

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
  const newTasks: NewTaskRow[] = [
    ...drafts.slice(0, MAX_NEW_TASKS).map(({ fixed_due_date, follows_parent, id, parent_task_id, ...draft }) => {
      const taskId = id ?? crypto.randomUUID();
      const due =
        (follows_parent ? dueByDraftId.get(follows_parent) : undefined) ??
        fixed_due_date ??
        addDays(logDate, 1 + Math.floor(spread++ / MAX_NEW_TASKS_PER_DAY));
      dueByDraftId.set(taskId, due);
      return { ...draft, id: taskId, parent_task_id: parent_task_id ?? null, due_date: due };
    }),
    // A sprint has its own days and its own cap: it is not rescheduled work.
    ...cramRows,
    // A group's container stands where its steps end up — after every move
    // above, not where they were when the report began. It was computed from
    // the old days once, and a card was left on Monday with its steps on
    // Tuesday.
    ...containerDrafts.map(({ steps, ...draft }): NewTaskRow => {
      const days = steps
        .map((id) => taskById.get(id))
        .filter((task): task is CandidateTask => task !== undefined)
        .map(dayOfTask)
        .sort();
      return { ...draft, parent_task_id: null, due_date: days.at(-1) ?? logDate };
    }),
  ];

  // --- Questions: which one, and for an agenda which day. The answer is not
  // written here — it has to read the plan as it stands once all of the above
  // has been applied.
  const questions: PlanQuestion[] = [];
  for (const request of extraction.infoRequests.slice(0, MAX_QUESTIONS)) {
    // "Neler var?" asked in an evening report is about the next day.
    const offset = request.daysAhead !== null && Number.isFinite(request.daysAhead) ? request.daysAhead : 1;
    const date = request.kind === 'day_agenda' ? addDays(logDate, clampAhead(offset)) : null;
    if (questions.some((question) => question.kind === request.kind && question.date === date)) continue;
    questions.push({ kind: request.kind, date });
  }

  const bulkIds = new Set(bulkCompleted.map((outcome) => outcome.taskId));
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
    reopenWeekdays: [...reopenedWeekdays].sort((a, b) => a - b),
    clearedDates: [...clearedDates].sort(),
    extraWork,
    taskUngroups,
    examScopes,
    examResults,
    priorities,
    examLinks,
    reminders,
    schedule: {
      missedDates: [...missedDates].sort(),
      dayBudgets: [...budgetByDate]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, minutes]) => ({ date, minutes })),
      holds,
      bulkCompletedTaskIds: taskUpdates
        .filter((update) => bulkIds.has(update.task_id) && update.new_status === 'completed')
        .map((update) => update.task_id),
      examPlans,
      swaps,
      syllabusOrders,
      tidies,
      backlog,
    },
    questions,
    notes: [...new Set(notes)],
    unmatchedMentions: extraction.unmatchedMentions
      .slice(0, MAX_MENTIONS)
      .map((m) => clamp(m, 200))
      .filter((m): m is string => m !== null),
    droppedReferences,
  };
}
