import type { Exam } from '@entities/exam';
import { useEffect } from 'react';
import { scheduleExamReminders } from '../data/notifications';
import { useRemindersStore } from './reminders.store';

const DAYS_BEFORE = [7, 3, 1];

/**
 * Keeps exam notifications in step with the exams the app has loaded.
 * Rescheduling is idempotent: the previous set is cancelled first.
 */
export function useExamReminderSync(exams: readonly Exam[]): void {
  const enabled = useRemindersStore((s) => s.examsEnabled);
  const signature = exams.map((e) => `${e.id}:${e.examDate}`).join('|');

  useEffect(() => {
    if (!enabled) return;
    const reminders = exams.flatMap((exam) =>
      DAYS_BEFORE.map((daysBefore) => ({
        examId: exam.id,
        title: exam.title,
        courseLabel: exam.course.code ?? exam.course.name,
        examDate: exam.examDate,
        daysBefore,
      })),
    );
    void scheduleExamReminders(reminders);
    // `signature` captures the exam data the schedule depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);
}
