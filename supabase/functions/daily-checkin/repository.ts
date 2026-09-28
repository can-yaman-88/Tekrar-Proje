import { z } from 'zod';
import type { IsoDate } from '../_shared/contracts/enums.contract.ts';
import type { Json } from '../_shared/database.types.ts';
import { buildCapacitySamples, learnDailyCapacity, LOOKBACK_WEEKS } from '../_shared/domain/capacity.ts';
import { addDays } from '../_shared/domain/dates.ts';
import { HttpError } from '../_shared/errors.ts';
import type { TypedClient } from '../_shared/supabase.ts';
import type {
  CandidateCourse,
  CandidateExam,
  CandidateMistake,
  CandidateTask,
  CandidateTopic,
  CheckinPlan,
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
const MAX_TASKS = 80;
const MAX_TOPICS = 300;
const MAX_COURSES = 40;
const MAX_EXAMS = 30;
const MAX_OPEN_MISTAKES = 40;
/** Yesterday's exam is still correctable; last month's is not. */
const EXAM_LOOKBACK_DAYS = 1;
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_BUCKET = 'checkin-attachments';

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

  async loadContext(logDate: IsoDate): Promise<CheckinContext> {
    const [tasksResult, topicsResult, coursesResult, examsResult, mistakesResult] = await Promise.all([
      this.user
        .from('tasks')
        .select(
          'id, topic_id, title, type, status, due_date, target_count, completed_count, estimated_minutes, instructions, source',
        )
        // Closed tasks stay in scope so a later report can correct them.
        .in('status', ['pending', 'in_progress', 'completed', 'failed'])
        .gte('due_date', addDays(logDate, -TASK_LOOKBACK_DAYS))
        .lte('due_date', addDays(logDate, TASK_LOOKAHEAD_DAYS))
        .order('due_date', { ascending: true })
        .limit(MAX_TASKS),
      this.user
        .from('topics')
        .select('id, title, week_number, ease_factor, interval_days, repetitions, course:courses!topics_course_fk(name)')
        .order('course_id')
        .order('week_number', { ascending: true, nullsFirst: false })
        .limit(MAX_TOPICS),
      this.user.from('courses').select('id, name').order('name').limit(MAX_COURSES),
      this.user
        .from('exams')
        .select('id, course_id, title, exam_date')
        // Yesterday's exam can still be corrected today; anything older is history.
        .gte('exam_date', addDays(logDate, -EXAM_LOOKBACK_DAYS))
        .order('exam_date', { ascending: true })
        .limit(MAX_EXAMS),
      this.user
        .from('topic_mistakes')
        .select('id, topic_id, body')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(MAX_OPEN_MISTAKES),
    ]);

    if (tasksResult.error) throw dbError('load tasks', tasksResult.error);
    if (topicsResult.error) throw dbError('load topics', topicsResult.error);
    if (coursesResult.error) throw dbError('load courses', coursesResult.error);
    if (examsResult.error) throw dbError('load exams', examsResult.error);
    if (mistakesResult.error) throw dbError('load open mistakes', mistakesResult.error);

    return {
      tasks: tasksResult.data.map((t) => ({
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
      })),
      topics: topicsResult.data.map((t) => ({
        id: t.id,
        title: t.title,
        courseName: t.course.name,
        weekNumber: t.week_number,
        srs: { easeFactor: Number(t.ease_factor), intervalDays: t.interval_days, repetitions: t.repetitions },
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
    const [finishedResult, sessionsResult, profileResult] = await Promise.all([
      this.user
        .from('tasks')
        .select('completed_at, estimated_minutes')
        .eq('status', 'completed')
        .gte('completed_at', `${historyStart}T00:00:00Z`)
        .lt('completed_at', `${logDate}T00:00:00Z`),
      this.user
        .from('task_sessions')
        .select('started_at, minutes')
        .gte('started_at', `${historyStart}T00:00:00Z`)
        .not('minutes', 'is', null),
      this.user.from('profiles').select('blocked_weekdays').eq('id', this.userId).maybeSingle(),
    ]);

    if (finishedResult.error) throw dbError('load finished tasks', finishedResult.error);
    if (sessionsResult.error) throw dbError('load sessions', sessionsResult.error);
    if (profileResult.error) throw dbError('load profile', profileResult.error);

    const days: IsoDate[] = [];
    for (let day = historyStart; day < logDate; day = addDays(day, 1)) days.push(day);

    const estimated = finishedResult.data.flatMap((task) =>
      task.completed_at === null ? [] : [{ date: task.completed_at.slice(0, 10), minutes: task.estimated_minutes ?? 0 }],
    );
    const measured = sessionsResult.data.flatMap((session) =>
      session.minutes === null ? [] : [{ date: session.started_at.slice(0, 10), minutes: session.minutes }],
    );
    const { samples } = buildCapacitySamples(measured, estimated);
    const learned = learnDailyCapacity(samples, days);

    const blockedWeekdays = (profileResult.data?.blocked_weekdays ?? []).filter(
      (weekday) => weekday >= 1 && weekday <= 7,
    );
    // A closed day is worth nothing, whatever the history says about it.
    const capacityByWeekday = { ...learned.minutesByWeekday };
    for (const weekday of blockedWeekdays) capacityByWeekday[weekday] = 0;

    return { capacityByWeekday, blockedWeekdays };
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
