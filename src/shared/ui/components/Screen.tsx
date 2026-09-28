import type { ReactNode } from 'react';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { makeStyles } from '../theme';

export interface ScreenProps {
  children: ReactNode;
  /** Tab screens skip the bottom edge; the tab bar already handles it. */
  edges?: readonly Edge[];
}

export function Screen({ children, edges = ['top'] }: ScreenProps) {
  const styles = useStyles();
  return (
    <SafeAreaView edges={edges} style={styles.root}>
      {children}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
}));
