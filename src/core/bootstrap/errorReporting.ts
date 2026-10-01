import { useSessionStore } from '@entities/session';
import { flushPendingCrash, rememberCrash, reportError } from '@shared/api/telemetry';
import { useEffect } from 'react';

let installed = false;

/**
 * Catches what nothing else does — an error thrown in a callback or a
 * promise chain outside React — and files it before React Native's own
 * handler shows the red box or closes the app. A fatal one is written down
 * first and sent on the next start, since this run may not get to finish
 * a request. Idempotent; call once at startup.
 */
export function installErrorReporting(): void {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    if (isFatal) rememberCrash(error, { source: 'global', where: 'fatal' });
    else reportError(error, { source: 'global' });
    previous(error, isFatal);
  });
}

/** Sends the previous run's crash once someone is signed in to file it under. */
export function useFlushPendingCrash(): void {
  const status = useSessionStore((s) => s.status);
  useEffect(() => {
    if (status === 'signedIn') flushPendingCrash();
  }, [status]);
}
