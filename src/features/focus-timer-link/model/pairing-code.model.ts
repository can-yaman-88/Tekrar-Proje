import type { FocusTimerDevice, PairingCode } from '@entities/focus-timer';

/** "PXA0PK8S" → "PXA0-PK8S": two halves are easier to read off one screen and type on another. */
export const displayCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A code on screen, and the pairings that already existed when it was issued. */
export interface OpenCode {
  code: PairingCode;
  known: ReadonlySet<string>;
}

/**
 * The device that used the code: a pairing that was not there when the code
 * was issued. A device pairing again counts too — it gets a new pairing.
 */
export const deviceThatUsed = (
  devices: readonly FocusTimerDevice[] | undefined,
  open: OpenCode | null,
): FocusTimerDevice | undefined => (open ? devices?.find((device) => !open.known.has(device.id)) : undefined);
