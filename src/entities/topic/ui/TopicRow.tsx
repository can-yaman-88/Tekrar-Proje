import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles, useTheme, type TextTone } from '@shared/ui';
import { Pressable, Switch, View } from 'react-native';
import type { MasteryLevel } from '../domain/topic';

export interface TopicRowModel {
  id: string;
  title: string;
  weekLabel: string | null;
  mastery: MasteryLevel;
  masteryLabel: string;
  reviewLabel: string | null;
  /** Shown in the warning colour when the review is due or late. */
  reviewIsDue?: boolean;
  /** "Son çalışma 3 gün önce · güven 4/5" — what the last review looked like. */
  lastReviewLabel?: string | null;
  statsLabel: string | null;
  hasAdvancedMaterial: boolean;
}

const TONE: Record<MasteryLevel, TextTone> = {
  new: 'muted',
  weak: 'danger',
  learning: 'warning',
  solid: 'success',
};

export interface TopicRowProps {
  model: TopicRowModel;
  /** Opens the topic's own screen; the row is static without it. */
  onPress?: (topicId: string) => void;
  /** Omitted on read-only screens. */
  onToggleAdvanced?: (topicId: string, hasAdvancedMaterial: boolean) => void;
  toggleDisabled?: boolean;
}

export function TopicRow({ model, onPress, onToggleAdvanced, toggleDisabled = false }: TopicRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${model.title} — tekrar durumu` : undefined}
      disabled={!onPress}
      onPress={() => onPress?.(model.id)}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
    >
      <View style={styles.main}>
        <AppText variant="caption" tone="muted">
          {[model.weekLabel, model.statsLabel].filter(Boolean).join(' · ') || ' '}
        </AppText>
        <AppText numberOfLines={2}>{model.title}</AppText>
        {model.reviewLabel ? (
          <AppText variant="caption" tone={model.reviewIsDue ? 'warning' : 'muted'}>
            {model.reviewLabel}
          </AppText>
        ) : null}
        {model.lastReviewLabel ? (
          <AppText variant="caption" tone="muted">
            {model.lastReviewLabel}
          </AppText>
        ) : null}
      </View>
      <View style={styles.side}>
        <View style={styles.badge}>
          <AppText variant="caption" tone={TONE[model.mastery]}>
            {model.masteryLabel}
          </AppText>
        </View>
        {onToggleAdvanced ? (
          <View style={styles.advanced}>
            <AppText variant="caption" tone="muted">
              Zor soru
            </AppText>
            <Switch
              accessibilityLabel={`${model.title} için elimde ileri seviye sorular var`}
              value={model.hasAdvancedMaterial}
              disabled={toggleDisabled}
              onValueChange={(value) => onToggleAdvanced(model.id, value)}
            />
          </View>
        ) : onPress ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        ) : null}
      </View>
    </Pressable>
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
    padding: spacing.md,
  },
  pressed: { opacity: 0.85 },
  main: { flex: 1, gap: spacing.xxs },
  side: { alignItems: 'flex-end', gap: spacing.xs },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  advanced: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
}));
