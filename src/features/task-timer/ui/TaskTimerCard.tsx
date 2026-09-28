import { AppText, Button, Card, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { TaskTimerController } from '../model/useTaskTimer';

export function TaskTimerCard({ timer }: { timer: TaskTimerController }) {
  const styles = useStyles();

  return (
    <Card>
      <View style={styles.header}>
        <AppText variant="subtitle">Çalışma süresi</AppText>
        {timer.measuredMinutes > 0 ? (
          <AppText variant="caption" tone="muted">
            {timer.measuredMinutes} dk · {timer.sessionCount} oturum
          </AppText>
        ) : null}
      </View>

      {timer.isRunning ? (
        <View style={styles.runningRow}>
          <AppText variant="title" style={styles.clock}>
            {timer.elapsedLabel}
          </AppText>
          <Button label="Bitir" variant="secondary" onPress={timer.onStop} loading={timer.isBusy} />
        </View>
      ) : (
        <Button label="Zamanlayıcıyı başlat" onPress={timer.onStart} loading={timer.isBusy} />
      )}

      {timer.runningElsewhere ? (
        <AppText variant="caption" tone="muted">
          Başka bir görevde sayaç açık. Buradan başlatırsan o oturum kapatılır.
        </AppText>
      ) : null}

      {timer.isRunning ? null : (
        <View style={styles.quickRow}>
          <AppText variant="caption" tone="muted">
            Elle ekle:
          </AppText>
          {timer.quickMinutes.map((minutes) => (
            <Pressable
              key={minutes}
              style={styles.chip}
              disabled={timer.isBusy}
              accessibilityRole="button"
              accessibilityLabel={`${minutes} dakika ekle`}
              onPress={() => timer.onLogMinutes(minutes)}
            >
              <AppText variant="caption">{minutes} dk</AppText>
            </Pressable>
          ))}
        </View>
      )}

      {timer.calibration ? (
        <AppText variant="caption" tone="muted">
          {timer.calibration}
        </AppText>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  runningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  clock: { fontVariant: ['tabular-nums'] },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
