import type { IsoDate, StudyStep, TaskType } from '@contracts/enums.contract';
import { toCourseRef } from '@entities/course';
import { BaseRepository } from '@shared/api/repository';
import type { Json } from '@shared/api/supabase';
import type { Exam } from '../domain/exam';

/** The three steps of the study loop count as coverage; other task types do not. */
const STUDY_STEPS: readonly StudyStep[] = ['concept_note', 'quiz', 'feynman', 'advanced_problems'];
const isStudyStep = (type: TaskType): type is StudyStep => (STUDY_STEPS as readonly string[]).includes(type);

/** Failures older than this say nothing about today's readiness. */
const RECENT_FAILURE_DAYS = 30;

export interface ExamModeTopic {
  id: string;
  title: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextReviewOn: IsoDate | null;
  completedSteps: StudyStep[];
  recentFailures: number;
}

export interface ExamModeContext {
  exam: Exam & { outcome: number | null; outcomeNote: string | null; reviewedAt: string | null };
  topics: ExamModeTopic[];
  /** Cram tasks already created for this exam, and how many are still open. */
  cramTasks: { total: number; open: number };
}

export interface CramTaskInput {
  topic_id: string;
  type: TaskType;
  title: string;
  instructions: string;
  target_count: number | null;
  estimated_minutes: number;
  due_date: IsoDate;
}

export interface ExamTopicReview {
  topic_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_on: IsoDate;
}

export class ExamModeRepository extends BaseRepository {
  /** Everything the exam screen needs: the exam, its topics, and their state. */
  async loadContext(examId: string, today: IsoDate): Promise<ExamModeContext> {
    const examRow = await this.execute(
      'exam_mode.exam',
      this.db
        .from('exams')
        .select(
          'id, kind, title, exam_date, start_time, outcome, outcome_note, reviewed_at, course:courses!exams_course_fk(id, name, code, color_hex)',
        )
        .eq('id', examId)
        .single(),
    );

    const links = await this.execute(
      'exam_mode.topicLinks',
      this.db.from('exam_topics').select('topic_id').eq('exam_id', examId),
    );
    const topicIds = links.map((link) => link.topic_id);

    const topicRows =
      topicIds.length === 0
        ? []
        : await this.execute(
            'exam_mode.topics',
            this.db
              .from('topics')
              .select('id, title, ease_factor, interval_days, repetitions, next_review_on')
              .in('id', topicIds),
          );

    // Tasks serve two purposes here: which steps are done, and what the sprint
    // has already created. Both come from one read.
    const taskRows = await this.execute(
      'exam_mode.tasks',
      this.db
        .from('tasks')
        .select('id, topic_id, type, status, due_date, source, origin_exam_id')
        .or(`topic_id.in.(${topicIds.length > 0 ? topicIds.join(',') : '00000000-0000-0000-0000-000000000000'}),origin_exam_id.eq.${examId}`),
    );

    const recentFrom = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_FAILURE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const completed = new Map<string, Set<StudyStep>>();
    const failures = new Map<string, number>();
    let cramTotal = 0;
    let cramOpen = 0;

    for (const task of taskRows) {
      if (task.origin_exam_id === examId && task.source === 'exam_cram') {
        cramTotal += 1;
        if (task.status === 'pending' || task.status === 'in_progress') cramOpen += 1;
      }
      if (!topicIds.includes(task.topic_id)) continue;
      if (task.status === 'failed' && task.due_date >= recentFrom) {
        failures.set(task.topic_id, (failures.get(task.topic_id) ?? 0) + 1);
      }
      if (task.status !== 'completed' || !isStudyStep(task.type)) continue;
      const steps = completed.get(task.topic_id) ?? new Set<StudyStep>();
      steps.add(task.type);
      completed.set(task.topic_id, steps);
    }

    return {
      exam: {
        id: examRow.id,
        kind: examRow.kind,
        title: examRow.title,
        examDate: examRow.exam_date,
        startTime: examRow.start_time,
        course: toCourseRef(examRow.course),
        outcome: examRow.outcome,
        outcomeNote: examRow.outcome_note,
        reviewedAt: examRow.reviewed_at,
      },
      topics: topicRows.map((row) => ({
        id: row.id,
        title: row.title,
        easeFactor: Number(row.ease_factor),
        intervalDays: row.interval_days,
        repetitions: row.repetitions,
        nextReviewOn: row.next_review_on,
        completedSteps: [...(completed.get(row.id) ?? [])],
        recentFailures: failures.get(row.id) ?? 0,
      })),
      cramTasks: { total: cramTotal, open: cramOpen },
    };
  }

  /** Replaces this exam's untouched sprint tasks with the current plan. */
  async applyCramPlan(examId: string, tasks: readonly CramTaskInput[]): Promise<{ deleted: number; inserted: number }> {
    const result = await this.execute(
      'exam_mode.applyCramPlan',
      this.db.rpc('apply_exam_cram_plan', { p_exam_id: examId, p_tasks: tasks as unknown as Json }),
    );
    const payload = result as { deleted?: number; inserted?: number } | null;
    return { deleted: payload?.deleted ?? 0, inserted: payload?.inserted ?? 0 };
  }

  async applyRetro(
    examId: string,
    outcome: number,
    note: string | null,
    reviews: readonly ExamTopicReview[],
  ): Promise<{ topicsUpdated: number; tasksClosed: number }> {
    const result = await this.execute(
      'exam_mode.applyRetro',
      this.db.rpc('apply_exam_retro', {
        p_exam_id: examId,
        p_outcome: outcome,
        // Generated RPC arg types carry no nullability; the function itself takes
        // null for "no note", which is the common case.
        p_note: note as string,
        p_reviews: reviews as unknown as Json,
      }),
    );
    const payload = result as { topics_updated?: number; tasks_closed?: number } | null;
    return { topicsUpdated: payload?.topics_updated ?? 0, tasksClosed: payload?.tasks_closed ?? 0 };
  }
}

export const examModeRepository = new ExamModeRepository();
