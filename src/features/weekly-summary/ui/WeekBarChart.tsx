import { AppText, makeStyles } from '@shared/ui';
import { View } from 'react-native';

export interface WeekBar {
  key: string;
  label: string;
  minutes: number;
  completed: number;
  ratio: number;
}

/** Seven bars, one per day. Height is minutes; the number under it is tasks. */
export function WeekBarChart({ days }: { days: readonly WeekBar[] }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {days.map((day) => (
        <View key={day.key} style={styles.column} accessibilityLabel={`${day.label}: ${day.minutes} dakika`}>
          <View style={styles.track}>
            <View style={[styles.fill, { height: `${Math.max(2, Math.round(day.ratio * 100))}%` }]} />
          </View>
          <AppText variant="caption" tone="muted">
            {day.label}
          </AppText>
          <AppText variant="caption" tone={day.completed > 0 ? 'default' : 'muted'}>
            {day.completed}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  row: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-end' },
  column: { flex: 1, alignItems: 'center', gap: spacing.xxs },
  track: {
    width: '100%',
    height: 72,
    justifyContent: 'flex-end',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  fill: { width: '100%', backgroundColor: colors.primary, borderRadius: radii.sm },
}));
