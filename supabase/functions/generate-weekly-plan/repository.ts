import { z } from 'zod';
import type { IsoDate, TaskType } from '../_shared/contracts/enums.contract.ts';
import type { Json } from '../_shared/database.types.ts';
import { HttpError } from '../_shared/errors.ts';
import { addDays } from '../_shared/domain/dates.ts';
import type { TypedClient } from '../_shared/supabase.ts';
import type { StudyStep } from '../_shared/contracts/enums.contract.ts';
import { FIRST_CYCLE } from './study-cycle.ts';
import { resolveTermStarts } from '../_shared/domain/term.ts';
import {
  type CapacityProfile,
  localDateIn,
  LOOKBACK_WEEKS,
  parseCapacityOverrides,
  resolveCapacity,
} from '../_shared/domain/capacity.ts';
import type { ClassLoad, CourseClassDays, PlanCommitment, PlanExam, PlanSlot, PlanTopic } from './planner.ts';

const RECENT_FAILURE_DAYS = 21;
/** PostgREST returns at most this many rows per request; a term's tasks need several. */
const PAGE_SIZE = 1000;
const MAX_TASK_PAGES = 20;
/** A homework with no estimate still costs something. */
const DEFAULT_HOMEWORK_MINUTES = 45;
const MAX_TOPICS = 300;

const ApplyResultSchema = z.object({ deleted: z.number().int(), inserted: z.number().int() });

function dbError(operation: string, cause: unknown): HttpError {
  return new HttpError('internal', `Database error during ${operation}.`, { cause });
}

export interface PlanContext {
  topics: PlanTopic[];
  exams: PlanExam[];
  /** Minutes of class per ISO weekday, labs included: they still fill the day. */
  classLoad: ClassLoad;
  /** Teaching days per course, labs excluded: the planner puts work on these. */
  courseClassDays: CourseClassDays;
  /** Minutes the student tends to manage on each weekday, and where each number came from. */
  capacity: CapacityProfile;
  /** Homework with its own deadline, which the plan has to make room for. */
  commitments: PlanCommitment[];
  /** Monday of week 1 per course — its own, or the semester's shared one. */
  termStartByCourse: Record<string, IsoDate | null>;
}

const isStudyStep = (type: string): type is StudyStep => (FIRST_CYCLE as readonly string[]).includes(type);

const minutesBetween = (start: string, end: string): number => {
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':');
    return Number(hours) * 60 + Number(minutes);
  };
  return Math.max(0, toMinutes(end) - toMinutes(start));
};

/**
 * One row of the plan, in the column names `apply_weekly_plan` expects.
 * A type alias rather than an interface: only aliases satisfy `Json`.
 */
export type PlanTaskRow = {
  id: string;
  parent_task_id: string | null;
  topic_id: string;
  type: TaskType;
  title: string;
  instructions: string;
  target_count: number | null;
  estimated_minutes: number | null;
  due_date: IsoDate;
};

/**
 * Turns placed steps into task rows, gathering the concept page and the
 * Feynman page of one topic under a single learning task.
 *
 * The container carries no minutes and no question count on purpose: the week
 * view lists containers and steps side by side, so a container with an
 * estimate would have every grouped day count its work twice — and the same
 * number would later be fed back into the learned capacity.
 *
 * Its day is the last of its steps': the sitting is finished when its second
 * half is, and a container that claimed to be due earlier would only nag.
 */
