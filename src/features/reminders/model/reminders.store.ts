import { appStorage, asKeyValueStorage } from '@shared/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const REMINDER_HOURS = [18, 19, 20, 21, 22] as const;
export type ReminderHour = (typeof REMINDER_HOURS)[number];

/** Reviews are morning-to-afternoon work: the reminder comes before the day fills up. */
export const REVIEW_HOURS = [8, 10, 13, 17] as const;
export type ReviewHour = (typeof REVIEW_HOURS)[number];

interface RemindersState {
  checkinEnabled: boolean;
  checkinHour: ReminderHour;
  /** Let the app pick the hour per weekday from real study times. */
  smartTiming: boolean;
  examsEnabled: boolean;
  weeklySummaryEnabled: boolean;
  /** A notification on each day a topic's review falls due. */
  reviewsEnabled: boolean;
  reviewHour: ReviewHour;
  setCheckinEnabled: (enabled: boolean) => void;
  setCheckinHour: (hour: ReminderHour) => void;
  setSmartTiming: (enabled: boolean) => void;
  setExamsEnabled: (enabled: boolean) => void;
  setWeeklySummaryEnabled: (enabled: boolean) => void;
  setReviewsEnabled: (enabled: boolean) => void;
  setReviewHour: (hour: ReviewHour) => void;
}

export const useRemindersStore = create<RemindersState>()(
  persist(
    (set) => ({
      checkinEnabled: false,
      checkinHour: 20,
      smartTiming: true,
      examsEnabled: false,
      weeklySummaryEnabled: false,
      reviewsEnabled: false,
      reviewHour: 10,
      setCheckinEnabled: (checkinEnabled) => set({ checkinEnabled }),
      setCheckinHour: (checkinHour) => set({ checkinHour }),
      setSmartTiming: (smartTiming) => set({ smartTiming }),
      setExamsEnabled: (examsEnabled) => set({ examsEnabled }),
      setWeeklySummaryEnabled: (weeklySummaryEnabled) => set({ weeklySummaryEnabled }),
      setReviewsEnabled: (reviewsEnabled) => set({ reviewsEnabled }),
      setReviewHour: (reviewHour) => set({ reviewHour }),
    }),
    {
      name: 'reminders',
      version: 3,
      storage: createJSONStorage(() => asKeyValueStorage(appStorage)),
      // v1 knew nothing of smart timing or the weekly summary, v2 nothing of
      // review reminders; without this the student's existing reminder
      // settings would be thrown away on upgrade.
      migrate: (persisted, version) => {
        const state = persisted as Partial<RemindersState> | undefined;
        if (version >= 3 || !state) return state as RemindersState;
        const upgraded = version >= 2 ? state : { ...state, smartTiming: true, weeklySummaryEnabled: false };
        return { ...upgraded, reviewsEnabled: false, reviewHour: 10 } as RemindersState;
      },
    },
  ),
);
