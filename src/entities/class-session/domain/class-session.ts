import type { CourseRef } from '@entities/course';

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'Pzt',
  2: 'Sal',
  3: 'Çar',
  4: 'Per',
  5: 'Cum',
  6: 'Cmt',
  7: 'Paz',
};

export interface ClassSession {
  id: string;
  courseId: string;
  weekday: Weekday;
  /** Labs are the student's own business: the planner never touches them. */
  isLab: boolean;
  /** `HH:MM` in the student's own timezone. */
  startTime: string;
  endTime: string;
  location: string | null;
  course: CourseRef;
}

export interface NewClassSession {
  courseId: string;
  weekday: Weekday;
  isLab: boolean;
  startTime: string;
  endTime: string;
  location: string | null;
}

/** `09:00:00` → `09:00`, and anything already short stays as it is. */
export const toShortTime = (time: string): string => time.slice(0, 5);

export const sessionMinutes = (session: Pick<ClassSession, 'startTime' | 'endTime'>): number => {
  const minutes = (time: string) => {
    const [hours, mins] = toShortTime(time).split(':');
    return Number(hours) * 60 + Number(mins);
  };
  return Math.max(0, minutes(session.endTime) - minutes(session.startTime));
};

export const isWeekday = (value: number): value is Weekday => value >= 1 && value <= 7;
