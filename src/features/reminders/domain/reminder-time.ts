// When to actually ask "günün nasıl geçti?".
//
// A fixed 20:00 reminder is wrong for anyone whose week is not identical every
// day: it arrives mid-lab on Tuesday and three hours late on Saturday. The
// hours here are learned from when the student really studies — the end of
// their typical session, which is the moment the day's work is fresh and the
// check-in costs nothing to write.
export interface StudyMoment {
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  /** Hour of day the study session ended, in the device's own timezone. */
  hour: number;
}

export interface LearnedReminder {
  /** ISO weekday → hour the reminder should fire. */
  hourByWeekday: Record<number, number>;
  /** Weekdays whose hour came from real data rather than the fallback. */
  learnedWeekdays: number[];
  samples: number;
}

/** Reminders outside this range are no use to anyone. */
export const EARLIEST_HOUR = 17;
export const LATEST_HOUR = 23;
/** Below this, a weekday keeps the hour the student chose by hand. */
const MIN_OBSERVATIONS = 2;
/** Give the student a moment to finish before the phone buzzes. */
const GRACE_HOURS = 1;

const clampHour = (hour: number): number => Math.min(LATEST_HOUR, Math.max(EARLIEST_HOUR, hour));

/** The median resists one 03:00 night better than an average does. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export function learnReminderHours(moments: readonly StudyMoment[], fallbackHour: number): LearnedReminder {
  const byWeekday = new Map<number, number[]>();
  for (const moment of moments) {
    if (moment.weekday < 1 || moment.weekday > 7) continue;
    byWeekday.set(moment.weekday, [...(byWeekday.get(moment.weekday) ?? []), moment.hour]);
  }

  // A weekday with too little history borrows the overall rhythm before it
  // falls back to the hour the student picked.
  const allHours = moments.map((moment) => moment.hour);
  const overall = allHours.length >= MIN_OBSERVATIONS ? clampHour(median(allHours) + GRACE_HOURS) : null;

  const hourByWeekday: Record<number, number> = {};
  const learnedWeekdays: number[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const hours = byWeekday.get(weekday) ?? [];
    if (hours.length >= MIN_OBSERVATIONS) {
      hourByWeekday[weekday] = clampHour(median(hours) + GRACE_HOURS);
      learnedWeekdays.push(weekday);
    } else {
      hourByWeekday[weekday] = overall ?? clampHour(fallbackHour);
    }
  }

  return { hourByWeekday, learnedWeekdays, samples: moments.length };
}

/**
 * expo-notifications takes the platform weekday, where Sunday is 1 (both
 * `Calendar.DAY_OF_WEEK` on Android and Apple's `weekday` component).
 */
export const toNotificationWeekday = (isoWeekday: number): number => (isoWeekday === 7 ? 1 : isoWeekday + 1);

/** The moment a session ended, in local time, ready to be learned from. */
export function toStudyMoment(startedAt: string, minutes: number): StudyMoment {
  const ended = new Date(new Date(startedAt).getTime() + minutes * 60_000);
  const day = ended.getDay(); // 0 = Sunday, local time
  return { weekday: day === 0 ? 7 : day, hour: ended.getHours() };
}
