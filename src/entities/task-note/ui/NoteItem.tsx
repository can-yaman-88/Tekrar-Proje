import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, makeStyles, useTheme } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { TaskNote } from '../domain/task-note';

export interface NoteItemProps {
  note: TaskNote;
  dateLabel: string;
  onDelete: (noteId: string) => void;
  deleteDisabled?: boolean;
}

export function NoteItem({ note, dateLabel, onDelete, deleteDisabled = false }: NoteItemProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.note}>
      <View style={styles.body}>
        <AppText variant="caption" tone="muted">
          {dateLabel}
        </AppText>
        <AppText>{note.body}</AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Notu sil"
        hitSlop={10}
        disabled={deleteDisabled}
        onPress={() => onDelete(note.id)}
        style={({ pressed }) => [pressed && styles.pressed, deleteDisabled && styles.pressed]}
      >
        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  body: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.5 },
}));
