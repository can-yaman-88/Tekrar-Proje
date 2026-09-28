import { AppText, makeStyles, type TextTone } from '@shared/ui';
import { Switch, View } from 'react-native';
import type { MasteryLevel } from '../domain/topic';

export interface TopicRowModel {
  id: string;
  title: string;
  weekLabel: string | null;
  mastery: MasteryLevel;
  masteryLabel: string;
  reviewLabel: string | null;
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
  /** Omitted on read-only screens. */
  onToggleAdvanced?: (topicId: string, hasAdvancedMaterial: boolean) => void;
  toggleDisabled?: boolean;
}

export function TopicRow({ model, onToggleAdvanced, toggleDisabled = false }: TopicRowProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <AppText variant="caption" tone="muted">
          {[model.weekLabel, model.statsLabel].filter(Boolean).join(' · ') || ' '}
        </AppText>
        <AppText numberOfLines={2}>{model.title}</AppText>
        {model.reviewLabel ? (
          <AppText variant="caption" tone="muted">
            {model.reviewLabel}
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
        ) : null}
      </View>
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
    padding: spacing.md,
  },
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
