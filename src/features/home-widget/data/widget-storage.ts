import { appStorage } from '@shared/lib/storage';
import { parseSnapshot, type WidgetSnapshot } from '../domain/widget-snapshot';

// Plain (unencrypted) storage on purpose: the background task that draws the
// widget reads it without the app, and everything in it is already on the
// home screen for anyone holding the phone to see. Cleared on sign-out.
const SNAPSHOT_KEY = 'home-widget.snapshot';
const SIGNED_IN_KEY = 'home-widget.signed-in';
const NOTICE_KEY = 'home-widget.notice';
/** A failed tick says so until the next good draw, at most this long. */
const NOTICE_MS = 30 * 60 * 1000;

export function readSnapshot(): WidgetSnapshot | null {
  return parseSnapshot(appStorage.getString(SNAPSHOT_KEY));
}

export function writeSnapshot(snapshot: WidgetSnapshot): void {
  appStorage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export const readSignedIn = (): boolean => appStorage.getString(SIGNED_IN_KEY) === '1';

export function setSignedIn(signedIn: boolean): void {
  if (signedIn) appStorage.set(SIGNED_IN_KEY, '1');
  else appStorage.remove(SIGNED_IN_KEY);
}

export function readNotice(now = Date.now()): string | null {
  const raw = appStorage.getString(NOTICE_KEY);
  if (!raw) return null;
  try {
    const notice = JSON.parse(raw) as { text: string; until: number };
    return notice.until > now ? notice.text : null;
  } catch {
    return null;
  }
}

export function writeNotice(text: string | null, now = Date.now()): void {
  if (text === null) appStorage.remove(NOTICE_KEY);
  else appStorage.set(NOTICE_KEY, JSON.stringify({ text, until: now + NOTICE_MS }));
}

/** Sign-out: nothing of the account stays on the home screen. */
export function clearWidgetData(): void {
  appStorage.remove(SNAPSHOT_KEY);
  appStorage.remove(NOTICE_KEY);
  setSignedIn(false);
}
