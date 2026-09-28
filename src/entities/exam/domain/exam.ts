import type { ExamKind, IsoDate } from '@contracts/enums.contract';
import type { CourseRef } from '@entities/course';
import { diffInDays } from '@shared/lib/date';

export interface Exam {
  id: string;
  kind: ExamKind;
  title: string;
  examDate: IsoDate;
  startTime: string | null;
  course: CourseRef;
}

export interface NewExam {
  courseId: string;
  kind: ExamKind;
  title: string;
  examDate: IsoDate;
}

/** Labs are never planned, so they are not offered when adding an exam by hand. */
export const SELECTABLE_EXAM_KINDS = ['midterm', 'final', 'quiz', 'other'] as const;

export const EXAM_KIND_LABEL: Record<ExamKind, string> = {
  midterm: 'Vize',
  final: 'Final',
  quiz: 'Quiz',
  lab: 'Lab',
  other: 'Diğer',
};

export type ExamUrgency = 'critical' | 'soon' | 'later';

export const daysUntil = (exam: Pick<Exam, 'examDate'>, today: IsoDate): number => diffInDays(today, exam.examDate);

export function examUrgency(days: number): ExamUrgency {
  if (days <= 3) return 'critical';
  if (days <= 10) return 'soon';
  return 'later';
}

/** Days until the nearest upcoming exam for each course id. */
export function nextExamDaysByCourse(exams: readonly Exam[], today: IsoDate): Map<string, number> {
  const result = new Map<string, number>();
  for (const exam of exams) {
    const days = daysUntil(exam, today);
    const current = result.get(exam.course.id);
    if (days >= 0 && (current === undefined || days < current)) result.set(exam.course.id, days);
  }
  return result;
}
