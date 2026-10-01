import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, ProgressBar, useTheme } from '@shared/ui';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { TaskCardModel } from '../model/task.view-model';
import { useTaskCardStyles } from './TaskCard.styles';

export interface TaskCardProps {
  model: TaskCardModel;
  /** Opens the task detail screen. */
  onPress?: (taskId: string) => void;
  onToggle?: (taskId: string) => void;
  toggleDisabled?: boolean;
  showToggle?: boolean;
}

export const TaskCard = memo(function TaskCard({
  model,
  onPress,
  onToggle,
  toggleDisabled = false,
  showToggle = true,
}: TaskCardProps) {
  const styles = useTaskCardStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${model.title} — detay` : undefined}
      disabled={!onPress}
      onPress={() => onPress?.(model.id)}
      style={({ pressed }) => [styles.card, model.isOverdue && styles.cardOverdue, pressed && onPress && styles.cardPressed]}
    >
      <View style={[styles.accent, { backgroundColor: model.accent }]} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {model.subtitle}
            </AppText>
            <AppText variant="subtitle" style={model.isDone && styles.titleDone} numberOfLines={2}>
              {model.title}
            </AppText>
          </View>
          {showToggle && onToggle ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: model.isDone, disabled: toggleDisabled }}
              accessibilityLabel={`"${model.title}" görevini ${model.isDone ? 'geri al' : 'tamamla'}`}
              hitSlop={10}
              disabled={toggleDisabled}
              onPress={() => onToggle(model.id)}
              style={({ pressed }) => [styles.check, model.isDone && styles.checkDone, pressed && styles.checkPressed]}
            >
              {model.isDone ? <Ionicons name="checkmark" size={18} color={colors.textInverse} /> : null}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          {model.isUrgent ? (
            <View style={[styles.chip, styles.chipDanger]}>
              <AppText variant="caption" tone="danger">
                Acil
              </AppText>
            </View>
          ) : null}
          <View style={[styles.chip, model.isOverdue && styles.chipWarning]}>
            <AppText variant="caption" tone={model.isOverdue ? 'warning' : 'muted'}>
              {model.dueLabel}
            </AppText>
          </View>
          {model.isFailed ? (
            <View style={[styles.chip, styles.chipDanger]}>
              <AppText variant="caption" tone="danger">
                Tekrar denenmeli
              </AppText>
            </View>
          ) : null}
          {model.subtaskProgress ? (
            <View style={styles.chip}>
              <AppText variant="caption" tone="muted">
                {model.subtaskProgress} adım
              </AppText>
            </View>
          ) : null}
          {model.meta.map((item) => (
            <View key={item} style={styles.chip}>
              <AppText variant="caption" tone="muted">
                {item}
              </AppText>
            </View>
          ))}
          {model.attachmentCount > 0 ? (
            <View
              style={[styles.chip, styles.chipWithIcon]}
              accessible
              accessibilityLabel={`${model.attachmentCount} ek`}
            >
              <Ionicons name="attach" size={13} color={colors.textMuted} />
              <AppText variant="caption" tone="muted">
                {model.attachmentCount}
              </AppText>
            </View>
          ) : null}
        </View>

        {model.subtasks.length > 0 ? (
          <View style={styles.subtasks}>
            {model.subtasks.map((step) => (
              <Pressable
                key={step.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: step.isDone, disabled: toggleDisabled }}
                accessibilityLabel={`"${step.title}" adımını ${step.isDone ? 'geri al' : 'tamamla'}`}
                disabled={toggleDisabled || !onToggle}
                onPress={() => onToggle?.(step.id)}
                style={styles.subtaskRow}
              >
                <View style={[styles.subtaskDot, step.isDone && styles.subtaskDotDone]}>
                  {step.isDone ? <Ionicons name="checkmark" size={12} color={colors.textInverse} /> : null}
                </View>
                <AppText
                  variant="caption"
                  tone={step.isToday ? 'default' : 'muted'}
                  style={step.isDone ? styles.subtaskDone : undefined}
                  numberOfLines={1}
                >
                  {step.title}
                </AppText>
                {step.dueLabel ? (
                  <AppText variant="caption" tone="muted">
                    {step.dueLabel}
                  </AppText>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {model.quotaLabel ? (
          <View style={[styles.chip, styles.chipQuota]}>
            <AppText variant="caption" tone="primary">
              {model.quotaLabel}
            </AppText>
          </View>
        ) : null}

        {model.progressLabel ? (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <ProgressBar
                value={model.progress}
                tone={model.isDone ? 'success' : 'primary'}
                accessibilityLabel={`${model.progressLabel} problem çözüldü`}
              />
            </View>
            <AppText variant="caption" tone="muted">
              {model.progressLabel}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});
