import { classSessionKeys, classSessionRepository, WEEKDAY_SHORT, type ClassSession } from '@entities/class-session';
import type { CourseRef } from '@entities/course';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { looksLikeLab, matchCourse, readWeeklySlots } from '../data/calendar-import';

export interface ImportResult {
  added: number;
  skipped: number;
  unmatched: string[];
}

/**
 * Imports the weekly timetable from the device calendar. Only entries that map
 * to an existing course are written; everything else is reported back so the
 * student can add it by hand instead of getting a wrong guess.
 */
export function useCalendarImport(courses: readonly CourseRef[], existing: readonly ClassSession[]) {
  const queryClient = useQueryClient();

  const mutation = useMutation<ImportResult, Error>({
    mutationFn: async () => {
      const slots = await readWeeklySlots();
      const already = new Set(existing.map((s) => `${s.courseId}|${s.weekday}|${s.startTime}`));
      const unmatched: string[] = [];
      let added = 0;
      let skipped = 0;

      for (const slot of slots) {
        const course = matchCourse(slot.title, courses);
        if (!course) {
          if (!unmatched.includes(slot.title)) unmatched.push(slot.title);
          continue;
        }
        if (already.has(`${course.id}|${slot.weekday}|${slot.startTime}`)) {
          skipped++;
          continue;
        }
        await classSessionRepository.create({
          courseId: course.id,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isLab: looksLikeLab(slot.title),
          location: slot.location,
        });
        already.add(`${course.id}|${slot.weekday}|${slot.startTime}`);
        added++;
      }

      return { added, skipped, unmatched: unmatched.slice(0, 8) };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: classSessionKeys.all });
      showToast(
        result.added === 0
          ? 'Takvimde eşleşen ders bulunamadı.'
          : `${result.added} ders saati eklendi${result.skipped > 0 ? `, ${result.skipped} tanesi zaten vardı` : ''}.`,
        result.added === 0 ? 'info' : 'success',
      );
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  return {
    importFromCalendar: () => mutation.mutate(),
    isImporting: mutation.isPending,
    result: mutation.data ?? null,
    weekdayLabels: WEEKDAY_SHORT,
  };
}

export type CalendarImportController = ReturnType<typeof useCalendarImport>;
