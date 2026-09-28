import type { IsoDate } from '@contracts/enums.contract';
import { toCourseRef } from '@entities/course';
import { BaseRepository } from '@shared/api/repository';
import type { Exam, NewExam } from '../domain/exam';

const EXAM_SELECT = 'id, kind, title, exam_date, start_time, course:courses!exams_course_fk(id, name, code, color_hex)';

export class ExamRepository extends BaseRepository {
  async create(exam: NewExam): Promise<void> {
    const userId = await this.requireUserId();
    await this.execute(
      'exams.create',
      this.db
        .from('exams')
        .insert({
          user_id: userId,
          course_id: exam.courseId,
          kind: exam.kind,
          title: exam.title,
          exam_date: exam.examDate,
        })
        .select('id')
        .single(),
    );
  }

  async updateDate(examId: string, examDate: string): Promise<void> {
    await this.execute(
      'exams.updateDate',
      this.db.from('exams').update({ exam_date: examDate }).eq('id', examId).select('id').single(),
    );
  }

  async remove(examId: string): Promise<void> {
    await this.execute('exams.remove', this.db.from('exams').delete().eq('id', examId).select('id').single());
  }

  /** Every exam of one course, past ones included (the course page shows both). */
  async listForCourse(courseId: string): Promise<Exam[]> {
    const rows = await this.execute(
      'exams.listForCourse',
      this.db
        .from('exams')
        .select(EXAM_SELECT)
        .eq('course_id', courseId)
        .order('exam_date', { ascending: true }),
    );
    return rows.map(toExam);
  }

  async listUpcoming(today: IsoDate, limit = 8): Promise<Exam[]> {
    const rows = await this.execute(
      'exams.listUpcoming',
      this.db
        .from('exams')
        .select(EXAM_SELECT)
        .gte('exam_date', today)
        .order('exam_date', { ascending: true })
        .limit(limit),
    );
    return rows.map(toExam);
  }
}

type ExamRow = {
  id: string;
  kind: Exam['kind'];
  title: string;
  exam_date: string;
  start_time: string | null;
  course: { id: string; name: string; code: string | null; color_hex: string | null };
};

const toExam = (row: ExamRow): Exam => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  examDate: row.exam_date,
  startTime: row.start_time,
  course: toCourseRef(row.course),
});

export const examRepository = new ExamRepository();
