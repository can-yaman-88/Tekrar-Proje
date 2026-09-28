import { useEffect } from 'react';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, type ToastTone } from '../../lib/toast';
import { makeStyles } from '../theme';
import { AppText } from './AppText';

const AUTO_DISMISS_MS = 3_500;

/** Renders the single global toast from the Zustand toast store. Mount once at the root. */
export function ToastHost() {
  const toast = useToastStore((s) => s.current);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  const toneStyle: Record<ToastTone, object> = { info: styles.info, success: styles.success, danger: styles.danger };

  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      onPress={() => dismiss(toast.id)}
      style={[styles.toast, toneStyle[toast.tone], { bottom: insets.bottom + 72 }]}
    >
      <AppText variant="label" tone="inverse">
        {toast.message}
      </AppText>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  info: { backgroundColor: colors.text },
  success: { backgroundColor: colors.success },
  danger: { backgroundColor: colors.danger },
}));
