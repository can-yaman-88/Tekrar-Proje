import { appStorage, asKeyValueStorage } from '@shared/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface BannerState {
  /** The day the deadline banner was last dismissed, as YYYY-MM-DD. */
  pressureHiddenOn: string | null;
  /** Whether the banner body is expanded when it is shown. */
  pressureExpanded: boolean;
  hidePressureFor: (date: string) => void;
  togglePressure: () => void;
}

/**
 * Banner state that should survive a restart but never reach the server.
 *
 * "Bugün için gizle" means today only: tomorrow the warning comes back by
 * itself, because tomorrow it is a different day's problem.
 */
export const useBannerStore = create<BannerState>()(
  persist(
    (set) => ({
      pressureHiddenOn: null,
      pressureExpanded: true,
      hidePressureFor: (date) => set({ pressureHiddenOn: date }),
      togglePressure: () => set((state) => ({ pressureExpanded: !state.pressureExpanded })),
    }),
    { name: 'mission-banners', version: 1, storage: createJSONStorage(() => asKeyValueStorage(appStorage)) },
  ),
);
