import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles, useTheme } from '@shared/ui';
import { Pressable, View } from 'react-native';

export interface ClassSessionRowModel {
  id: string;
  courseLabel: string;
  isLab: boolean;
  timeRange: string;
  location: string | null;
  accent: string;
}

export function ClassSessionRow({
  model,
  onRemove,
  removeDisabled = false,
}: {
  model: ClassSessionRowModel;
  onRemove: (id: string) => void;
  removeDisabled?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.accent, { backgroundColor: model.accent }]} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <AppText variant="label">{model.courseLabel}</AppText>
          {model.isLab ? (
            <View style={styles.labBadge}>
              <AppText variant="caption" tone="muted">
                Lab
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" tone="muted">
          {model.timeRange}
          {model.location ? ` · ${model.location}` : ''}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${model.courseLabel} dersini programdan kaldır`}
        hitSlop={10}
        disabled={removeDisabled}
        onPress={() => onRemove(model.id)}
        style={({ pressed }) => (pressed || removeDisabled ? styles.pressed : undefined)}
      >
        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingRight: spacing.md,
    overflow: 'hidden',
  },
  accent: { width: 4, alignSelf: 'stretch' },
  body: { flex: 1, gap: spacing.xxs, paddingVertical: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  pressed: { opacity: 0.5 },
}));
