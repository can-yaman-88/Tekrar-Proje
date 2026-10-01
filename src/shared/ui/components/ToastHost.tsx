import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, type ToastTone } from '../../lib/toast';
import { makeStyles } from '../theme';
import { AppText } from './AppText';

const AUTO_DISMISS_MS = 3_500;
/** A toast that can be undone stays long enough to reach the button. */
const ACTION_DISMISS_MS = 6_000;

/** Renders the single global toast from the Zustand toast store. Mount once at the root. */
export function ToastHost() {
  const toast = useToastStore((s) => s.current);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS);
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
      <View style={styles.row}>
        <AppText variant="label" tone="inverse" style={styles.message}>
          {toast.message}
        </AppText>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            hitSlop={12}
            onPress={() => {
              toast.action?.onPress();
              dismiss(toast.id);
            }}
            style={styles.action}
          >
            <AppText variant="label" tone="inverse" style={styles.actionLabel}>
              {toast.action.label}
            </AppText>
          </Pressable>
        ) : null}
      </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  message: { flex: 1 },
  action: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm },
  actionLabel: { textDecorationLine: 'underline' },
  info: { backgroundColor: colors.text },
  success: { backgroundColor: colors.success },
  danger: { backgroundColor: colors.danger },
}));
