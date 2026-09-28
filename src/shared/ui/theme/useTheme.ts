import { useColorScheme } from 'react-native';
import { useThemePreference } from './theme.store';
import { darkTheme, lightTheme, type Theme } from './tokens';

/** Explicit user choice wins; otherwise follow the OS setting. */
export function useTheme(): Theme {
  const preference = useThemePreference();
  const system = useColorScheme();
  const scheme = preference === 'system' ? (system ?? 'light') : preference;
  return scheme === 'dark' ? darkTheme : lightTheme;
}
