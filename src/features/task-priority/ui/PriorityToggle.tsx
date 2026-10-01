import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles, useTheme } from '@shared/ui';
import { Pressable } from 'react-native';
import type { TaskPriorityController } from '../model/useTaskPriority';

export function PriorityToggle({ priority }: { priority: TaskPriorityController }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: priority.isPriority, disabled: priority.isSaving }}
      accessibilityLabel="Acil"
      disabled={priority.isSaving}
      onPress={priority.toggle}
      style={({ pressed }) => [styles.row, priority.isPriority && styles.rowOn, pressed && styles.pressed]}
    >
      <Ionicons
        name={priority.isPriority ? 'flag' : 'flag-outline'}
        size={18}
        color={priority.isPriority ? colors.danger : colors.textMuted}
      />
      <AppText variant="label" tone={priority.isPriority ? 'danger' : 'default'} style={styles.label}>
        {priority.isPriority ? 'Acil' : 'Acil olarak işaretle'}
      </AppText>
      <AppText variant="caption" tone="muted">
        {priority.isPriority ? 'Kaldır' : 'Listede en üste çıkar'}
      </AppText>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowOn: { backgroundColor: colors.dangerMuted, borderColor: colors.danger },
  label: { flex: 1 },
  pressed: { opacity: 0.7 },
}));
