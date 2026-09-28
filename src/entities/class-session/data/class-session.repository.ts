import { toCourseRef } from '@entities/course';
import { BaseRepository } from '@shared/api/repository';
import { isWeekday, toShortTime, type ClassSession, type NewClassSession } from '../domain/class-session';

const SESSION_SELECT =
  'id, course_id, weekday, start_time, end_time, location, is_lab, course:courses!class_sessions_course_fk(id, name, code, color_hex)';

export class ClassSessionRepository extends BaseRepository {
  /** The whole timetable, ordered the way it is read: day by day, hour by hour. */
  async list(): Promise<ClassSession[]> {
    const rows = await this.execute(
      'class_sessions.list',
      this.db
        .from('class_sessions')
        .select(SESSION_SELECT)
        .order('weekday', { ascending: true })
        .order('start_time', { ascending: true }),
    );

    return rows.flatMap((row) =>
      isWeekday(row.weekday)
        ? [
            {
              id: row.id,
              courseId: row.course_id,
              weekday: row.weekday,
              startTime: toShortTime(row.start_time),
              endTime: toShortTime(row.end_time),
              location: row.location,
              isLab: row.is_lab,
              course: toCourseRef(row.course),
            },
          ]
        : [],
    );
  }

  async create(session: NewClassSession): Promise<void> {
    const userId = await this.requireUserId();
    await this.execute(
      'class_sessions.create',
      this.db
        .from('class_sessions')
        .insert({
          user_id: userId,
          course_id: session.courseId,
          weekday: session.weekday,
          start_time: session.startTime,
          end_time: session.endTime,
          location: session.location,
          is_lab: session.isLab,
        })
        .select('id')
        .single(),
    );
  }

  async remove(sessionId: string): Promise<void> {
    await this.execute(
      'class_sessions.remove',
      this.db.from('class_sessions').delete().eq('id', sessionId).select('id').single(),
    );
  }
}

export const classSessionRepository = new ClassSessionRepository();
