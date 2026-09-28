import { useSessionsSince } from '@entities/task-session';
import { addDays, todayLocal } from '@shared/lib/date';
import { useEffect, useMemo } from 'react';
import { cancelWeeklySummaryReminder, scheduleWeeklySummaryReminder } from '../data/notifications';
import { learnReminderHours, toStudyMoment } from '../domain/reminder-time';
import { useRemindersStore } from './reminders.store';

const LOOKBACK_WEEKS = 4;
const SUNDAY = 7;

/**
 * The Sunday-evening nudge to look back at the week.
 *
 * It fires at the hour the student tends to finish studying on a Sunday, so it
 * lands after the week is really over rather than in the middle of it.
 */
export function useWeeklySummaryReminder(): void {
  const enabled = useRemindersStore((state) => state.weeklySummaryEnabled);
  const smart = useRemindersStore((state) => state.smartTiming);
  const fallbackHour = useRemindersStore((state) => state.checkinHour);

  const windowStart = useMemo(() => addDays(todayLocal(), -LOOKBACK_WEEKS * 7), []);
  const sessions = useSessionsSince(windowStart);

  const hour = useMemo(() => {
    if (!smart) return fallbackHour;
    const moments = (sessions.data ?? []).flatMap((session) =>
      session.minutes === null ? [] : [toStudyMoment(session.startedAt, session.minutes)],
    );
    return learnReminderHours(moments, fallbackHour).hourByWeekday[SUNDAY] ?? fallbackHour;
  }, [fallbackHour, sessions.data, smart]);

  useEffect(() => {
    if (!enabled) {
      void cancelWeeklySummaryReminder();
      return;
    }
    void scheduleWeeklySummaryReminder(hour, null);
  }, [enabled, hour]);
}
