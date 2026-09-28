import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { toNotificationWeekday } from '../domain/reminder-time';

const CHANNEL_ID = 'reminders';
export const CHECKIN_ID_PREFIX = 'checkin';
export const EXAM_ID_PREFIX = 'exam';
export const SUMMARY_ID_PREFIX = 'summary';

/** Buttons on the evening reminder, so the app can be skipped entirely. */
export const CHECKIN_CATEGORY = 'checkin-reminder';
export const ACTION_COMPLETE_TASK = 'complete-task';
export const ACTION_WRITE_CHECKIN = 'write-checkin';

/** Called once at startup: how a notification behaves while the app is open. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Hatırlatmalar',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Registered at startup too, not only when the switch is flipped: the OS
  // keeps categories per install, and a reinstall must not lose the buttons.
  void registerNotificationCategories();
}

/**
 * The action buttons. Both bring the app forward: Android only delivers a
 * background action to a running app, and silently losing a "bitirdim" tap is
 * worse than briefly showing the app while it is recorded.
 */
export async function registerNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY, [
    {
      identifier: ACTION_COMPLETE_TASK,
      buttonTitle: 'Bitirdim',
      options: { opensAppToForeground: true },
    },
    {
      identifier: ACTION_WRITE_CHECKIN,
      buttonTitle: 'Değerlendirme yaz',
      options: { opensAppToForeground: true },
    },
  ]);
}

export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function cancelByPrefix(prefix: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith(prefix))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

export interface SmartReminderPlan {
  /** ISO weekday (1 = Monday) → hour to fire. */
  hourByWeekday: Readonly<Record<number, number>>;
  /** The task offered for one-tap completion, if there is a sensible one. */
  topTask: { id: string; title: string } | null;
  openTaskCount: number;
}

/**
 * Seven weekly reminders, one per weekday, each at that day's own hour.
 *
 * The body names the work waiting, and carries the task id so the "Bitirdim"
 * button can close it. The id can go stale if the app is not opened for days,
 * so whoever handles the response re-checks the task before touching it.
 */
export async function scheduleSmartCheckinReminders(plan: SmartReminderPlan): Promise<void> {
  await cancelByPrefix(CHECKIN_ID_PREFIX);

  const body =
    plan.openTaskCount === 0
      ? 'Bugün ne çalıştığını yaz; plan kendini güncellesin.'
      : plan.topTask
        ? `Sırada: ${plan.topTask.title}${plan.openTaskCount > 1 ? ` (+${plan.openTaskCount - 1} görev)` : ''}`
        : `${plan.openTaskCount} görev bekliyor.`;

  for (let weekday = 1; weekday <= 7; weekday++) {
    const hour = plan.hourByWeekday[weekday];
    if (hour === undefined) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${CHECKIN_ID_PREFIX}-w${weekday}`,
      content: {
        title: 'Günün nasıl geçti?',
        body,
        categoryIdentifier: CHECKIN_CATEGORY,
        data: plan.topTask ? { taskId: plan.topTask.id } : {},
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: toNotificationWeekday(weekday),
        hour,
        minute: 0,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
  }
}

export const cancelCheckinReminder = () => cancelByPrefix(CHECKIN_ID_PREFIX);

/** Sunday evening: the week just lived, in one line. */
export async function scheduleWeeklySummaryReminder(hour: number, headline: string | null): Promise<void> {
  await cancelByPrefix(SUMMARY_ID_PREFIX);
  await Notifications.scheduleNotificationAsync({
    identifier: `${SUMMARY_ID_PREFIX}-weekly`,
    content: {
      title: 'Haftan nasıl geçti?',
      body: headline ?? 'Haftalık özetin hazır: ne bitti, ne takıldı, gelecek hafta ne var.',
      data: { route: '/weekly-summary' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: toNotificationWeekday(7), // Pazar
      hour,
      minute: 0,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

export const cancelWeeklySummaryReminder = () => cancelByPrefix(SUMMARY_ID_PREFIX);

export interface ExamReminder {
  examId: string;
  title: string;
  courseLabel: string;
  examDate: string;
  daysBefore: number;
}

/** Replaces all exam reminders; past dates are simply skipped. */
export async function scheduleExamReminders(reminders: readonly ExamReminder[]): Promise<number> {
  await cancelByPrefix(EXAM_ID_PREFIX);
  let scheduled = 0;

  for (const reminder of reminders) {
    const fireAt = new Date(`${reminder.examDate}T09:00:00`);
    fireAt.setDate(fireAt.getDate() - reminder.daysBefore);
    if (fireAt.getTime() <= Date.now()) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: `${EXAM_ID_PREFIX}-${reminder.examId}-${reminder.daysBefore}`,
      content: {
        title:
          reminder.daysBefore === 1
            ? `Yarın: ${reminder.courseLabel} ${reminder.title}`
            : `${reminder.daysBefore} gün kaldı: ${reminder.courseLabel} ${reminder.title}`,
        body: 'Zayıf konularını bugün tekrar et.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
    scheduled++;
  }
  return scheduled;
}

export const cancelExamReminders = () => cancelByPrefix(EXAM_ID_PREFIX);

/** Wipes every scheduled reminder — used when the user signs out. */
export const cancelAllReminders = () => Notifications.cancelAllScheduledNotificationsAsync();
