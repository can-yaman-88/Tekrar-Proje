import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * The EAS project this build belongs to (app.config.ts → extra.eas.projectId).
 * Push tokens are issued per project; without one the app stays on local
 * notifications, which need nothing from the server.
 */
export function easProjectId(): string | null {
  const fromConfig: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas: unknown = Constants.easConfig?.projectId;
  const id = typeof fromConfig === 'string' ? fromConfig : typeof fromEas === 'string' ? fromEas : null;
  return id !== null && id.length > 0 ? id : null;
}

export const pushPlatform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

/**
 * This device's Expo push token, or null when push is not available: no EAS
 * project in the build, notifications not allowed, or a device that cannot
 * get a token (an emulator without Play services, no network).
 */
export async function devicePushToken(): Promise<string | null> {
  const projectId = easProjectId();
  if (projectId === null || Platform.OS === 'web') return null;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
