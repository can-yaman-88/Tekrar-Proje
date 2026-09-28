import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export type SessionStatus = 'initializing' | 'signedIn' | 'signedOut';

interface SessionState {
  status: SessionStatus;
  session: Session | null;
  setSession: (session: Session | null) => void;
}

/** Global auth state. Written only by the auth listener in `core/`. */
export const useSessionStore = create<SessionState>()((set) => ({
  status: 'initializing',
  session: null,
  setSession: (session) => set({ session, status: session ? 'signedIn' : 'signedOut' }),
}));

export const selectUserEmail = (s: SessionState): string | null => s.session?.user.email ?? null;
