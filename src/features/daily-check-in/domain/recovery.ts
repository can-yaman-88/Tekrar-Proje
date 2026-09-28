import type { CheckinOutcome } from '@entities/daily-log';

/**
 * What to do when a submission failed but the server may have done the work.
 *
 * A check-in can reach the server and still look like a failure to the phone:
 * a dropped connection, a request the app gave up on, a screen that was
 * closed. Asking the student to write the day again is the wrong answer —
 * the second attempt is refused as a duplicate and they are left with an
 * error over work that actually went through.
 */
export type RecoveryStep =
  /** The check-in went through; show its result. */
  | { action: 'use-result' }
  /** The server is still working on it; wait and look again. */
  | { action: 'wait' }
  /** Nothing happened on the server; the original error is the truth. */
  | { action: 'report-error' };

export function decideRecovery({
  outcome,
  serverHasIt,
}: {
  outcome: CheckinOutcome;
  /** True when the server itself said the check-in is already claimed. */
  serverHasIt: boolean;
}): RecoveryStep {
  switch (outcome.state) {
    case 'succeeded':
      return { action: 'use-result' };
    case 'processing':
      // Waiting is only justified when the server confirmed it has the work;
      // otherwise the request never arrived and waiting just stalls the screen.
      return serverHasIt ? { action: 'wait' } : { action: 'report-error' };
    case 'failed':
    case 'missing':
      return { action: 'report-error' };
  }
}
