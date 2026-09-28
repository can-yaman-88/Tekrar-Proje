import { appStorage, asKeyValueStorage } from '@shared/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const REMINDER_HOURS = [18, 19, 20, 21, 22] as const;
export type ReminderHour = (typeof REMINDER_HOURS)[number];

interface RemindersState {
  checkinEnabled: boolean;
  checkinHour: ReminderHour;
  /** Let the app pick the hour per weekday from real study times. */
  smartTiming: boolean;
  examsEnabled: boolean;
  weeklySummaryEnabled: boolean;
  setCheckinEnabled: (enabled: boolean) => void;
  setCheckinHour: (hour: ReminderHour) => void;
  setSmartTiming: (enabled: boolean) => void;
  setExamsEnabled: (enabled: boolean) => void;
  setWeeklySummaryEnabled: (enabled: boolean) => void;
}

export const useRemindersStore = create<RemindersState>()(
  persist(
    (set) => ({
      checkinEnabled: false,
      checkinHour: 20,
      smartTiming: true,
      examsEnabled: false,
      weeklySummaryEnabled: false,
      setCheckinEnabled: (checkinEnabled) => set({ checkinEnabled }),
      setCheckinHour: (checkinHour) => set({ checkinHour }),
      setSmartTiming: (smartTiming) => set({ smartTiming }),
      setExamsEnabled: (examsEnabled) => set({ examsEnabled }),
      setWeeklySummaryEnabled: (weeklySummaryEnabled) => set({ weeklySummaryEnabled }),
    }),
    {
      name: 'reminders',
      version: 2,
      storage: createJSONStorage(() => asKeyValueStorage(appStorage)),
      // v1 knew nothing of smart timing or the weekly summary; without this the
      // student's existing reminder settings would be thrown away on upgrade.
      migrate: (persisted, version) => {
        const state = persisted as Partial<RemindersState> | undefined;
        if (version >= 2 || !state) return state as RemindersState;
        return { ...state, smartTiming: true, weeklySummaryEnabled: false } as RemindersState;
      },
    },
  ),
);
