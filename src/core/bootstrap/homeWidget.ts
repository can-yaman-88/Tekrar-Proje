import { homeWidgetTaskHandler } from '@features/home-widget';
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

/**
 * Android starts the app's JavaScript without any screen to draw or tick the
 * home-screen widget; only what the entry file loads exists then, so the
 * handler is registered there (index.ts), not in a component.
 */
export function registerHomeWidget(): void {
  if (Platform.OS === 'android') registerWidgetTaskHandler(homeWidgetTaskHandler);
}
