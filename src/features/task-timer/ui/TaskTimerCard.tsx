import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, ProgressBar, Skeleton, TextField, makeStyles, useTheme } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { TaskTimerController } from '../model/useTaskTimer';

export function TaskTimerCard({ timer }: { timer: TaskTimerController }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <AppText variant="subtitle">Çalışma süresi</AppText>
        {timer.hasTime ? <AppText variant="subtitle">{timer.totalLabel}</AppText> : null}
      </View>
      {timer.summary ? (
        <AppText variant="caption" tone="muted">
          {timer.summary}
        </AppText>
      ) : null}

      {timer.estimate ? (
        <View style={styles.estimate}>
          <ProgressBar
            value={timer.estimate.ratio}
            tone={timer.estimate.isOver ? 'warning' : 'primary'}
            height={6}
            accessibilityLabel={timer.estimate.label}
          />
          <AppText variant="caption" tone={timer.estimate.isOver ? 'warning' : 'muted'}>
            {timer.estimate.label}
          </AppText>
        </View>
      ) : null}

      {timer.isRunning ? (
        <View style={styles.running}>
          <AppText variant="display" style={styles.clock} accessibilityLabel={`Geçen süre ${timer.elapsedLabel}`}>
            {timer.elapsedLabel}
          </AppText>
          <View style={styles.row}>
            <Button label="Bitir ve kaydet" onPress={timer.onStop} loading={timer.isBusy} style={styles.flex} />
            <Button label="Vazgeç" variant="ghost" onPress={timer.onDiscardRunning} disabled={timer.isRemoving} />
          </View>
        </View>
      ) : timer.isOpen ? (
        <View style={styles.actions}>
          <Button label="Zamanlayıcıyı başlat" onPress={timer.onStart} loading={timer.isBusy} />
          {timer.focusTimer ? (
            <Button
              label={timer.focusTimer.label}
              variant="secondary"
              onPress={timer.focusTimer.onOpen}
              loading={timer.focusTimer.isOpening}
            />
          ) : null}
        </View>
      ) : (
        <AppText variant="caption" tone="muted">
          Görev kapandı. Görevden uzakta çalıştıysan süreyi aşağıdan elle ekleyebilirsin.
        </AppText>
      )}

      {timer.runningElsewhere ? (
        <AppText variant="caption" tone="warning">
          Başka bir görevde sayaç açık. Buradan başlatırsan o oturum kapatılır.
        </AppText>
      ) : null}

      {timer.isRunning ? null : timer.custom.isOpen ? (
        <View style={styles.customRow}>
          <View style={styles.flex}>
            <TextField
              label="Dakika"
              value={timer.custom.text}
              onChangeText={timer.custom.onChangeText}
              keyboardType="number-pad"
              placeholder="ör. 35"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={timer.custom.onSubmit}
            />
          </View>
          <Button label="Ekle" onPress={timer.custom.onSubmit} disabled={!timer.custom.isValid} loading={timer.isBusy} />
          <Pressable accessibilityRole="button" accessibilityLabel="Vazgeç" hitSlop={10} onPress={timer.custom.onClose}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
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
          <Pressable
            style={styles.chip}
            disabled={timer.isBusy}
            accessibilityRole="button"
            accessibilityLabel="Başka bir süre ekle"
            onPress={timer.custom.onOpen}
          >
            <AppText variant="caption">Diğer…</AppText>
          </Pressable>
        </View>
      )}

      {timer.isGroup && timer.stepTimes.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="label" tone="muted">
            Adımlar
          </AppText>
          {timer.stepTimes.map((step) => (
            <View key={step.id} style={styles.row}>
              <AppText style={[styles.flex, step.isDone && styles.done]} numberOfLines={1}>
                {step.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {step.minutesLabel}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {timer.isLoading ? (
        <Skeleton height={36} radius={8} />
      ) : timer.sessions.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="label" tone="muted">
            Oturumlar
          </AppText>
          {timer.sessions.map((session) => (
            <View key={`${session.clock}-${session.id}`} style={styles.sessionRow}>
              <Ionicons
                name={session.clock === 'focus_timer' ? 'phone-portrait-outline' : 'timer-outline'}
                size={16}
                color={colors.textMuted}
              />
              <View style={styles.flex}>
                <AppText>
                  {session.whenLabel} · {session.minutesLabel}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {session.detail}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${session.whenLabel} oturumunu sil`}
                hitSlop={10}
                disabled={timer.isRemoving}
                onPress={() => timer.onDeleteSession(session)}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          {timer.hiddenSessions > 0 ? (
            <Pressable accessibilityRole="button" onPress={timer.onShowAll} hitSlop={8}>
              <AppText variant="caption" tone="primary">
                Tümünü göster (+{timer.hiddenSessions})
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  estimate: { gap: spacing.xxs },
  running: { gap: spacing.sm, alignItems: 'stretch' },
  clock: { fontVariant: ['tabular-nums'], textAlign: 'center' },
  actions: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  customRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  section: { gap: spacing.xs, marginTop: spacing.xs },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxs },
  done: { textDecorationLine: 'line-through', opacity: 0.7 },
}));
