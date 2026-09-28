import { AppText, Button, makeStyles, ProgressBar } from '@shared/ui';
import { Pressable, View } from 'react-native';

export interface MissionHeaderProps {
  dateLabel: string;
  done: number;
  total: number;
  overdue: number;
  onCheckIn: () => void;
  /** Opens the backlog review; the overdue count is the way in. */
  onOpenBacklog?: () => void;
}

export function MissionHeader({ dateLabel, done, total, overdue, onCheckIn, onOpenBacklog }: MissionHeaderProps) {
  const styles = useStyles();
  const ratio = total === 0 ? 0 : done / total;
  const headline =
    total === 0 ? 'Bugün görev yok' : done === total ? 'Bugünü bitirdin' : `${total - done} görev kaldı`;

  return (
    <View style={styles.container}>
      <AppText variant="caption" tone="muted">
        {dateLabel.toUpperCase()}
      </AppText>
      <AppText variant="display" accessibilityRole="header">
        {headline}
      </AppText>

      {total > 0 ? (
        <View style={styles.progress}>
          <ProgressBar
            value={ratio}
            tone={ratio === 1 ? 'success' : 'primary'}
            height={8}
            accessibilityLabel={`${total} görevden ${done} tanesi tamam`}
          />
          <View style={styles.progressLabels}>
            <AppText variant="caption" tone="muted">
              {done}/{total} tamam
            </AppText>
            {overdue > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${overdue} geciken görevi gözden geçir`}
                disabled={onOpenBacklog === undefined}
                hitSlop={8}
                onPress={onOpenBacklog}
              >
                <AppText variant="caption" tone="warning">
                  {overdue} geciken{onOpenBacklog ? ' ›' : ''}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <Button label="Günlük değerlendirme" variant="secondary" onPress={onCheckIn} />
    </View>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  container: { gap: spacing.sm, paddingTop: spacing.lg },
  progress: { gap: spacing.xs, marginVertical: spacing.xs },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
}));
