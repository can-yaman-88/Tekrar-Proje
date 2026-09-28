import { StyleSheet } from 'react-native';
import type { Theme } from './tokens';
import { useTheme } from './useTheme';

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

/**
 * Co-locates theme-aware styles with a component (`Foo.styles.ts`).
 * Styles are created once per theme, not per render.
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (theme: Theme) => T): () => T {
  const cache = new Map<Theme['scheme'], T>();
  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme.scheme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme));
      cache.set(theme.scheme, styles);
    }
    return styles;
  };
}
