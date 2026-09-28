import { BaseRepository } from '@shared/api/repository';
import type { TopicMistake, TopicMistakeWithContext } from '../domain/topic-mistake';

const MISTAKE_SELECT = 'id, topic_id, body, concept, task_id, created_at, resolved_at';

const toMistake = (row: {
  id: string;
  topic_id: string;
  body: string;
  concept: string | null;
  task_id: string | null;
  created_at: string;
  resolved_at: string | null;
}): TopicMistake => ({
  id: row.id,
  topicId: row.topic_id,
  body: row.body,
  concept: row.concept,
  taskId: row.task_id,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

/** Enough of the topic and course to group by on the notebook screen. */
const MISTAKE_WITH_TOPIC =
  'id, topic_id, body, concept, task_id, created_at, resolved_at, topic:topics!topic_mistakes_topic_fk(title, course:courses!topics_course_fk(name, code))';

export class TopicMistakeRepository extends BaseRepository {
  /** The whole book, newest first, grouped later by course and topic. */
  async listAll(includeResolved: boolean): Promise<TopicMistakeWithContext[]> {
    const query = this.db
      .from('topic_mistakes')
      .select(MISTAKE_WITH_TOPIC)
      .order('created_at', { ascending: false })
      .limit(200);

    const rows = await this.execute(
      'topic_mistakes.listAll',
      includeResolved ? query : query.is('resolved_at', null),
    );
    return rows.map((row) => ({
      ...toMistake(row),
      topicTitle: row.topic.title,
      courseLabel: row.topic.course.code ?? row.topic.course.name,
    }));
  }

  /** Open entries for one topic, newest first. */
  async listForTopic(topicId: string): Promise<TopicMistake[]> {
    const rows = await this.execute(
      'topic_mistakes.listForTopic',
      this.db
        .from('topic_mistakes')
        .select(MISTAKE_SELECT)
        .eq('topic_id', topicId)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(10),
    );
    return rows.map(toMistake);
  }

  /** Open entries across several topics — the exam screen asks for all of them at once. */
  async listForTopics(topicIds: readonly string[]): Promise<TopicMistake[]> {
    if (topicIds.length === 0) return [];
    const rows = await this.execute(
      'topic_mistakes.listForTopics',
      this.db
        .from('topic_mistakes')
        .select(MISTAKE_SELECT)
        .in('topic_id', [...topicIds])
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(100),
    );
    return rows.map(toMistake);
  }

  /** "Bunu artık biliyorum" — the entry stays, but stops being shown. */
  async resolve(mistakeId: string): Promise<void> {
    await this.execute(
      'topic_mistakes.resolve',
      this.db
        .from('topic_mistakes')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', mistakeId)
        .select('id')
        .single(),
    );
  }

  async add(topicId: string, body: string): Promise<void> {
    const userId = await this.requireUserId();
    await this.execute(
      'topic_mistakes.add',
      this.db
        .from('topic_mistakes')
        .insert({ user_id: userId, topic_id: topicId, body: body.trim().slice(0, 300) })
        .select('id')
        .single(),
    );
  }
}

export const topicMistakeRepository = new TopicMistakeRepository();
