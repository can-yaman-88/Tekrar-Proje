import {
  sessionMinutes,
  useClassSchedule,
  WEEKDAY_LABEL,
  WEEKDAYS,
  type ClassSession,
  type ClassSessionRowModel,
  type Weekday,
} from '@entities/class-session';
import { courseAccent, useCourses } from '@entities/course';
import { useCalendarImport, useScheduleEditor } from '@features/class-schedule';
import { useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useMemo } from 'react';

export interface ScheduleDay {
  weekday: Weekday;
  label: string;
  totalLabel: string | null;
  sessions: ClassSessionRowModel[];
}

const toRowModel = (session: ClassSession): ClassSessionRowModel => ({
  id: session.id,
  courseLabel: session.course.code ?? session.course.name,
  timeRange: `${session.startTime} – ${session.endTime}`,
  isLab: session.isLab,
  location: session.location,
  accent: courseAccent(session.course),
});

export function useClassScheduleScreen() {
  const today = useToday();
  const scheduleQuery = useClassSchedule();
  const coursesQuery = useCourses(today);
  const courses = useMemo(() => coursesQuery.data ?? [], [coursesQuery.data]);
  const editor = useScheduleEditor(courses[0]?.id ?? null);
  const calendarImport = useCalendarImport(courses, scheduleQuery.data ?? []);

  const days = useMemo<ScheduleDay[]>(() => {
    const sessions = scheduleQuery.data ?? [];
    return WEEKDAYS.map((weekday) => {
      const ofDay = sessions.filter((session) => session.weekday === weekday);
      const minutes = ofDay.reduce((sum, session) => sum + sessionMinutes(session), 0);
      return {
        weekday,
        label: WEEKDAY_LABEL[weekday],
        totalLabel: minutes === 0 ? null : `${Math.round((minutes / 60) * 10) / 10} saat`,
        sessions: ofDay.map(toRowModel),
      };
    });
  }, [scheduleQuery.data]);

  const totalSessions = (scheduleQuery.data ?? []).length;

  return {
    isLoading: scheduleQuery.isPending && scheduleQuery.data === undefined,
    error: scheduleQuery.data === undefined && scheduleQuery.isError ? describeError(scheduleQuery.error) : null,
    retry: () => void scheduleQuery.refetch(),
    days,
    totalSessions,
    courses,
    editor,
    calendarImport,
  };
}
