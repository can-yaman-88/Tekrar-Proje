import { TASK_GROUP_LABEL, TASK_GROUPS, type TaskGroup } from '@entities/task';
import { AppText, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';

export type TaskGroupFilterValue = TaskGroup | 'all';

export interface TaskGroupFilterProps {
  value: TaskGroupFilterValue;
  counts: Readonly<Record<TaskGroup, number>>;
  onChange: (value: TaskGroupFilterValue) => void;
}

/** Tümü / Concepts / Sınav / Feynman — the only grouping the student uses. */
export function TaskGroupFilter({ value, counts, onChange }: TaskGroupFilterProps) {
  const styles = useStyles();
  const options: { key: TaskGroupFilterValue; label: string; count: number | null }[] = [
    { key: 'all', label: 'Tümü', count: null },
    ...TASK_GROUPS.map((group) => ({ key: group, label: TASK_GROUP_LABEL[group], count: counts[group] })),
  ];

  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel="Etikete göre filtrele">
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
          >
            <AppText variant="caption" tone={selected ? 'inverse' : 'muted'}>
              {option.label}
              {option.count === null ? '' : ` ${option.count}`}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  chipSelected: { backgroundColor: colors.primary },
  pressed: { opacity: 0.7 },
}));