export function buildPlanRows(
  rows: readonly { slot: PlanSlot; title: string; instructions: string }[],
): PlanTaskRow[] {
  const groups = new Map<string, { slot: PlanSlot; title: string; instructions: string }[]>();
  for (const row of rows) {
    const key = row.slot.learningGroupKey;
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const parentIdByKey = new Map<string, string>();
  const out: PlanTaskRow[] = [];

  // Containers first: a step cannot reference a row that is not there yet, and
  // the array's order is the only thing SQL's two passes have to go on.
  for (const [key, members] of groups) {
    if (members.length < 2) continue; // a group of one is just a task
    const first = members[0];
    if (!first) continue;
    const id = crypto.randomUUID();
    parentIdByKey.set(key, id);
    out.push({
      id,
      parent_task_id: null,
      topic_id: first.slot.topicId,
      type: 'learning',
      title: `${first.slot.topicTitle} — öğrenme görevi`.slice(0, 200),
      instructions:
        'Konsept sayfası ve Feynman anlatımı aynı oturum: önce sayfaya ekle, sonra kapat ve boş kâğıda anlat.',
      target_count: null,
      estimated_minutes: null,
      due_date: members.reduce<IsoDate>(
        (latest, member) => (member.slot.dueDate > latest ? member.slot.dueDate : latest),
        first.slot.dueDate,
      ),
    });
  }

  for (const { slot, title, instructions } of rows) {
    out.push({
      id: crypto.randomUUID(),
      parent_task_id: slot.learningGroupKey === null ? null : (parentIdByKey.get(slot.learningGroupKey) ?? null),
      topic_id: slot.topicId,
      type: slot.type,
      title: title.slice(0, 200),
      instructions: instructions.slice(0, 2000),
      target_count: slot.targetCount,
      estimated_minutes: slot.estimatedMinutes,
      due_date: slot.dueDate,
    });
  }

  return out;
}

export class WeeklyPlanRepository {
  constructor(
    private readonly service: TypedClient,
    private readonly userId: string,
  ) {}

  /**
   * Today on the student's own calendar. The cron job runs at a fixed UTC hour
   * and the server's clock is UTC; which week "this week" is depends on where
   * the student is.
   */
  async localToday(): Promise<IsoDate> {
    const { data, error } = await this.service.from('profiles').select('timezone').eq('id', this.userId).maybeSingle();
    if (error) throw dbError('load timezone', error);
    return localDateIn(new Date().toISOString(), data?.timezone ?? 'UTC');
  }

  /** Everything the planner scores on, in scoped reads. */
  async loadContext(weekStart: IsoDate, weekEnd: IsoDate): Promise<PlanContext> {
    const [topicsResult, examsResult, linksResult, tasksResult, classResult, sessionsResult, profileResult, coursesResult] =
      await Promise.all([
        this.service
          .from('topics')
          .select(
            'id, title, course_id, week_number, position, ease_factor, repetitions, next_review_on, last_reviewed_at, has_advanced_material, course:courses!topics_course_fk(name, code)',
          )
          .eq('user_id', this.userId)
          .limit(MAX_TOPICS),
        this.service
          .from('exams')
          .select('id, course_id, kind, title, exam_date')
          .eq('user_id', this.userId)
          .gte('exam_date', weekStart)
          .order('exam_date', { ascending: true }),
        this.service.from('exam_topics').select('exam_id, topic_id').eq('user_id', this.userId),
        this.loadAllTasks(),
        this.service
          .from('class_sessions')
          .select('course_id, weekday, start_time, end_time, is_lab')
          .eq('user_id', this.userId),
        this.service
          .from('task_sessions')
          .select('task_id, started_at, minutes')
          .eq('user_id', this.userId)
          .gte('started_at', `${addDays(weekStart, -LOOKBACK_WEEKS * 7)}T00:00:00Z`)
          .not('minutes', 'is', null),
        this.service
          .from('profiles')
          .select('blocked_weekdays, capacity_overrides, timezone')
          .eq('id', this.userId)
          .maybeSingle(),
        this.service.from('courses').select('id, term_start_date').eq('user_id', this.userId),
      ]);

    if (topicsResult.error) throw dbError('load topics', topicsResult.error);
    if (examsResult.error) throw dbError('load exams', examsResult.error);
    if (linksResult.error) throw dbError('load exam topics', linksResult.error);
    if (tasksResult.error) throw dbError('load tasks', tasksResult.error);
    if (classResult.error) throw dbError('load class schedule', classResult.error);
    if (sessionsResult.error) throw dbError('load study sessions', sessionsResult.error);
    if (profileResult.error) throw dbError('load profile', profileResult.error);
    if (coursesResult.error) throw dbError('load courses', coursesResult.error);

    // Tasks carrying a note were touched by the student, so they are never replaced.
    const { data: noted, error: notesError } = await this.service
      .from('task_notes')
      .select('task_id')
      .eq('user_id', this.userId);
    if (notesError) throw dbError('load task notes', notesError);
    const notedTaskIds = new Set(noted.map((n) => n.task_id));

    // Steps by container, so a group is judged as one thing — exactly as
    // apply_weekly_plan now deletes it.
    const childrenByParent = new Map<string, typeof tasksResult.data>();
    for (const task of tasksResult.data) {
      if (task.parent_task_id === null) continue;
      childrenByParent.set(task.parent_task_id, [...(childrenByParent.get(task.parent_task_id) ?? []), task]);
    }

    const failures = new Map<string, number>();
    const completedSteps = new Map<string, Set<StudyStep>>();
    const openSteps = new Map<string, Set<StudyStep>>();
    const teacherMaterial = new Set<string>();
    const recentFrom = addDays(weekStart, -RECENT_FAILURE_DAYS);

    const isCleanRow = (task: (typeof tasksResult.data)[number]): boolean =>
      task.due_date >= weekStart &&
      task.due_date <= weekEnd &&
      task.source === 'ai_weekly_plan' &&
      task.status === 'pending' &&
      task.completed_count === 0 &&
      !notedTaskIds.has(task.id);

    for (const task of tasksResult.data) {
      // Mirrors apply_weekly_plan's delete predicate: these rows are replaceable.
      // A container counts as replaceable only when every step under it is —
      // one worked step keeps the whole group, so the group is still real work.
      const replaceable =
        isCleanRow(task) && (childrenByParent.get(task.id) ?? []).every((child) => isCleanRow(child));

      // A task that is about to be replaced must not look like existing work.
      if (replaceable) continue;

      const open = task.status === 'pending' || task.status === 'in_progress';
      if (task.status === 'failed' && task.due_date >= recentFrom) {
        failures.set(task.topic_id, (failures.get(task.topic_id) ?? 0) + 1);
      }
      // Material the student already has — a teacher's file or homework they
      // were set — stands in for the automation quiz on that topic.
      if (open && (task.source === 'ai_attachment' || task.source === 'homework')) {
        teacherMaterial.add(task.topic_id);
      }

      if (!isStudyStep(task.type)) continue;
      const bucket = task.status === 'completed' ? completedSteps : open ? openSteps : null;
      if (!bucket) continue;
      const steps = bucket.get(task.topic_id) ?? new Set<StudyStep>();
      steps.add(task.type);
      bucket.set(task.topic_id, steps);
    }

    // What the student actually does, day by day, over the recent past — on
    // their own calendar, with their own numbers and closed days on top. The
    // app's capacity card runs the same function on the same rows.
    const timeZone = profileResult.data?.timezone ?? 'UTC';
    const capacity = resolveCapacity({
      today: weekStart,
      finished: tasksResult.data.flatMap((task) =>
        task.status === 'completed' && task.completed_at
          ? [
              {
                taskId: task.id,
                parentTaskId: task.parent_task_id,
                finishedOn: localDateIn(task.completed_at, timeZone),
                estimatedMinutes: task.estimated_minutes,
              },
            ]
          : [],
      ),
      timed: (sessionsResult.data ?? []).flatMap((session) =>
        session.minutes === null
          ? []
          : [{ taskId: session.task_id, startedOn: localDateIn(session.started_at, timeZone), minutes: session.minutes }],
      ),
      // "Pazarları hiç çalışamam" is a fact about the week, not a bad average.
      blockedWeekdays: (profileResult.data?.blocked_weekdays ?? []).filter((day) => day >= 1 && day <= 7),
      overrides: parseCapacityOverrides(profileResult.data?.capacity_overrides),
    });

    // The timetable: how busy each weekday is, and which days teach which course.
    // Lab hours count as busy time but never as a teaching day — the student
    // handles labs alone, so the planner keeps out of them.
    const classLoad: Record<number, number> = {};
    const teachingDays = new Map<string, Set<number>>();
    for (const session of classResult.data) {
      classLoad[session.weekday] =
        (classLoad[session.weekday] ?? 0) + minutesBetween(session.start_time, session.end_time);
      if (session.is_lab) continue;
      const days = teachingDays.get(session.course_id) ?? new Set<number>();
      days.add(session.weekday);
      teachingDays.set(session.course_id, days);
    }
    const courseClassDays: Record<string, number[]> = {};
    for (const [courseId, days] of teachingDays) courseClassDays[courseId] = [...days].sort((a, b) => a - b);

    // Homework still open and due inside the week: the plan must leave room
    // for it, or it will quietly plan over the student's deadlines.
    // A task with steps is only a container; its steps are the real work and
    // are counted in their own right.
    const parentIds = new Set(
      tasksResult.data.flatMap((task) => (task.parent_task_id === null ? [] : [task.parent_task_id])),
    );

    const commitments: PlanCommitment[] = tasksResult.data.flatMap((task) => {
      if (task.source !== 'homework' && task.source !== 'ai_attachment') return [];
      if (parentIds.has(task.id)) return [];
      if (task.status !== 'pending' && task.status !== 'in_progress') return [];
      if (task.due_date < weekStart || task.due_date > weekEnd) return [];

      const estimated = task.estimated_minutes ?? DEFAULT_HOMEWORK_MINUTES;
      const remaining =
        task.target_count === null || task.target_count === 0
          ? estimated
          : Math.round((estimated * Math.max(0, task.target_count - task.completed_count)) / task.target_count);
      if (remaining <= 0) return [];
      return [{ id: task.id, dueDate: task.due_date, startsOn: task.starts_on, remainingMinutes: remaining }];
    });

    const topicsByExam = new Map<string, string[]>();
    for (const link of linksResult.data) {
      topicsByExam.set(link.exam_id, [...(topicsByExam.get(link.exam_id) ?? []), link.topic_id]);
    }

    return {
      classLoad,
      courseClassDays,
      capacity,
      commitments,
      termStartByCourse: resolveTermStarts(
        coursesResult.data.map((course) => ({ id: course.id, termStartDate: course.term_start_date })),
      ),
      topics: topicsResult.data.map((t) => ({
        id: t.id,
        title: t.title,
        courseId: t.course_id,
        courseLabel: t.course.code ?? t.course.name,
        weekNumber: t.week_number,
        position: t.position,
        easeFactor: Number(t.ease_factor),
        repetitions: t.repetitions,
        nextReviewOn: t.next_review_on,
        lastReviewedAt: t.last_reviewed_at,
        completedSteps: [...(completedSteps.get(t.id) ?? [])],
        openSteps: [...(openSteps.get(t.id) ?? [])],
        recentFailures: failures.get(t.id) ?? 0,
        hasAdvancedMaterial: t.has_advanced_material,
        hasTeacherMaterial: teacherMaterial.has(t.id),
      })),
      exams: examsResult.data.map((e) => ({
        id: e.id,
        courseId: e.course_id,
        kind: e.kind,
        title: e.title,
        examDate: e.exam_date,
        topicIds: topicsByExam.get(e.id) ?? [],
      })),
    };
  }

  /**
   * Every task the student has, page by page. A single request stops at a
   * thousand rows, and a term passes that — silently, which made finished
   * topics look untouched and planned them all over again.
   */
  private async loadAllTasks() {
    const rows = [];
    for (let page = 0; page < MAX_TASK_PAGES; page++) {
      const { data, error } = await this.service
        .from('tasks')
        .select(
          'id, topic_id, type, status, due_date, starts_on, source, target_count, completed_count, estimated_minutes, completed_at, parent_task_id',
        )
        .eq('user_id', this.userId)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return { data: rows, error: null };
  }

  async apply(
    weekStart: IsoDate,
    weekEnd: IsoDate,
    rows: { slot: PlanSlot; title: string; instructions: string }[],
  ): Promise<{ deleted: number; inserted: number }> {
    const payload = buildPlanRows(rows);

    const { data, error } = await this.service.rpc('apply_weekly_plan', {
      p_user_id: this.userId,
      p_week_start: weekStart,
      p_week_end: weekEnd,
      p_tasks: payload satisfies Json,
    });
    if (error) throw dbError('apply weekly plan', error);

    const parsed = ApplyResultSchema.safeParse(data);
    if (!parsed.success) throw dbError('apply weekly plan (result)', parsed.error);
    return parsed.data;
  }
}
