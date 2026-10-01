import { clearAttachmentFiles } from '@entities/attachment';
import { useSessionStore } from '@entities/session';
import { useCheckinDraftStore } from '@features/daily-check-in';
import { clearHomeWidget } from '@features/home-widget';
import { cancelAllReminders } from '@features/reminders';
import { clearPersistedQueryCache } from '@shared/api/query';
import { supabase } from '@shared/api/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Keeps the Zustand session store in sync with Supabase Auth. */
export function useAuthListener(): void {
  const setSession = useSessionStore((s) => s.setSession);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    // A storage or network fault must not leave the app stuck on the splash:
    // treat a failed read as "signed out" and let the user sign in again.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch((error: unknown) => {
        console.warn('[auth] oturum okunamadı', error);
        if (active) setSession(null);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_OUT') {
        // Never leak one account's data into the next one on this device.
        queryClient.clear();
        clearPersistedQueryCache();
        useCheckinDraftStore.getState().reset();
        void cancelAllReminders();
        clearHomeWidget();
        clearAttachmentFiles();
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [setSession, queryClient]);
}
