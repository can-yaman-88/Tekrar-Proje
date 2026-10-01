import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import { normalizeMistake, type TopicMistake, type TopicMistakeWithContext } from '../domain/topic-mistake';

const MISTAKE_SELECT = 'id, topic_id, body, concept, task_id, source_daily_log_id, created_at, resolved_at';

const toMistake = (row: {
  id: string;
  topic_id: string;
  body: string;
  concept: string | null;
  task_id: string | null;
  source_daily_log_id: string | null;
  created_at: string;
  resolved_at: string | null;
}): TopicMistake => ({
  id: row.id,
  topicId: row.topic_id,
  body: row.body,
  concept: row.concept,
  taskId: row.task_id,
  fromCheckin: row.source_daily_log_id !== null,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

/** Enough of the topic, course and task to file and explain each entry on the notebook screen. */
const MISTAKE_WITH_CONTEXT = `${MISTAKE_SELECT}, topic:topics!topic_mistakes_topic_fk(title, course:courses!topics_course_fk(name, code)), task:tasks!topic_mistakes_task_fk(title)`;

export class TopicMistakeRepository extends BaseRepository {
  /** The whole book, newest first, grouped later by course and topic. */
  async listAll(includeResolved: boolean): Promise<TopicMistakeWithContext[]> {
    const query = this.db
      .from('topic_mistakes')
      .select(MISTAKE_WITH_CONTEXT)
      .order('created_at', { ascending: false })
      .limit(400);

    const rows = await this.execute(
      'topic_mistakes.listAll',
      includeResolved ? query : query.is('resolved_at', null),
    );
    return rows.map((row) => ({
      ...toMistake(row),
      topicTitle: row.topic.title,
      courseLabel: row.topic.course.code ?? row.topic.course.name,
      taskTitle: row.task?.title ?? null,
    }));
  }

  /** Entries for one topic, newest first; resolved ones only when asked for. */
  async listForTopic(topicId: string, includeResolved = false): Promise<TopicMistake[]> {
    const query = this.db
      .from('topic_mistakes')
      .select(MISTAKE_SELECT)
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false })
      .limit(includeResolved ? 50 : 10);
    const rows = await this.execute(
      'topic_mistakes.listForTopic',
      includeResolved ? query : query.is('resolved_at', null),
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

  /** "Yanlışlıkla işaretledim" / "yine takıldım" — back on the open list. */
  async reopen(mistakeId: string): Promise<void> {
    await this.execute(
      'topic_mistakes.reopen',
      this.db
        .from('topic_mistakes')
        .update({ resolved_at: null, resolved_by_daily_log_id: null })
        .eq('id', mistakeId)
        .select('id')
        .single(),
    );
  }

  /** Fixes the wording — the sentence is what gets read before the next round. */
  async update(mistakeId: string, body: string, concept: string | null): Promise<void> {
    const clean = normalizeMistake(body, concept);
    if (!clean) throw new AppError('validation', 'Takıldığın yeri en az iki harfle yaz.');
    await this.execute(
      'topic_mistakes.update',
      this.db
        .from('topic_mistakes')
        .update({ body: clean.body, concept: clean.concept })
        .eq('id', mistakeId)
        .select('id')
        .single(),
    );
  }

  async remove(mistakeId: string): Promise<void> {
    await this.execute(
      'topic_mistakes.remove',
      this.db.from('topic_mistakes').delete().eq('id', mistakeId).select('id').single(),
    );
  }

  async add(topicId: string, body: string, concept: string | null = null): Promise<void> {
    const userId = await this.requireUserId();
    const clean = normalizeMistake(body, concept);
    if (!clean) throw new AppError('validation', 'Takıldığın yeri en az iki harfle yaz.');
    await this.execute(
      'topic_mistakes.add',
      this.db
        .from('topic_mistakes')
        .insert({ user_id: userId, topic_id: topicId, body: clean.body, concept: clean.concept })
        .select('id')
        .single(),
    );
  }
}

export const topicMistakeRepository = new TopicMistakeRepository();
