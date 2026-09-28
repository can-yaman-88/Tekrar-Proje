import { AppText, makeStyles, Skeleton, type TextTone } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { ExamUrgency } from '../domain/exam';
import type { ExamChipModel } from '../model/exam.view-model';

const TONE: Record<ExamUrgency, TextTone> = { critical: 'danger', soon: 'warning', later: 'muted' };

export function ExamChip({ model, onPress }: { model: ExamChipModel; onPress?: (examId: string) => void }) {
  const styles = useStyles();
  return (
    <Pressable
      disabled={onPress === undefined}
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={() => onPress?.(model.id)}
      style={[styles.chip, model.urgency === 'critical' && styles.critical]}
      accessibilityLabel={`${model.courseLabel} ${model.title} in ${model.countdown}`}
    >
      <View style={[styles.dot, { backgroundColor: model.accent }]} />
      <View style={styles.text}>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {model.courseLabel}
        </AppText>
        <AppText variant="label" numberOfLines={1}>
          {model.title}
        </AppText>
        <AppText variant="caption" tone={TONE[model.urgency]}>
          {model.countdown}
        </AppText>
      </View>
    </Pressable>
  );
}

export function ExamChipSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.chip}>
      <View style={styles.text}>
        <Skeleton width={48} height={10} />
        <Skeleton width={96} height={14} />
        <Skeleton width={56} height={10} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  chip: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: 156,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  critical: { borderColor: colors.danger, backgroundColor: colors.dangerMuted },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  text: { flex: 1, gap: spacing.xxs },
}));
