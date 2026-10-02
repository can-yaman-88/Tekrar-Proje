import { BaseRepository } from '@shared/api/repository';
import type { StudyEntry } from '../domain/study-time';

const TASK_SESSION_SELECT =
  'id, task_id, started_at, minutes, task:tasks!task_sessions_task_fk!inner(topic_id, topic:topics!tasks_topic_fk!inner(id, title, course_id, course:courses!topics_course_fk!inner(id, name, code)))';

const FOCUS_SESSION_SELECT =
  'id, started_at, minutes, course_id, topic_id, task_id, topic:topics!focus_sessions_topic_fk(id, title), course:courses!focus_sessions_course_fk!inner(id, name, code)';

type Scope = { from: string } | { courseId: string } | { topicId: string };

const labelOf = (course: { name: string; code: string | null }): string => course.code ?? course.name;

/**
 * Study time from both clocks, in one shape: Tekrar's task stopwatch
 * (task_sessions, through the task to its topic and course) and the Focus
 * Timer app (focus_sessions, filed by course and optionally topic).
 */
export class StudyTimeRepository extends BaseRepository {
  async list(scope: Scope): Promise<StudyEntry[]> {
    const [tasks, timer] = await Promise.all([this.listTaskTime(scope), this.listTimerTime(scope)]);
    return [...tasks, ...timer].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async listTaskTime(scope: Scope): Promise<StudyEntry[]> {
    let query = this.db
      .from('task_sessions')
      .select(TASK_SESSION_SELECT)
      .not('minutes', 'is', null)
      .gt('minutes', 0);
    if ('from' in scope) query = query.gte('started_at', `${scope.from}T00:00:00`);
    if ('courseId' in scope) query = query.eq('task.topic.course_id', scope.courseId);
    if ('topicId' in scope) query = query.eq('task.topic_id', scope.topicId);

    const rows = await this.execute('study_time.tasks', query);
    return rows.flatMap((row) => {
      const topic = row.task?.topic;
      if (!topic?.course || row.minutes === null) return [];
      return [
        {
          id: `task:${row.id}`,
          source: 'task' as const,
          startedAt: row.started_at,
          minutes: row.minutes,
          courseId: topic.course.id,
          courseLabel: labelOf(topic.course),
          topicId: topic.id,
          topicTitle: topic.title,
          taskId: row.task_id,
        },
      ];
    });
  }

  private async listTimerTime(scope: Scope): Promise<StudyEntry[]> {
    let query = this.db.from('focus_sessions').select(FOCUS_SESSION_SELECT);
    if ('from' in scope) query = query.gte('started_at', `${scope.from}T00:00:00`);
    if ('courseId' in scope) query = query.eq('course_id', scope.courseId);
    if ('topicId' in scope) query = query.eq('topic_id', scope.topicId);

    const rows = await this.execute('study_time.timer', query);
    return rows.flatMap((row) =>
      row.course
        ? [
            {
              id: `timer:${row.id}`,
              source: 'timer' as const,
              startedAt: row.started_at,
              minutes: row.minutes,
              courseId: row.course.id,
              courseLabel: labelOf(row.course),
              topicId: row.topic?.id ?? null,
              topicTitle: row.topic?.title ?? null,
              taskId: row.task_id,
            },
          ]
        : [],
    );
  }
}

export const studyTimeRepository = new StudyTimeRepository();
