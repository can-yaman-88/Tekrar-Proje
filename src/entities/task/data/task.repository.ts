import type { IsoDate } from '@contracts/enums.contract';
import { BaseRepository } from '@shared/api/repository';
import { AppError } from '@shared/lib/errors';
import { addDays } from '@shared/lib/date';
import type { Task, TaskPatch, TaskStatus } from '../domain/task.types';
import { TASK_SELECT, toTask } from './task.mapper';

/** Overdue work older than this is assumed abandoned and left to the weekly planner. */
const OVERDUE_LOOKBACK_DAYS = 14;
/** How far ahead homework is fetched, so its daily share can be worked out. */
const DEADLINE_LOOKAHEAD_DAYS = 7;

export class TaskRepository extends BaseRepository {
  /**
   * Everything the day's board needs: work due today or overdue, today's
   * finished work (so progress still shows), and homework whose deadline is
   * still ahead — that last group is what the daily share is carved from.
   */
  async listMission(today: IsoDate): Promise<Task[]> {
    const rows = await this.execute(
      'tasks.listMission',
      this.db
        .from('tasks')
        .select(TASK_SELECT)
        .gte('due_date', addDays(today, -OVERDUE_LOOKBACK_DAYS))
        .lte('due_date', addDays(today, DEADLINE_LOOKAHEAD_DAYS))
        .or(
          [
            `and(due_date.lte.${today},status.in.(pending,in_progress))`,
            `and(due_date.eq.${today},status.in.(completed,failed))`,
            `and(due_date.gt.${today},status.in.(pending,in_progress),source.in.(homework,ai_attachment))`,
          ].join(','),
        )
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),
    );
    return rows.map(toTask);
  }

  /** The steps of one task, oldest first — the order they were written in. */
  async listSubtasks(parentId: string): Promise<Task[]> {
    const rows = await this.execute(
      'tasks.listSubtasks',
      this.db
        .from('tasks')
        .select(TASK_SELECT)
        .eq('parent_task_id', parentId)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),
    );
    return rows.map(toTask);
  }

  /**
   * Adds a step to a task. The parent's own status is maintained by the
   * database, so nothing here has to keep the two in sync.
   */
  async addSubtask(
    parent: Pick<Task, 'id' | 'topic' | 'type' | 'source' | 'dueDate'>,
    step: { title: string; estimatedMinutes: number | null; targetCount: number | null; dueDate?: IsoDate },
  ): Promise<Task> {
    const userId = await this.requireUserId();
    const row = await this.execute(
      'tasks.addSubtask',
      this.db
        .from('tasks')
        .insert({
          user_id: userId,
          topic_id: parent.topic.id,
          parent_task_id: parent.id,
          type: parent.type,
          source: parent.source,
          title: step.title,
          estimated_minutes: step.estimatedMinutes,
          target_count: step.targetCount,
          due_date: step.dueDate ?? parent.dueDate,
        })
        .select(TASK_SELECT)
        .single(),
    );
    return toTask(row);
  }

  async getById(taskId: string): Promise<Task> {
    const row = await this.execute(
      'tasks.getById',
      this.db.from('tasks').select(TASK_SELECT).eq('id', taskId).single(),
    );
    return toTask(row);
  }

  /** Finished work, newest first — the History screen. */
  async listFinished(limit = 100): Promise<Task[]> {
    const rows = await this.execute(
      'tasks.listFinished',
      this.db
        .from('tasks')
        .select(TASK_SELECT)
        .in('status', ['completed', 'failed', 'skipped'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('due_date', { ascending: false })
        .limit(limit),
    );
    return rows.map(toTask);
  }

  /**
   * Open work due before `before` — the pile that makes the app unpleasant.
   *
   * Group tasks are represented by their steps, never by both: a parent is a
   * container, and closing it while its steps stay open would only have the
   * database put it back the next time a step moved.
   */
  async listBacklog(before: IsoDate, limit = 60): Promise<Task[]> {
    const rows = await this.execute(
      'tasks.listBacklog',
      this.db
        .from('tasks')
        .select(TASK_SELECT)
        .in('status', ['pending', 'in_progress', 'rescheduled'])
        .lt('due_date', before)
        .order('due_date', { ascending: true })
        .limit(limit),
    );
    if (rows.length === 0) return [];

    const children = await this.execute(
      'tasks.backlogChildren',
      this.db
        .from('tasks')
        .select('parent_task_id')
        .in(
          'parent_task_id',
          rows.map((row) => row.id),
        ),
    );
    const parents = new Set(children.map((child) => child.parent_task_id));
    return rows.filter((row) => !parents.has(row.id)).map(toTask);
  }

  /** Closes several tasks at once: they were not done and will not be. */
  async skipMany(taskIds: readonly string[]): Promise<number> {
    if (taskIds.length === 0) return 0;
    const rows = await this.execute(
      'tasks.skipMany',
      this.db.from('tasks').update({ status: 'skipped' }).in('id', [...taskIds]).select('id'),
    );
    return rows.length;
  }

  /**
   * Moves a group of tasks onto one day; the caller decides the grouping.
   *
   * Progress is left alone — a task the student has already started stays
   * "devam ediyor". Only work the planner had set aside as `rescheduled` is
   * reopened, because that status is invisible on the daily board.
   */
  async moveMany(taskIds: readonly string[], dueDate: IsoDate): Promise<number> {
    if (taskIds.length === 0) return 0;
    const rows = await this.execute(
      'tasks.moveMany',
      this.db.from('tasks').update({ due_date: dueDate }).in('id', [...taskIds]).select('id'),
    );
    await this.execute(
      'tasks.reopenRescheduled',
      this.db
        .from('tasks')
        .update({ status: 'pending' })
        .in('id', [...taskIds])
        .eq('status', 'rescheduled')
        .select('id'),
    );
    return rows.length;
  }

  /**
   * Gathers a topic's concept page and Feynman page under one learning task.
   *
   * One RPC rather than an insert plus an update: a container that exists
   * without its steps is a card on the board that means nothing, and the
   * student would have no way to undo the half of it that landed. The database
   * re-checks every condition — ownership, open, untouched, one topic — because
   * the device is not where that decision is safe to make.
   */
  async groupIntoLearningTask(input: {
    childIds: readonly string[];
    title: string;
    dueDate: IsoDate;
  }): Promise<string> {
    const id = await this.execute(
      'tasks.groupIntoLearningTask',
      this.db.rpc('group_learning_pair', {
        p_child_ids: [...input.childIds],
        p_title: input.title,
        p_due_date: input.dueDate,
      }),
    );
    return id;
  }

  async update(taskId: string, patch: TaskPatch): Promise<Task> {
    const row = await this.execute(
      'tasks.update',
      this.db
        .from('tasks')
        .update({
          title: patch.title,
          type: patch.type,
          instructions: patch.instructions,
          due_date: patch.dueDate,
          starts_on: patch.startsOn,
          day_allocations: patch.dayAllocations,
          target_count: patch.targetCount,
          estimated_minutes: patch.estimatedMinutes,
          confidence_level: patch.confidenceLevel,
          completed_count: patch.completedCount,
        })
        .eq('id', taskId)
        .select(TASK_SELECT)
        .single(),
    );
    return toTask(row);
  }

  /**
   * Deletes one task.
   *
   * A task with steps is refused rather than deleted: the foreign key cascades,
   * so removing a learning task or a group homework would take its steps with
   * it — including the one the student has already worked through. Emptying the
   * group first is a decision, and it is theirs to make step by step.
   */
  async remove(taskId: string): Promise<void> {
    const steps = await this.execute(
      'tasks.removeStepCheck',
      this.db.from('tasks').select('id').eq('parent_task_id', taskId).limit(1),
    );
    if (steps.length > 0) {
      throw new AppError('validation', 'Bu görevin adımları var; önce adımlarını sil.');
    }
    await this.execute('tasks.remove', this.db.from('tasks').delete().eq('id', taskId).select('id').single());
  }

  /** Everything due inside one week, closed work included: the week view. */
  async listBetween(from: IsoDate, to: IsoDate): Promise<Task[]> {
    const rows = await this.execute(
      'tasks.listBetween',
      this.db
        .from('tasks')
        .select(TASK_SELECT)
        .gte('due_date', from)
        .lte('due_date', to)
        .not('status', 'in', '(rescheduled,skipped)')
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: true }),
    );
    return rows.map(toTask);
  }

  /**
   * "Grubu dağıt": every step becomes a task of its own, and the empty container
   * goes — deleted when nothing was done on it, set aside when something was.
   */
  async ungroup(parentId: string): Promise<{ freed: number; container: 'removed' | 'set_aside' | 'kept' }> {
    const result = await this.execute('tasks.ungroup', this.db.rpc('ungroup_task', { p_parent_id: parentId }));
    const payload = result as { freed?: number; container?: 'removed' | 'set_aside' | 'kept' } | null;
    return { freed: payload?.freed ?? 0, container: payload?.container ?? 'kept' };
  }

  /** "Acil" — the same flag a report sets with "fizik ödevi acil". */
  async setPriority(taskId: string, isPriority: boolean): Promise<Task> {
    const row = await this.execute(
      'tasks.setPriority',
      this.db.from('tasks').update({ is_priority: isPriority }).eq('id', taskId).select(TASK_SELECT).single(),
    );
    return toTask(row);
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<Task> {
    const row = await this.execute(
      'tasks.updateStatus',
      this.db
        .from('tasks')
        .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
        .eq('id', taskId)
        .select(TASK_SELECT)
        .single(),
    );
    return toTask(row);
  }
}

export const taskRepository = new TaskRepository();
