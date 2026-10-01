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

export function decideRecovery(outcome: CheckinOutcome): RecoveryStep {
  switch (outcome.state) {
    case 'succeeded':
      return { action: 'use-result' };
    case 'processing':
      // The server claimed it, so the work is under way whatever the phone
      // saw: a connection dropped mid-answer, a wait the app gave up on.
      return { action: 'wait' };
    case 'pending':
      // Never picked up: the request did not arrive, and waiting would only
      // stall the screen.
    case 'failed':
    case 'missing':
      return { action: 'report-error' };
  }
}
