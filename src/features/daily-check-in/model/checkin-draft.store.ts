import type { IsoDate } from '@contracts/enums.contract';
import { appStorage, asKeyValueStorage } from '@shared/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface PendingLog {
  id: string;
  date: IsoDate;
  text: string;
  /** Device URIs already uploaded for this log — a retry must not re-upload them. */
  uploadedUris: string[];
}

export interface CheckinDraftState {
  draft: string;
  /** A log already inserted but not yet processed — retried instead of duplicated. */
  pending: PendingLog | null;
  setDraft: (draft: string) => void;
  setPending: (pending: PendingLog | null) => void;
  reset: () => void;
}

/** Survives app restarts (MMKV) so a report typed offline is never lost. */
export const useCheckinDraftStore = create<CheckinDraftState>()(
  persist(
    (set) => ({
      draft: '',
      pending: null,
      setDraft: (draft) => set({ draft }),
      setPending: (pending) => set({ pending }),
      reset: () => set({ draft: '', pending: null }),
    }),
    {
      name: 'checkin-draft',
      version: 2,
      // v1 had no attachment tracking; without this the retry path would read
      // `uploadedUris` of undefined on the first launch after an update.
      migrate: (state) => {
        const previous = state as Partial<CheckinDraftState> | undefined;
        const pending = previous?.pending;
        return {
          draft: previous?.draft ?? '',
          pending: pending ? { ...pending, uploadedUris: pending.uploadedUris ?? [] } : null,
        } as CheckinDraftState;
      },
      storage: createJSONStorage(() => asKeyValueStorage(appStorage)),
      partialize: ({ draft, pending }) => ({ draft, pending }),
    },
  ),
);
