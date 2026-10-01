import type { IsoDate } from '@contracts/enums.contract';
import { BaseRepository } from '@shared/api/repository';
import { addDays, todayLocal } from '@shared/lib/date';
import type { Task, TaskPatch, TaskStatus } from '../domain/task.types';
import { TASK_SELECT, toTask } from './task.mapper';

/** Overdue work older than this is assumed abandoned and left to the weekly planner. */
const OVERDUE_LOOKBACK_DAYS = 14;
/** How far ahead homework is fetched, so its daily share can be worked out. */
const DEADLINE_LOOKAHEAD_DAYS = 7;

/** A finished task, as little of it as the capacity learner needs. */
export interface FinishedTaskRecord {
  id: string;
  parentTaskId: string | null;
  completedAt: string;
  estimatedMinutes: number | null;
}

export interface StatusChangeOptions {
  /** The student's own calendar day; a replayed offline tap keeps the day it was made on. */
  on?: IsoDate;
  /** 1–5, when the student rated how it went. */
  confidence?: number | null;
}

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

  /** Every task of one topic, newest first — the topic's own screen. */
  async listForTopic(topicId: string, limit = 40): Promise<Task[]> {
    const rows = await this.execute(
      'tasks.listForTopic',
      this.db
        .from('tasks')
        .select(TASK_SELECT)
        .eq('topic_id', topicId)
        .not('status', 'eq', 'rescheduled')
        .order('due_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return rows.map(toTask);
  }

  /**
   * Everything finished since a day — the capacity learner's raw material.
   * Paged, because six busy weeks are more than one response holds.
   */
  async listCompletedSince(since: IsoDate): Promise<FinishedTaskRecord[]> {
    const PAGE = 1000;
    const result: FinishedTaskRecord[] = [];
    for (let page = 0; page < 5; page++) {
      const rows = await this.execute(
        'tasks.listCompletedSince',
        this.db
          .from('tasks')
          .select('id, parent_task_id, completed_at, estimated_minutes')
          .eq('status', 'completed')
          // A day early: the local-calendar cut is made by the caller.
          .gte('completed_at', `${addDays(since, -1)}T00:00:00Z`)
          .order('completed_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * PAGE, (page + 1) * PAGE - 1),
      );
      for (const row of rows) {
        if (row.completed_at === null) continue;
        result.push({
          id: row.id,
          parentTaskId: row.parent_task_id,
          completedAt: row.completed_at,
          estimatedMinutes: row.estimated_minutes,
        });
      }
      if (rows.length < PAGE) break;
    }
    return result;
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

  async remove(taskId: string): Promise<void> {
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
   * Every status change the student makes goes through the database function,
   * not a bare UPDATE: finishing (or failing) work there also counts as a
   * review of its topic, so the spaced-repetition schedule moves with it — and
   * taking the tick back takes the review back.
   */
  async updateStatus(taskId: string, status: TaskStatus, options: StatusChangeOptions = {}): Promise<Task> {
    await this.execute(
      'tasks.updateStatus',
      this.db.rpc('set_task_status', {
        p_task_id: taskId,
        p_status: status,
        p_on: options.on ?? todayLocal(),
        ...(options.confidence === undefined || options.confidence === null
          ? {}
          : { p_confidence: options.confidence }),
      }),
    );
    return this.getById(taskId);
  }
}

export const taskRepository = new TaskRepository();
