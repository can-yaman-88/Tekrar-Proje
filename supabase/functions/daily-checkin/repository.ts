import { z } from 'zod';
import type { DailyCheckinResponse } from '../_shared/contracts/daily-checkin.contract.ts';
import type { IsoDate, StudyStep } from '../_shared/contracts/enums.contract.ts';
import type { Json } from '../_shared/database.types.ts';
import {
  localDateIn,
  LOOKBACK_WEEKS,
  parseCapacityOverrides,
  resolveCapacity,
} from '../_shared/domain/capacity.ts';
import { addDays } from '../_shared/domain/dates.ts';
import { HttpError } from '../_shared/errors.ts';
import type { TypedClient } from '../_shared/supabase.ts';
import { selectCandidateTasks } from './candidates.ts';
import type {
  CandidateCourse,
  CandidateExam,
  CandidateMistake,
  CandidateTask,
  CandidateTopic,
  CheckinPlan,
  CramContext,
} from './planner.ts';

/** A crashed invocation leaves a log in `processing`; after this it may be re-claimed. */
const STALE_PROCESSING_MS = 5 * 60_000;
const TASK_LOOKBACK_DAYS = 14;
/**
 * Far enough ahead to cover the week the student is talking about. "Bu haftaki
 * İngilizce görevlerini sil" is impossible to obey if Friday's tasks were
 * never shown to the model.
 */
const TASK_LOOKAHEAD_DAYS = 14;
/** What the prompt carries; `selectCandidateTasks` decides which ones. */
const MAX_TASKS = 100;
/** What is read to choose from — the whole window, for any real student. */
const MAX_TASK_ROWS = 400;
const MAX_TOPICS = 300;
const MAX_COURSES = 40;
const MAX_EXAMS = 30;
const MAX_OPEN_MISTAKES = 40;
/** Far enough back to know whether a topic was already counted on a reported day. */
const REVIEW_HISTORY_DAYS = 30;
/**
 * Results come back weeks after the exam ("geçen ayki vizeden 65 aldım"), so a
 * month of past exams stays on the list for a result to land on.
 */
const EXAM_LOOKBACK_DAYS = 30;
/** "Az önceki raporu geri al" means a recent one; last week's is the history screen's job. */
const UNDO_WINDOW_MS = 48 * 60 * 60_000;
/** Failures older than this say nothing about readiness — the exam screen's rule. */
const RECENT_FAILURE_DAYS = 30;
const STUDY_STEPS: readonly string[] = ['concept_note', 'quiz', 'feynman', 'advanced_problems'];

const TASK_COLUMNS =
  'id, topic_id, title, type, status, due_date, target_count, completed_count, estimated_minutes, instructions, source, parent_task_id, origin_exam_id, is_priority';
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_BUCKET = 'checkin-attachments';

type TaskRow = {
  id: string;
  topic_id: string;
  title: string;
  type: CandidateTask['type'];
  status: CandidateTask['status'];
  due_date: string;
  target_count: number | null;
  completed_count: number;
  estimated_minutes: number | null;
  instructions: string | null;
  source: CandidateTask['source'];
  parent_task_id: string | null;
  origin_exam_id: string | null;
  is_priority: boolean;
};

const toCandidate = (t: TaskRow): CandidateTask => ({
  id: t.id,
  topicId: t.topic_id,
  title: t.title,
  type: t.type,
  status: t.status,
  dueDate: t.due_date,
  targetCount: t.target_count,
  completedCount: t.completed_count,
  estimatedMinutes: t.estimated_minutes,
  instructions: t.instructions,
  source: t.source,
  parentTaskId: t.parent_task_id,
  originExamId: t.origin_exam_id,
  isPriority: t.is_priority,
});

/** The earlier check-in a report took back. */
export interface UndoneReport {
  id: string;
  logDate: IsoDate;
}

const ApplyResultSchema = z.object({
  created_task_ids: z.array(z.uuid()),
  removed_task_ids: z.array(z.uuid()).default([]),
  moved_task_ids: z.array(z.uuid()).default([]),
});

export interface ApplyResult {
  createdTaskIds: string[];
  removedTaskIds: string[];
  movedTaskIds: string[];
  mistakesRecorded: number;
}

/** What the student's week can actually hold, and which days it cannot. */
export interface CapacityContext {
  capacityByWeekday: Record<number, number>;
  blockedWeekdays: number[];
}

