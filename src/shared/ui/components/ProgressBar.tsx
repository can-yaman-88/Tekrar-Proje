import { View } from 'react-native';
import { makeStyles, useTheme } from '../theme';

export interface ProgressBarProps {
  /** 0…1 */
  value: number;
  tone?: 'primary' | 'success' | 'warning';
  height?: number;
  accessibilityLabel?: string;
}

export function ProgressBar({ value, tone = 'primary', height = 6, accessibilityLabel }: ProgressBarProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const clamped = Math.min(1, Math.max(0, value));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: colors[tone], borderRadius: height / 2 }]} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  track: { width: '100%', backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%' },
}));
