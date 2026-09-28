import { BaseRepository } from '@shared/api/repository';
import { addDays } from '@shared/lib/date';
import { elapsedMinutes, MAX_SESSION_MINUTES, type MeasuredWork, type TaskSession } from '../domain/task-session';

const SESSION_SELECT = 'id, task_id, started_at, ended_at, minutes';

const toSession = (row: {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
}): TaskSession => ({
  id: row.id,
  taskId: row.task_id,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  minutes: row.minutes,
});

export class TaskSessionRepository extends BaseRepository {
  /** The clock that is currently running, if any. At most one can exist. */
  async findRunning(): Promise<TaskSession | null> {
    const rows = await this.execute(
      'task_sessions.findRunning',
      this.db.from('task_sessions').select(SESSION_SELECT).is('ended_at', null).limit(1),
    );
    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async listForTask(taskId: string): Promise<TaskSession[]> {
    const rows = await this.execute(
      'task_sessions.listForTask',
      this.db
        .from('task_sessions')
        .select(SESSION_SELECT)
        .eq('task_id', taskId)
        .order('started_at', { ascending: false }),
    );
    return rows.map(toSession);
  }

  /** Closed sessions since `from`, for the capacity learner and the weekly summary. */
  async listSince(from: string): Promise<TaskSession[]> {
    const rows = await this.execute(
      'task_sessions.listSince',
      this.db
        .from('task_sessions')
        .select(SESSION_SELECT)
        .gte('started_at', `${from}T00:00:00`)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false }),
    );
    return rows.map(toSession);
  }

  /**
   * @param startedAt when the clock was really started. Sent explicitly so a
   *        mutation replayed from the offline queue keeps the true time
   *        instead of the moment it finally reached the server.
   */
  /** Closed sessions with the task they belong to — estimate-vs-actual lives here. */
  async listMeasuredWork(from: string): Promise<MeasuredWork[]> {
    const rows = await this.execute(
      'task_sessions.listMeasuredWork',
      this.db
        .from('task_sessions')
        .select('id, task_id, started_at, minutes, task:tasks!task_sessions_task_fk(type, estimated_minutes)')
        .gte('started_at', `${from}T00:00:00`)
        .not('minutes', 'is', null)
        .order('started_at', { ascending: false }),
    );
    return rows.flatMap((row) =>
      row.task && row.minutes !== null
        ? [
            {
              sessionId: row.id,
              taskId: row.task_id,
              taskType: row.task.type,
              startedAt: row.started_at,
              minutes: row.minutes,
              estimatedMinutes: row.task.estimated_minutes,
            },
          ]
        : [],
    );
  }

  async start(taskId: string, startedAt: string = new Date().toISOString()): Promise<TaskSession> {
    const userId = await this.requireUserId();
    // A forgotten clock from another task would block the insert, so it is
    // closed first — at whatever it measured.
    const running = await this.findRunning();
    if (running) await this.stop(running.id);

    const row = await this.execute(
      'task_sessions.start',
      this.db
        .from('task_sessions')
        .insert({ user_id: userId, task_id: taskId, started_at: startedAt })
        .select(SESSION_SELECT)
        .single(),
    );
    return toSession(row);
  }

  async stop(sessionId: string, minutesOverride?: number): Promise<TaskSession> {
    const rows = await this.execute(
      'task_sessions.stopRead',
      this.db.from('task_sessions').select(SESSION_SELECT).eq('id', sessionId).limit(1),
    );
    const current = rows[0];
    if (!current) throw new Error('Zamanlayıcı bulunamadı.');
    if (current.ended_at) return toSession(current);

    const measured = minutesOverride ?? elapsedMinutes(current.started_at);
    const minutes = Math.min(MAX_SESSION_MINUTES, Math.max(0, Math.round(measured)));
    const row = await this.execute(
      'task_sessions.stop',
      this.db
        .from('task_sessions')
        .update({ ended_at: new Date().toISOString(), minutes })
        .eq('id', sessionId)
        .select(SESSION_SELECT)
        .single(),
    );
    return toSession(row);
  }

  /** Time the student enters by hand, for work done away from the app. */
  async logManual(taskId: string, minutes: number): Promise<TaskSession> {
    const userId = await this.requireUserId();
    const safe = Math.min(MAX_SESSION_MINUTES, Math.max(1, Math.round(minutes)));
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - safe * 60_000);
    const row = await this.execute(
      'task_sessions.logManual',
      this.db
        .from('task_sessions')
        .insert({
          user_id: userId,
          task_id: taskId,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          minutes: safe,
        })
        .select(SESSION_SELECT)
        .single(),
    );
    return toSession(row);
  }

  async remove(sessionId: string): Promise<void> {
    await this.execute(
      'task_sessions.remove',
      this.db.from('task_sessions').delete().eq('id', sessionId).select('id').single(),
    );
  }

  /** Convenience for callers that think in weeks rather than dates. */
  static windowStart(today: string, weeks: number): string {
    return addDays(today, -weeks * 7);
  }
}

export const taskSessionRepository = new TaskSessionRepository();
