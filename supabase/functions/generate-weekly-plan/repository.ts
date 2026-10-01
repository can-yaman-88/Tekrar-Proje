import { z } from 'zod';
import type { IsoDate } from '../_shared/contracts/enums.contract.ts';
import type { Json } from '../_shared/database.types.ts';
import { HttpError } from '../_shared/errors.ts';
import { addDays } from '../_shared/domain/dates.ts';
import type { TypedClient } from '../_shared/supabase.ts';
import type { StudyStep } from '../_shared/contracts/enums.contract.ts';
import { FIRST_CYCLE } from './study-cycle.ts';
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
}

const isStudyStep = (type: string): type is StudyStep => (FIRST_CYCLE as readonly string[]).includes(type);

const minutesBetween = (start: string, end: string): number => {
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':');
    return Number(hours) * 60 + Number(minutes);
  };
  return Math.max(0, toMinutes(end) - toMinutes(start));
};

export class WeeklyPlanRepository {
  constructor(
    private readonly service: TypedClient,
    private readonly userId: string,
  ) {}

  /** Everything the planner scores on, in scoped reads. */
  async loadContext(weekStart: IsoDate, weekEnd: IsoDate): Promise<PlanContext> {
    const [topicsResult, examsResult, linksResult, tasksResult, classResult, sessionsResult, profileResult] =
      await Promise.all([
        this.service
          .from('topics')
          .select(
            'id, title, course_id, week_number, ease_factor, repetitions, next_review_on, last_reviewed_at, has_advanced_material, course:courses!topics_course_fk(name, code)',
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
      ]);

    if (topicsResult.error) throw dbError('load topics', topicsResult.error);
    if (examsResult.error) throw dbError('load exams', examsResult.error);
    if (linksResult.error) throw dbError('load exam topics', linksResult.error);
    if (tasksResult.error) throw dbError('load tasks', tasksResult.error);
    if (classResult.error) throw dbError('load class schedule', classResult.error);
    if (sessionsResult.error) throw dbError('load study sessions', sessionsResult.error);
    if (profileResult.error) throw dbError('load profile', profileResult.error);

    // Tasks carrying a note were touched by the student, so they are never replaced.
    const { data: noted, error: notesError } = await this.service
      .from('task_notes')
      .select('task_id')
      .eq('user_id', this.userId);
    if (notesError) throw dbError('load task notes', notesError);
    const notedTaskIds = new Set(noted.map((n) => n.task_id));

    const failures = new Map<string, number>();
    const completedSteps = new Map<string, Set<StudyStep>>();
    const openSteps = new Map<string, Set<StudyStep>>();
    const teacherMaterial = new Set<string>();
    const recentFrom = addDays(weekStart, -RECENT_FAILURE_DAYS);

    for (const task of tasksResult.data) {
      const inWindow = task.due_date >= weekStart && task.due_date <= weekEnd;
      // Mirrors apply_weekly_plan's delete predicate: these rows are replaceable.
      const replaceable =
        inWindow &&
        task.source === 'ai_weekly_plan' &&
        task.status === 'pending' &&
        task.completed_count === 0 &&
        !notedTaskIds.has(task.id);

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
      topics: topicsResult.data.map((t) => ({
        id: t.id,
        title: t.title,
        courseId: t.course_id,
        courseLabel: t.course.code ?? t.course.name,
        weekNumber: t.week_number,
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
    const payload = rows.map(({ slot, title, instructions }) => ({
      topic_id: slot.topicId,
      type: slot.type,
      title: title.slice(0, 200),
      instructions: instructions.slice(0, 2000),
      target_count: slot.targetCount,
      estimated_minutes: slot.estimatedMinutes,
      due_date: slot.dueDate,
    }));

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
