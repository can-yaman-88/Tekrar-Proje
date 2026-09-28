import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, Skeleton, TextField, makeStyles, useTheme } from '@shared/ui';
import { formatShortDate } from '@shared/lib/date';
import { Pressable, View } from 'react-native';
import type { SubtaskController } from '../model/useSubtasks';

export function SubtaskSection({ subtasks }: { subtasks: SubtaskController }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!subtasks.canAdd) return null;

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">Alt adımlar</AppText>
      <AppText variant="caption" tone="muted">
        Ödevi parçalara bölersen görev listesinde tek kart olarak kalır, adımları tek tek işaretlersin.
      </AppText>

      {subtasks.isLoading ? (
        <Skeleton height={44} radius={10} />
      ) : (
        subtasks.rows.map((step) => (
          <View key={step.id} style={styles.row}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: step.isDone }}
              accessibilityLabel={`"${step.title}" adımını ${step.isDone ? 'geri al' : 'tamamla'}`}
              disabled={subtasks.togglingId === step.id}
              onPress={() => subtasks.onToggle(step.id)}
              style={[styles.check, step.isDone && styles.checkDone]}
            >
              {step.isDone ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
            </Pressable>
            <View style={styles.flex}>
              <AppText style={step.isDone ? styles.done : undefined} numberOfLines={2}>
                {step.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {formatShortDate(step.dueDate)}
                {step.estimatedMinutes ? ` · ${step.estimatedMinutes} dk` : ''}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`"${step.title}" adımını sil`}
              hitSlop={10}
              disabled={subtasks.isRemoving}
              onPress={() => subtasks.onRemove(step.id)}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ))
      )}

      <TextField
        label="Yeni adım"
        value={subtasks.draft}
        onChangeText={subtasks.onChangeDraft}
        placeholder="1-8 arası soruları çöz"
        maxLength={200}
      />
      <Button label="Adım ekle" loading={subtasks.isAdding} disabled={!subtasks.canSubmit} onPress={subtasks.onAdd} />
    </Card>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, gap: spacing.xxs },
  check: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
}));