export interface ClaimedLog {
  id: string;
  logDate: IsoDate;
  rawText: string;
}

export interface CheckinAttachment {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface CheckinContext {
  tasks: CandidateTask[];
  topics: CandidateTopic[];
  /** Only so the report can move an exam or announce one. */
  courses: CandidateCourse[];
  exams: CandidateExam[];
  /** Book entries still open, so a report can close one. */
  openMistakes: CandidateMistake[];
}

function dbError(operation: string, cause: unknown): HttpError {
  return new HttpError('internal', `Database error during ${operation}.`, { cause });
}

export class CheckinRepository {
  constructor(
    /** Service role: writes processing state. Always filtered by userId. */
    private readonly service: TypedClient,
    /** Caller's JWT: RLS-scoped reads. */
    private readonly user: TypedClient,
    private readonly userId: string,
  ) {}

  /**
   * Atomically moves the log to `processing` (a conditional UPDATE, so two
   * concurrent invocations cannot both win). Failed and stale logs are retryable.
   */
  async claim(dailyLogId: string): Promise<ClaimedLog> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();

    const { data, error } = await this.service
      .from('daily_logs')
      .update({ status: 'processing', error_message: null })
      .eq('id', dailyLogId)
      .eq('user_id', this.userId)
      .or(`status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${staleBefore})`)
      .select('id, log_date, raw_text')
      .maybeSingle();

    if (error) throw dbError('claim', error);
    if (data) return { id: data.id, logDate: data.log_date, rawText: data.raw_text };

    const { data: existing, error: lookupError } = await this.user
      .from('daily_logs')
      .select('status')
      .eq('id', dailyLogId)
      .maybeSingle();
    if (lookupError) throw dbError('claim lookup', lookupError);
    if (!existing) throw new HttpError('not_found', 'Check-in not found.');
    throw new HttpError(
      'conflict',
      existing.status === 'succeeded' ? 'This check-in was already processed.' : 'This check-in is already being processed.',
    );
  }

  /** `report` decides which tasks are shown when the window holds more than the prompt can. */
  async loadContext(logDate: IsoDate, report: string): Promise<CheckinContext> {
    const [tasksResult, topicsResult, coursesResult, examsResult, mistakesResult, reviewsResult] = await Promise.all([
      this.user
        .from('tasks')
        .select(TASK_COLUMNS)
        // Closed tasks stay in scope so a later report can correct them.
        .in('status', ['pending', 'in_progress', 'completed', 'failed'])
        .gte('due_date', addDays(logDate, -TASK_LOOKBACK_DAYS))
        .lte('due_date', addDays(logDate, TASK_LOOKAHEAD_DAYS))
        .order('due_date', { ascending: true })
        .limit(MAX_TASK_ROWS),
      this.user
        .from('topics')
        .select(
          'id, course_id, title, week_number, position, ease_factor, interval_days, repetitions, next_review_on, last_reviewed_at, course:courses!topics_course_fk(name)',
        )
        .order('course_id')
        .order('week_number', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true })
        .limit(MAX_TOPICS),
      this.user.from('courses').select('id, name').order('name').limit(MAX_COURSES),
      this.user
        .from('exams')
        .select('id, course_id, title, exam_date')
        // A month back: late enough for a result, recent enough to stay short.
        .gte('exam_date', addDays(logDate, -EXAM_LOOKBACK_DAYS))
        .order('exam_date', { ascending: true })
        .limit(MAX_EXAMS),
      this.user
        .from('topic_mistakes')
        .select('id, topic_id, body')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(MAX_OPEN_MISTAKES),
      this.user
        .from('topic_review_events')
        .select('topic_id, reviewed_on')
        .gte('reviewed_on', addDays(logDate, -REVIEW_HISTORY_DAYS))
        .order('reviewed_on', { ascending: false })
        .limit(1000),
    ]);

    if (tasksResult.error) throw dbError('load tasks', tasksResult.error);
    if (topicsResult.error) throw dbError('load topics', topicsResult.error);
    if (coursesResult.error) throw dbError('load courses', coursesResult.error);
    if (examsResult.error) throw dbError('load exams', examsResult.error);
    if (mistakesResult.error) throw dbError('load open mistakes', mistakesResult.error);
    if (reviewsResult.error) throw dbError('load review history', reviewsResult.error);

