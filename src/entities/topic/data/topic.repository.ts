import { BaseRepository } from '@shared/api/repository';
import type { Topic } from '../domain/topic';

const TOPIC_SELECT =
  'id, course_id, title, week_number, ease_factor, interval_days, repetitions, next_review_on, last_reviewed_at, has_advanced_material';

export interface RadarTopic extends Topic {
  courseLabel: string;
}

/** One topic with what its screen needs to say which course it belongs to. */
export interface TopicDetail extends RadarTopic {
  courseName: string;
}

type TopicRecord = {
  id: string;
  course_id: string;
  title: string;
  week_number: number | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_on: string | null;
  last_reviewed_at: string | null;
  has_advanced_material: boolean;
};

type Rollup = { open: number; failed: number; solved: number };

const toTopic = (row: TopicRecord, counts: Rollup = { open: 0, failed: 0, solved: 0 }): Topic => ({
  id: row.id,
  courseId: row.course_id,
  title: row.title,
  weekNumber: row.week_number,
  easeFactor: Number(row.ease_factor),
  repetitions: row.repetitions,
  intervalDays: row.interval_days,
  nextReviewOn: row.next_review_on,
  lastReviewedAt: row.last_reviewed_at,
  hasAdvancedMaterial: row.has_advanced_material,
  openTasks: counts.open,
  failedTasks: counts.failed,
  solvedProblems: counts.solved,
});

function rollupTasks(tasks: readonly { topic_id: string; status: string; completed_count: number }[]): Map<string, Rollup> {
  const rollup = new Map<string, Rollup>();
  for (const task of tasks) {
    const current = rollup.get(task.topic_id) ?? { open: 0, failed: 0, solved: 0 };
    if (task.status === 'pending' || task.status === 'in_progress') current.open++;
    if (task.status === 'failed') current.failed++;
    current.solved += task.completed_count;
    rollup.set(task.topic_id, current);
  }
  return rollup;
}

export class TopicRepository extends BaseRepository {
  /** Every topic with a review date or a weakness signal, across all courses. */
  async listReviewRadar(): Promise<RadarTopic[]> {
    const rows = await this.execute(
      'topics.listReviewRadar',
      this.db
        .from('topics')
        .select(`${TOPIC_SELECT}, course:courses!topics_course_fk(name, code)`)
        .order('next_review_on', { ascending: true, nullsFirst: false })
        .limit(200),
    );
    if (rows.length === 0) return [];

    const tasks = await this.execute(
      'topics.radarRollups',
      this.db
        .from('tasks')
        .select('topic_id, status, completed_count')
        .in(
          'topic_id',
          rows.map((r) => r.id),
        ),
    );

    const rollup = rollupTasks(tasks);
    return rows.map((row) => ({
      ...toTopic(row, rollup.get(row.id)),
      courseLabel: row.course.code ?? row.course.name,
    }));
  }

  /** One topic, for its own screen: the schedule, the course, the rollups. */
  async getDetail(topicId: string): Promise<TopicDetail> {
    const row = await this.execute(
      'topics.getDetail',
      this.db
        .from('topics')
        .select(`${TOPIC_SELECT}, course:courses!topics_course_fk(name, code)`)
        .eq('id', topicId)
        .single(),
    );
    const tasks = await this.execute(
      'topics.detailRollups',
      this.db.from('tasks').select('topic_id, status, completed_count').eq('topic_id', topicId),
    );
    return {
      ...toTopic(row, rollupTasks(tasks).get(row.id)),
      courseLabel: row.course.code ?? row.course.name,
      courseName: row.course.name,
    };
  }

  /** Topics of one course, each with its task rollups (open / failed / solved). */
  async listForCourse(courseId: string): Promise<Topic[]> {
    const rows = await this.execute(
      'topics.listForCourse',
      this.db
        .from('topics')
        .select(TOPIC_SELECT)
        .eq('course_id', courseId)
        .order('week_number', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true }),
    );
    if (rows.length === 0) return [];

    const tasks = await this.execute(
      'topics.rollups',
      this.db
        .from('tasks')
        .select('topic_id, status, completed_count')
        .in(
          'topic_id',
          rows.map((r) => r.id),
        ),
    );

    const rollup = rollupTasks(tasks);
    return rows.map((row) => toTopic(row, rollup.get(row.id)));
  }

  /** "Elimde bu konudan zor sorular var" — the switch that unlocks advanced work. */
  async setAdvancedMaterial(topicId: string, hasAdvancedMaterial: boolean): Promise<void> {
    await this.execute(
      'topics.setAdvancedMaterial',
      this.db
        .from('topics')
        .update({ has_advanced_material: hasAdvancedMaterial })
        .eq('id', topicId)
        .select('id')
        .single(),
    );
  }
}

export const topicRepository = new TopicRepository();
