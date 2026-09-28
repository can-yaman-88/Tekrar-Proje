import { BaseRepository } from '@shared/api/repository';
import type { TaskNote } from '../domain/task-note';

const NOTE_SELECT = 'id, task_id, body, created_at';

export class TaskNoteRepository extends BaseRepository {
  async listForTask(taskId: string): Promise<TaskNote[]> {
    const rows = await this.execute(
      'task_notes.listForTask',
      this.db.from('task_notes').select(NOTE_SELECT).eq('task_id', taskId).order('created_at', { ascending: false }),
    );
    return rows.map((row) => ({ id: row.id, taskId: row.task_id, body: row.body, createdAt: row.created_at }));
  }

  async create(taskId: string, body: string): Promise<TaskNote> {
    const userId = await this.requireUserId();
    const row = await this.execute(
      'task_notes.create',
      this.db.from('task_notes').insert({ user_id: userId, task_id: taskId, body }).select(NOTE_SELECT).single(),
    );
    return { id: row.id, taskId: row.task_id, body: row.body, createdAt: row.created_at };
  }

  async remove(noteId: string): Promise<void> {
    await this.execute(
      'task_notes.remove',
      this.db.from('task_notes').delete().eq('id', noteId).select('id').single(),
    );
  }
}

export const taskNoteRepository = new TaskNoteRepository();