    // The last day each topic was counted, by a tap or an earlier report. Rows
    // come newest first, so the first one seen per topic is the one that counts.
    const lastReviewedOn = new Map<string, IsoDate>();
    for (const row of reviewsResult.data) {
      if (!lastReviewedOn.has(row.topic_id)) lastReviewedOn.set(row.topic_id, row.reviewed_on);
    }

    const tasks = tasksResult.data.map(toCandidate);

    return {
      tasks: selectCandidateTasks({ rows: tasks, logDate, report, limit: MAX_TASKS }),
      topics: topicsResult.data.map((t) => ({
        id: t.id,
        courseId: t.course_id,
        title: t.title,
        courseName: t.course.name,
        weekNumber: t.week_number,
        position: t.position,
        srs: { easeFactor: Number(t.ease_factor), intervalDays: t.interval_days, repetitions: t.repetitions },
        nextReviewOn: t.next_review_on,
        // Reviews from before the history existed only left a timestamp (UTC,
        // as the database reads it too).
        lastReviewedOn: lastReviewedOn.get(t.id) ?? t.last_reviewed_at?.slice(0, 10) ?? null,
      })),
      courses: coursesResult.data.map((c) => ({ id: c.id, name: c.name })),
      exams: examsResult.data.map((e) => ({
        id: e.id,
        courseId: e.course_id,
        title: e.title,
        examDate: e.exam_date,
      })),
      openMistakes: mistakesResult.data.map((m) => ({ id: m.id, topicId: m.topic_id, body: m.body })),
    };
  }

  /**
   * How much this student gets done on each weekday.
   *
   * Only needed when a day has to be emptied, but it is the same calculation
   * the weekly planner runs — a day cleared by the check-in and a day filled by
   * the planner must not disagree about what the student can manage.
   */
  async loadCapacity(logDate: IsoDate): Promise<CapacityContext> {
    const historyStart = addDays(logDate, -LOOKBACK_WEEKS * 7);
    const [finishedResult, sessionsResult, timerResult, profileResult] = await Promise.all([
      this.user
        .from('tasks')
        .select('id, parent_task_id, completed_at, estimated_minutes')
        .eq('status', 'completed')
        // A day of slack on either side: the cut is made on the local calendar below.
        .gte('completed_at', `${addDays(historyStart, -1)}T00:00:00Z`)
        .lt('completed_at', `${addDays(logDate, 1)}T00:00:00Z`)
        .limit(2000),
      this.user
        .from('task_sessions')
        .select('task_id, started_at, minutes')
        .gte('started_at', `${addDays(historyStart, -1)}T00:00:00Z`)
        .not('minutes', 'is', null)
        .limit(2000),
      // Focus Timer stretches filed under a task count as measured work on it.
      this.user
        .from('focus_sessions')
        .select('task_id, started_at, minutes')
        .gte('started_at', `${addDays(historyStart, -1)}T00:00:00Z`)
        .not('task_id', 'is', null)
        .limit(2000),
      this.user
        .from('profiles')
        .select('blocked_weekdays, capacity_overrides, timezone')
        .eq('id', this.userId)
        .maybeSingle(),
    ]);

    if (finishedResult.error) throw dbError('load finished tasks', finishedResult.error);
    if (sessionsResult.error) throw dbError('load sessions', sessionsResult.error);
    if (timerResult.error) throw dbError('load focus timer sessions', timerResult.error);
    if (profileResult.error) throw dbError('load profile', profileResult.error);

    const timeZone = profileResult.data?.timezone ?? 'UTC';
    const blockedWeekdays = (profileResult.data?.blocked_weekdays ?? []).filter(
      (weekday) => weekday >= 1 && weekday <= 7,
    );
    const capacity = resolveCapacity({
      today: logDate,
      finished: finishedResult.data.flatMap((task) =>
        task.completed_at === null
          ? []
          : [
              {
                taskId: task.id,
                parentTaskId: task.parent_task_id,
                finishedOn: localDateIn(task.completed_at, timeZone),
                estimatedMinutes: task.estimated_minutes,
              },
            ],
      ),
      timed: [...sessionsResult.data, ...timerResult.data].flatMap((session) =>
        session.minutes === null || session.task_id === null
          ? []
          : [{ taskId: session.task_id, startedOn: localDateIn(session.started_at, timeZone), minutes: session.minutes }],
      ),
      blockedWeekdays,
      overrides: parseCapacityOverrides(profileResult.data?.capacity_overrides),
    });

    // A closed day is worth nothing, whatever the history says about it.
    return { capacityByWeekday: { ...capacity.minutesByWeekday }, blockedWeekdays };
  }

  /** The topics each exam covers — only needed when the report gives a result. */
  async loadExamTopics(examIds: readonly string[]): Promise<Record<string, string[]>> {
    if (examIds.length === 0) return {};
    const { data, error } = await this.user.from('exam_topics').select('exam_id, topic_id').in('exam_id', [...examIds]);
    if (error) throw dbError('load exam topics', error);
    const byExam: Record<string, string[]> = {};
    for (const row of data) byExam[row.exam_id] = [...(byExam[row.exam_id] ?? []), row.topic_id];
    return byExam;
  }

  /**
   * What "vize için plan çıkar" needs: the exam's topics and how ready each one
   * is, read exactly as the exam screen reads them, plus the sprint tasks that
   * already exist so the new plan can replace the untouched ones.
   */
  async loadCramContexts(
    examIds: readonly string[],
    logDate: IsoDate,
  ): Promise<{ contexts: CramContext[]; sprintTasks: CandidateTask[] }> {
    if (examIds.length === 0) return { contexts: [], sprintTasks: [] };
    const topicsByExam = await this.loadExamTopics(examIds);
    const topicIds = [...new Set(Object.values(topicsByExam).flat())];
    // PostgREST cannot take an empty list; this id matches nothing.
    const none = ['00000000-0000-0000-0000-000000000000'];

    const [topicsResult, tasksResult] = await Promise.all([
      this.user
        .from('topics')
        .select('id, title, week_number, position, ease_factor, repetitions, next_review_on')
        .in('id', topicIds.length > 0 ? topicIds : none),
      this.user
        .from('tasks')
        .select(TASK_COLUMNS)
        .or(`topic_id.in.(${(topicIds.length > 0 ? topicIds : none).join(',')}),origin_exam_id.in.(${examIds.join(',')})`),
    ]);
    if (topicsResult.error) throw dbError('load cram topics', topicsResult.error);
    if (tasksResult.error) throw dbError('load cram tasks', tasksResult.error);

    const recentFrom = addDays(logDate, -RECENT_FAILURE_DAYS);
    const completed = new Map<string, Set<StudyStep>>();
    const failures = new Map<string, number>();
    for (const task of tasksResult.data) {
      if (task.status === 'failed' && task.due_date >= recentFrom) {
        failures.set(task.topic_id, (failures.get(task.topic_id) ?? 0) + 1);
      }
      if (task.status !== 'completed' || !STUDY_STEPS.includes(task.type)) continue;
      completed.set(task.topic_id, (completed.get(task.topic_id) ?? new Set<StudyStep>()).add(task.type as StudyStep));
    }

    const topicById = new Map(topicsResult.data.map((topic) => [topic.id, topic]));
    const contexts = examIds.map(
      (examId): CramContext => ({
        examId,
        topics: (topicsByExam[examId] ?? []).flatMap((topicId) => {
          const topic = topicById.get(topicId);
          if (!topic) return [];
          return [
            {
              id: topic.id,
              title: topic.title,
              weekNumber: topic.week_number,
              position: topic.position,
              easeFactor: Number(topic.ease_factor),
              repetitions: topic.repetitions,
              nextReviewOn: topic.next_review_on,
              completedSteps: [...(completed.get(topic.id) ?? [])],
              recentFailures: failures.get(topic.id) ?? 0,
            },
          ];
        }),
      }),
    );
    const sprintTasks = tasksResult.data
      .filter((task) => task.source === 'exam_cram' && task.origin_exam_id !== null && examIds.includes(task.origin_exam_id))
      .map(toCandidate);
    return { contexts, sprintTasks };
  }

  /**
   * "Az önceki değerlendirmeyi geri al": the processed check-in written just
   * before this one, within the last two days, undone with the student's own
   * rights through the same function the history screen uses.
   *
   * Only ever that one. A retry of this report must not reach past it: if the
   * first attempt already undid it and then failed, the second finds it undone
   * and stops, instead of taking back the report before it as well.
   */
  async undoPreviousReport(currentLogId: string): Promise<UndoneReport | null> {
    const since = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
    const { data: current, error: currentError } = await this.user
      .from('daily_logs')
      .select('created_at')
      .eq('id', currentLogId)
      .single();
    if (currentError) throw dbError('read current check-in', currentError);

    const { data, error } = await this.user
      .from('daily_logs')
      .select('id, log_date, reverted_at')
      .eq('status', 'succeeded')
      .neq('id', currentLogId)
      .lt('created_at', current.created_at)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw dbError('find previous check-in', error);
    if (!data) return null;

    if (data.reverted_at === null) {
      const { error: revertError } = await this.user.rpc('revert_daily_checkin', { p_daily_log_id: data.id });
      if (revertError) {
        console.error(JSON.stringify({ event: 'checkin_undo_previous_failed', message: revertError.message }));
        return null;
      }
    }
    return { id: data.id, logDate: data.log_date };
  }

  /**
   * Keeps the response on the log. A phone that lost the connection reads it
   * back from here — the list, the answers and the reminders, not only counts.
   */
  async saveResult(dailyLogId: string, result: DailyCheckinResponse): Promise<void> {
    const { error } = await this.service
      .from('daily_logs')
      .update({ result: result satisfies Json })
      .eq('id', dailyLogId)
      .eq('user_id', this.userId);
    if (error) console.warn(JSON.stringify({ event: 'checkin_result_save_failed', message: error.message }));
  }

  /** Downloads every file attached to this check-in from the private bucket. */
  async loadAttachments(dailyLogId: string): Promise<CheckinAttachment[]> {
    const { data, error } = await this.user
      .from('daily_log_attachments')
      .select('id, storage_path, original_filename, mime_type')
      .eq('daily_log_id', dailyLogId)
      .order('created_at', { ascending: true })
      .limit(MAX_ATTACHMENTS);
    if (error) throw dbError('load attachments', error);

    const files: CheckinAttachment[] = [];
    for (const row of data) {
      const { data: blob, error: downloadError } = await this.service.storage
        .from(ATTACHMENT_BUCKET)
        .download(row.storage_path);
      if (downloadError || !blob) {
        console.error(JSON.stringify({ event: 'attachment_download_failed', id: row.id }));
        continue;
      }
      files.push({
        id: row.id,
        filename: row.original_filename,
        mimeType: row.mime_type,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    return files;
  }

  /** Persists the plan through the transactional RPC; reports what it changed. */
  async apply(dailyLogId: string, model: string, plan: CheckinPlan): Promise<ApplyResult> {
    const { data, error } = await this.service.rpc('apply_daily_checkin', {
      p_user_id: this.userId,
      p_daily_log_id: dailyLogId,
      p_llm_model: model,
      p_summary: plan.summary,
      p_task_updates: plan.taskUpdates satisfies Json,
      p_topic_reviews: plan.topicReviews satisfies Json,
      p_new_tasks: plan.newTasks satisfies Json,
      p_topic_flags: plan.topicFlags satisfies Json,
      p_task_removals: plan.taskRemovals satisfies Json,
      p_task_moves: plan.taskMoves satisfies Json,
      p_block_weekdays: plan.blockWeekdays satisfies Json,
    });
    if (error) throw dbError('apply check-in', error);

    const parsed = ApplyResultSchema.safeParse(data);
    if (!parsed.success) throw dbError('apply check-in (result)', parsed.error);

    // "Pazarları artık çalışabiliyorum": a standing setting, lifted after the
    // transaction that records the day — a setting that failed to change is
    // not a reason to make them write the day again. The undo still covers it.
    if (plan.reopenWeekdays.length > 0) {
      const { error: reopenError } = await this.service.rpc('apply_checkin_reopen_weekdays', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_weekdays: plan.reopenWeekdays satisfies Json,
      });
      if (reopenError) {
        console.error(JSON.stringify({ event: 'checkin_reopen_failed', message: reopenError.message }));
      }
    }

    // "Grupları dağıt" before any grouping below, so one report can take a
    // group apart and put its pieces together differently.
    if (plan.taskUngroups.length > 0) {
      const { error: ungroupError } = await this.service.rpc('apply_checkin_ungroup', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_parent_ids: plan.taskUngroups satisfies Json,
      });
      if (ungroupError) {
        console.error(JSON.stringify({ event: 'checkin_ungroup_failed', message: ungroupError.message }));
      }
    }

    // Everything the student could have changed by hand — fields, grouping,
    // notes, time, exams, closed book entries. It runs after the transaction
    // that decides whether the check-in happened at all: a calendar entry the
    // report got wrong is not a reason to make them write the day again.
    const edits = {
      p_user_id: this.userId,
      p_daily_log_id: dailyLogId,
      p_task_edits: plan.taskEdits satisfies Json,
      p_task_groups: plan.taskGroups satisfies Json,
      p_task_notes: plan.taskNotes satisfies Json,
      p_time_logs: plan.timeLogs satisfies Json,
      p_exam_changes: plan.examChanges satisfies Json,
      p_mistake_resolutions: plan.mistakeResolutions satisfies Json,
    };
    const hasEdits =
      plan.taskEdits.length +
        plan.taskGroups.length +
        plan.taskNotes.length +
        plan.timeLogs.length +
        plan.examChanges.length +
        plan.mistakeResolutions.length >
      0;
    if (hasEdits) {
      const { error: editError } = await this.service.rpc('apply_checkin_edits', edits);
      if (editError) {
        console.error(JSON.stringify({ event: 'checkin_edits_failed', message: editError.message }));
      }
    }
    // The review history and the real days work was done on are side records
    // too: the schedule itself is already written, these only describe it.
    if (plan.topicReviews.length > 0) {
      const { error: reviewError } = await this.service.rpc('record_checkin_reviews', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_reviews: plan.topicReviews satisfies Json,
      });
      if (reviewError) {
        console.warn(JSON.stringify({ event: 'review_history_write_failed', message: reviewError.message }));
      }
    }
    if (plan.completionDays.length > 0) {
      const { error: backdateError } = await this.service.rpc('backdate_checkin_completions', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_completions: plan.completionDays satisfies Json,
      });
      if (backdateError) {
        console.warn(JSON.stringify({ event: 'completion_days_write_failed', message: backdateError.message }));
      }
    }

    // What an exam covers ("vize 1 ilk beş haftayı kapsıyor").
    if (plan.examScopes.length > 0) {
      const { error: scopeError } = await this.service.rpc('apply_checkin_exam_scopes', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_scopes: plan.examScopes satisfies Json,
      });
      if (scopeError) {
        console.error(JSON.stringify({ event: 'checkin_exam_scopes_failed', message: scopeError.message }));
      }
    }

    // Off-plan work, exam results, urgency and the sprint's link to its exam:
    // the same "after the day is recorded" rule as the edits above.
    const hasExtras =
      plan.extraWork.length + plan.examResults.length + plan.priorities.length + plan.examLinks.length > 0;
    if (hasExtras) {
      const { error: extrasError } = await this.service.rpc('apply_checkin_extras', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_extra_work: plan.extraWork satisfies Json,
        p_exam_results: plan.examResults satisfies Json,
        p_priorities: plan.priorities satisfies Json,
        p_exam_links: plan.examLinks satisfies Json,
      });
      if (extrasError) {
        console.error(JSON.stringify({ event: 'checkin_extras_failed', message: extrasError.message }));
      }
    }

    // The mistake book is a side record: worth keeping, never worth failing a
    // check-in over, so it is written after the transaction that matters.
    let mistakesRecorded = 0;
    if (plan.topicMistakes.length > 0) {
      const { data: added, error: mistakeError } = await this.service.rpc('apply_checkin_mistakes', {
        p_user_id: this.userId,
        p_daily_log_id: dailyLogId,
        p_mistakes: plan.topicMistakes satisfies Json,
      });
      if (mistakeError) {
        console.warn(JSON.stringify({ event: 'mistakes_write_failed', message: mistakeError.message }));
      } else {
        mistakesRecorded = typeof added === 'number' ? added : 0;
      }
    }

    return {
      createdTaskIds: parsed.data.created_task_ids,
      removedTaskIds: parsed.data.removed_task_ids,
      movedTaskIds: parsed.data.moved_task_ids,
      mistakesRecorded,
    };
  }

  /** Best effort: never masks the original error. */
  async markFailed(dailyLogId: string, message: string): Promise<void> {
    const { error } = await this.service
      .from('daily_logs')
      .update({ status: 'failed', error_message: message.slice(0, 500) })
      .eq('id', dailyLogId)
      .eq('user_id', this.userId)
      .eq('status', 'processing');
    if (error) console.error(JSON.stringify({ event: 'mark_failed_error', dailyLogId, message: error.message }));
  }
}
