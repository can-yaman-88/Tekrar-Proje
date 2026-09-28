import { appStorage, asKeyValueStorage } from '../../lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/** Persisted so the chosen theme is applied before the first frame after a restart. */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'theme',
      version: 1,
      storage: createJSONStorage(() => asKeyValueStorage(appStorage)),
    },
  ),
);

export const useThemePreference = (): ThemePreference => useThemeStore((s) => s.preference);
