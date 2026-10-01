import type { IsoDate, StudyStep, TaskType } from '@contracts/enums.contract';
import type { ProgressCourse } from '@domain/progress';
import { BaseRepository } from '@shared/api/repository';
import { localDateOf } from '@shared/lib/date';

const STUDY_STEPS: readonly StudyStep[] = ['concept_note', 'feynman', 'quiz', 'advanced_problems'];
const isStudyStep = (type: TaskType): type is StudyStep => (STUDY_STEPS as readonly string[]).includes(type);

/**
 * Everything the trajectory screen needs, in three scoped reads.
 *
 * The heavy lifting is in `@domain/progress`; this only gathers rows and turns
 * task history into "which steps of this topic are done, and when was the last
 * of them finished".
 */
export class ProgressRepository extends BaseRepository {
  async loadCourses(today: IsoDate): Promise<ProgressCourse[]> {
    const [topics, tasks, exams, links] = await Promise.all([
      this.execute(
        'progress.topics',
        this.db
          .from('topics')
          .select('id, course_id, title, course:courses!topics_course_fk(id, name, code)')
          .limit(400),
      ),
      this.execute(
        'progress.tasks',
        this.db
          .from('tasks')
          .select('topic_id, type, status, completed_at, completed_count, correct_count')
          .eq('status', 'completed')
          .limit(1000),
      ),
      this.execute(
        'progress.exams',
        this.db
          .from('exams')
          .select('id, course_id, title, exam_date, kind')
          .gte('exam_date', today)
          .in('kind', ['midterm', 'final', 'other'])
          .order('exam_date', { ascending: true }),
      ),
      this.execute('progress.examTopics', this.db.from('exam_topics').select('exam_id, topic_id')),
    ]);

    const stepsByTopic = new Map<string, Set<StudyStep>>();
    const lastStepAt = new Map<string, string>();
    const accuracyByCourse = new Map<string, { correct: number; attempted: number }>();
    const courseOfTopic = new Map(topics.map((topic) => [topic.id, topic.course_id]));

    for (const task of tasks) {
      if (task.correct_count !== null && task.completed_count > 0) {
        const courseId = courseOfTopic.get(task.topic_id);
        if (courseId) {
          const current = accuracyByCourse.get(courseId) ?? { correct: 0, attempted: 0 };
          current.correct += task.correct_count;
          current.attempted += task.completed_count;
          accuracyByCourse.set(courseId, current);
        }
      }

      if (!isStudyStep(task.type)) continue;
      const steps = stepsByTopic.get(task.topic_id) ?? new Set<StudyStep>();
      steps.add(task.type);
      stepsByTopic.set(task.topic_id, steps);

      // The loop is finished when its last step is: that is the date the pace
      // is measured from.
      const finishedOn = task.completed_at ? localDateOf(task.completed_at) : undefined;
      if (finishedOn && (lastStepAt.get(task.topic_id) ?? '') < finishedOn) {
        lastStepAt.set(task.topic_id, finishedOn);
      }
    }

    const topicsByExam = new Map<string, string[]>();
    for (const link of links) {
      topicsByExam.set(link.exam_id, [...(topicsByExam.get(link.exam_id) ?? []), link.topic_id]);
    }

    const nextExamByCourse = new Map<string, { title: string; date: IsoDate; topicIds: string[] }>();
    for (const exam of exams) {
      if (nextExamByCourse.has(exam.course_id)) continue; // already the earliest
      nextExamByCourse.set(exam.course_id, {
        title: exam.title,
        date: exam.exam_date,
        topicIds: topicsByExam.get(exam.id) ?? [],
      });
    }

    const byCourse = new Map<string, ProgressCourse>();
    for (const topic of topics) {
      const course = byCourse.get(topic.course_id) ?? {
        courseId: topic.course_id,
        courseLabel: topic.course.code ?? topic.course.name,
        topics: [],
        nextExam: nextExamByCourse.get(topic.course_id) ?? null,
        accuracy: accuracyByCourse.get(topic.course_id) ?? null,
      };
      byCourse.set(topic.course_id, {
        ...course,
        topics: [
          ...course.topics,
          {
            id: topic.id,
            completedSteps: [...(stepsByTopic.get(topic.id) ?? [])],
            finishedOn: lastStepAt.get(topic.id) ?? null,
          },
        ],
      });
    }

    return [...byCourse.values()].sort((a, b) => a.courseLabel.localeCompare(b.courseLabel, 'tr'));
  }
}

export const progressRepository = new ProgressRepository();
