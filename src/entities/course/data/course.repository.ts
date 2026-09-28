import { BaseRepository } from '@shared/api/repository';
import type { CourseRef } from '../domain/course';
import { toCourseRef } from './course.mapper';

export interface CourseWithStats extends CourseRef {
  topicCount: number;
  nextExam: { title: string; examDate: string } | null;
}

export class CourseRepository extends BaseRepository {
  /** Deleting a course takes its topics, exams, tasks and timetable rows with it. */
  async remove(courseId: string): Promise<void> {
    await this.execute(
      'courses.remove',
      this.db.from('courses').delete().eq('id', courseId).select('id').single(),
    );
  }

  async getById(courseId: string): Promise<CourseRef> {
    const row = await this.execute(
      'courses.getById',
      this.db.from('courses').select('id, name, code, color_hex').eq('id', courseId).single(),
    );
    return toCourseRef(row);
  }

  /** Courses plus the counts the Courses screen shows. */
  async listWithStats(today: string): Promise<CourseWithStats[]> {
    const [courses, topics, exams] = await Promise.all([
      this.execute(
        'courses.list',
        this.db.from('courses').select('id, name, code, color_hex').order('name', { ascending: true }),
      ),
      this.execute('courses.topicIds', this.db.from('topics').select('id, course_id')),
      this.execute(
        'courses.nextExams',
        this.db
          .from('exams')
          .select('course_id, title, exam_date')
          .gte('exam_date', today)
          .order('exam_date', { ascending: true }),
      ),
    ]);

    const topicCounts = new Map<string, number>();
    for (const topic of topics) topicCounts.set(topic.course_id, (topicCounts.get(topic.course_id) ?? 0) + 1);

    const nextExams = new Map<string, { title: string; examDate: string }>();
    for (const exam of exams) {
      if (!nextExams.has(exam.course_id)) nextExams.set(exam.course_id, { title: exam.title, examDate: exam.exam_date });
    }

    return courses.map((row) => ({
      ...toCourseRef(row),
      topicCount: topicCounts.get(row.id) ?? 0,
      nextExam: nextExams.get(row.id) ?? null,
    }));
  }
}

export const courseRepository = new CourseRepository();
