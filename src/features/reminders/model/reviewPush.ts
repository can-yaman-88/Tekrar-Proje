import { profileRepository } from '@entities/profile';
import { devicePushToken, pushPlatform } from '../data/push';

/**
 * Hands review reminders to the server when this device can take push, and
 * tells the caller whether it did. Best effort throughout: offline, no EAS
 * project, an emulator — any of these leaves reminders local, which still
 * work, rather than leaving the student with none.
 *
 * @returns the registered token, or null when reminders stay local
 */
export async function syncReviewPush(enabled: boolean, hour: number): Promise<string | null> {
  try {
    if (!enabled) {
      await profileRepository.setReviewPushHour(null);
      return null;
    }
    const token = await devicePushToken();
    if (token === null) {
      await profileRepository.setReviewPushHour(null);
      return null;
    }
    await profileRepository.registerPushToken(token, pushPlatform());
    await profileRepository.setReviewPushHour(hour);
    return token;
  } catch {
    return null;
  }
}

/** Before signing out: this device should stop receiving the account's reminders. */
export async function releaseDevicePush(token: string | null): Promise<void> {
  if (token === null) return;
  try {
    await profileRepository.unregisterPushToken(token);
  } catch {
    // Offline: the next account to sign in here takes the token over anyway.
  }
}
