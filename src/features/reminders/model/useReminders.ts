import { useMutation } from '@tanstack/react-query';
import { showToast } from '@shared/lib/toast';
import {
  cancelCheckinReminder,
  cancelExamReminders,
  ensurePermission,
  registerNotificationCategories,
} from '../data/notifications';
import { REMINDER_HOURS, useRemindersStore, type ReminderHour } from './reminders.store';

/** Settings-screen controller: permission handling plus scheduling. */
export function useReminders() {
  const state = useRemindersStore();

  const apply = useMutation({
    mutationFn: async (next: {
      checkin: boolean;
      hour: ReminderHour;
      smart: boolean;
      exams: boolean;
      summary: boolean;
    }) => {
      if ((next.checkin || next.exams || next.summary) && !(await ensurePermission())) {
        throw new Error('Bildirim izni verilmedi. Telefon ayarlarından açabilirsin.');
      }
      await registerNotificationCategories();
      // The schedule itself belongs to useSmartReminderSync: it knows the
      // hours and the open work, and it rewrites the set as those change.
      // Here we only need to clear it when the student switches it off.
      if (!next.checkin) await cancelCheckinReminder();
      if (!next.exams) await cancelExamReminders();
      return next;
    },
    onSuccess: (next) => {
      state.setCheckinEnabled(next.checkin);
      state.setCheckinHour(next.hour);
      state.setSmartTiming(next.smart);
      state.setExamsEnabled(next.exams);
      state.setWeeklySummaryEnabled(next.summary);
    },
    onError: (error) => showToast(error.message, 'danger'),
  });

  const current = {
    checkin: state.checkinEnabled,
    hour: state.checkinHour,
    smart: state.smartTiming,
    exams: state.examsEnabled,
    summary: state.weeklySummaryEnabled,
  };

  return {
    checkinEnabled: state.checkinEnabled,
    checkinHour: state.checkinHour,
    smartTiming: state.smartTiming,
    examsEnabled: state.examsEnabled,
    summaryEnabled: state.weeklySummaryEnabled,
    hours: REMINDER_HOURS,
    isBusy: apply.isPending,
    setCheckinEnabled: (checkin: boolean) => apply.mutate({ ...current, checkin }),
    setCheckinHour: (hour: ReminderHour) => apply.mutate({ ...current, hour }),
    setSmartTiming: (smart: boolean) => apply.mutate({ ...current, smart }),
    setExamsEnabled: (exams: boolean) => apply.mutate({ ...current, exams }),
    setSummaryEnabled: (summary: boolean) => apply.mutate({ ...current, summary }),
  };
}

export type RemindersController = ReturnType<typeof useReminders>;
