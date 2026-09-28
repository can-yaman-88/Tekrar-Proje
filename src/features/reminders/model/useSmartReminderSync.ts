import { useSessionsSince } from '@entities/task-session';
import { useMissionTasks } from '@entities/task';
import { addDays, todayLocal } from '@shared/lib/date';
import { useEffect, useMemo } from 'react';
import { scheduleSmartCheckinReminders } from '../data/notifications';
import { learnReminderHours, toStudyMoment } from '../domain/reminder-time';
import { useRemindersStore } from './reminders.store';

/** Weeks of study history the reminder hour is learned from. */
const LOOKBACK_WEEKS = 4;

/**
 * Keeps the evening reminder in step with reality: the hour comes from when
 * the student actually finishes studying on that weekday, and the text names
 * the work that is still open.
 *
 * Rescheduling is idempotent — the previous set is cancelled first — so it can
 * run whenever the underlying data changes.
 */
export function useSmartReminderSync(): void {
  const enabled = useRemindersStore((state) => state.checkinEnabled);
  const smart = useRemindersStore((state) => state.smartTiming);
  const fallbackHour = useRemindersStore((state) => state.checkinHour);

  const today = todayLocal();
  const windowStart = useMemo(() => addDays(today, -LOOKBACK_WEEKS * 7), [today]);
  const sessions = useSessionsSince(windowStart);
  const tasks = useMissionTasks(today);

  const hours = useMemo(() => {
    if (!smart) {
      return Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i + 1, fallbackHour]));
    }
    const moments = (sessions.data ?? []).flatMap((session) =>
      session.minutes === null ? [] : [toStudyMoment(session.startedAt, session.minutes)],
    );
    return learnReminderHours(moments, fallbackHour).hourByWeekday;
  }, [fallbackHour, sessions.data, smart]);

  const open = useMemo(
    () => (tasks.data ?? []).filter((task) => task.status === 'pending' || task.status === 'in_progress'),
    [tasks.data],
  );
  const topTask = open[0] ? { id: open[0].id, title: open[0].title } : null;

  // A plain string keeps the effect from firing on every identical re-render.
  const signature = `${JSON.stringify(hours)}|${topTask?.id ?? ''}|${open.length}`;

  useEffect(() => {
    if (!enabled) return;
    void scheduleSmartCheckinReminders({ hourByWeekday: hours, topTask, openTaskCount: open.length });
    // `signature` stands in for the values the schedule is derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);
}
