import type { IsoDate } from '@contracts/enums.contract';
import { courseAccent, courseLabel } from '@entities/course';
import { daysUntil, type Exam, examUrgency, type ExamUrgency } from '../domain/exam';

export interface ExamChipModel {
  id: string;
  title: string;
  courseLabel: string;
  accent: string;
  countdown: string;
  urgency: ExamUrgency;
}

export function toExamChipModel(exam: Exam, today: IsoDate): ExamChipModel {
  const days = daysUntil(exam, today);
  return {
    id: exam.id,
    title: exam.title,
    courseLabel: courseLabel(exam.course),
    accent: courseAccent(exam.course),
    countdown: days === 0 ? 'Bugün' : days === 1 ? 'Yarın' : `${days} gün`,
    urgency: examUrgency(days),
  };
}
