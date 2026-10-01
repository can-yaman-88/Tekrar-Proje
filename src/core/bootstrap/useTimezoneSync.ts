import { profileKeys, profileRepository } from '@entities/profile';
import { useSessionStore } from '@entities/session';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** The device's IANA zone ("Europe/Istanbul"), or null where the runtime cannot say. */
function deviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && /^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Tells the server which timezone the student lives in.
 *
 * Every "which day was this" the server works out — the day a check-in's work
 * happened, the day a session counts towards capacity — hangs off the profile's
 * timezone, and nothing ever set it: every account read as UTC. Once per
 * sign-in, the device's zone is written if it differs. A name the database
 * does not know is refused there and simply left as it was.
 */
export function useTimezoneSync(): void {
  const status = useSessionStore((s) => s.status);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== 'signedIn') return;
    const zone = deviceTimezone();
    if (zone === null) return;

    let cancelled = false;
    profileRepository
      .get()
      .then(async (profile) => {
        if (cancelled || profile.timezone === zone) return;
        await profileRepository.setTimezone(zone);
        await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      })
      .catch(() => {
        // Offline or refused: the next sign-in or launch tries again.
      });
    return () => {
      cancelled = true;
    };
  }, [status, queryClient]);
}
