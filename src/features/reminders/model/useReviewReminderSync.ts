import { useReviewRadar } from '@entities/topic';
import { addDays, todayLocal } from '@shared/lib/date';
import { useEffect, useMemo } from 'react';
import { cancelReviewReminders, scheduleReviewReminders, type ReviewReminderDay } from '../data/notifications';
import { useRemindersStore } from './reminders.store';
import { syncReviewPush } from './reviewPush';

/** Push tokens can rotate; the server hears this device's current one once per launch. */
let pushCheckedThisLaunch = false;

/** How far ahead review notifications are laid down; the set is rewritten on every change. */
const HORIZON_DAYS = 14;

/**
 * Keeps one notification per review day in step with the schedule. Overdue
 * topics are folded into today, so a missed review keeps asking.
 */
export function useReviewReminderSync(): void {
  const enabled = useRemindersStore((s) => s.reviewsEnabled);
  const hour = useRemindersStore((s) => s.reviewHour);
  const pushToken = useRemindersStore((s) => s.pushToken);
  const setPushToken = useRemindersStore((s) => s.setPushToken);
  const radar = useReviewRadar();

  useEffect(() => {
    if (!enabled || pushCheckedThisLaunch) return;
    pushCheckedThisLaunch = true;
    void syncReviewPush(true, hour).then(setPushToken);
  }, [enabled, hour, setPushToken]);

  const days = useMemo<ReviewReminderDay[]>(() => {
    const today = todayLocal();
    const horizon = addDays(today, HORIZON_DAYS);
    const byDay = new Map<string, { title: string; ease: number }[]>();
    for (const topic of radar.data ?? []) {
      if (topic.nextReviewOn === null || topic.nextReviewOn > horizon) continue;
      const day = topic.nextReviewOn < today ? today : topic.nextReviewOn;
      byDay.set(day, [...(byDay.get(day) ?? []), { title: topic.title, ease: topic.easeFactor }]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, topics]) => ({
        date,
        // The weakest first: that is the one worth naming.
        titles: [...topics].sort((a, b) => a.ease - b.ease).map((topic) => topic.title),
      }));
  }, [radar.data]);

  const signature = days.map((day) => `${day.date}:${day.titles.join('|')}`).join(';');
  const isLoaded = radar.data !== undefined;

  useEffect(() => {
    if (!enabled || !isLoaded) return;
    // The server pushes them: scheduling them here too would say it twice.
    if (pushToken !== null) {
      void cancelReviewReminders();
      return;
    }
    void scheduleReviewReminders(days, hour);
    // `signature` captures the schedule the notifications depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hour, signature, isLoaded, pushToken]);
}
