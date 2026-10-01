import { AppText, Button, makeStyles } from '@shared/ui';
import { Modal, Pressable, View } from 'react-native';
import { CONFIDENCE_LABEL } from '../domain/review';

const RATINGS = [1, 2, 3, 4, 5] as const;

export interface ConfidenceSheetProps {
  visible: boolean;
  title: string;
  /** One line under the title: which topic, which task. */
  subtitle?: string | null;
  onSelect: (confidence: number) => void;
  onDismiss: () => void;
  /** A way out that is not a rating, e.g. "Puanlamadan bitir". */
  secondary?: { label: string; onPress: () => void } | null;
  busy?: boolean;
}

/**
 * "Nasıl geçti?" — one tap, five honest answers. The rating is what the
 * review schedule and the "son güven" line on every topic are built from.
 */
export function ConfidenceSheet({
  visible,
  title,
  subtitle,
  onSelect,
  onDismiss,
  secondary,
  busy = false,
}: ConfidenceSheetProps) {
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Kapat">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <AppText variant="subtitle" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {subtitle}
            </AppText>
          ) : null}

          <View style={styles.options}>
            {RATINGS.map((rating) => (
              <Pressable
                key={rating}
                accessibilityRole="button"
                accessibilityLabel={`${rating}: ${CONFIDENCE_LABEL[rating]}`}
                disabled={busy}
                onPress={() => onSelect(rating)}
                style={({ pressed }) => [
                  styles.option,
                  rating === 1 && styles.optionLow,
                  rating >= 4 && styles.optionHigh,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <AppText variant="title" tone={rating === 1 ? 'danger' : rating >= 4 ? 'success' : 'default'}>
                  {rating}
                </AppText>
                <AppText variant="caption" tone="muted" style={styles.optionLabel} numberOfLines={2}>
                  {CONFIDENCE_LABEL[rating]}
                </AppText>
              </Pressable>
            ))}
          </View>

          <AppText variant="caption" tone="muted">
            1 dersen konu yarın yeniden karşına gelir; 4–5 aralığı uzatır.
          </AppText>

          <View style={styles.actions}>
            {secondary ? (
              <Button label={secondary.label} variant="secondary" onPress={secondary.onPress} disabled={busy} />
            ) : null}
            <Button label="Vazgeç" variant="ghost" onPress={onDismiss} disabled={busy} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  options: { flexDirection: 'row', gap: spacing.xs },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  optionLow: { backgroundColor: colors.dangerMuted, borderColor: colors.dangerMuted },
  optionHigh: { backgroundColor: colors.successMuted, borderColor: colors.successMuted },
  optionLabel: { textAlign: 'center' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  actions: { gap: spacing.xs },
}));
