import { useLearnedCapacity } from '@features/capacity';
import { useExamModeScreen } from '@features/exam-mode';
import { AppText, Button, Card, EmptyState, ErrorState, Screen, Skeleton, TextField, makeStyles } from '@shared/ui';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

export function ExamModeScreen() {
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const capacity = useLearnedCapacity();
  const capacityByWeekday = useMemo(
    () => Object.fromEntries(capacity.rows.map((row) => [row.weekday, row.minutes])),
    [capacity.rows],
  );
  const vm = useExamModeScreen(examId, { capacityByWeekday });
  const styles = useStyles();

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  if (vm.isLoading || !vm.header) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton width="60%" height={24} />
          <Skeleton height={120} radius={16} />
          <Skeleton height={160} radius={16} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <AppText variant="caption" tone="muted">
            {vm.header.course} · {vm.header.kindLabel}
          </AppText>
          <AppText variant="title" accessibilityRole="header">
            {vm.header.title}
          </AppText>
          <AppText variant="subtitle" tone={vm.header.isUrgent ? 'danger' : 'default'}>
            {vm.header.countdown}
          </AppText>
          <AppText variant="caption" tone="muted">
            {vm.header.dateLabel}
          </AppText>
        </View>

        {vm.readiness.length === 0 ? (
          <EmptyState
            icon="link-outline"
            title="Bu sınava bağlı konu yok"
            message="Ders sayfasından konuları bu sınava bağladığında hazırlık durumun burada çıkar."
          />
        ) : (
          <Card style={styles.card}>
            <AppText variant="subtitle">Konu hazırlığı</AppText>
            {vm.readiness.map((row) => (
              <View key={row.id} style={styles.readinessBlock}>
                <View style={styles.readinessRow}>
                  <AppText style={styles.flex} numberOfLines={1}>
                    {row.title}
                  </AppText>
                  <AppText
                    variant="caption"
                    tone={row.mastery === 'weak' ? 'danger' : row.mastery === 'fair' ? 'warning' : 'success'}
                  >
                    {row.masteryLabel}
                  </AppText>
                  <AppText variant="caption" tone="muted" style={styles.detail}>
                    {row.detail}
                  </AppText>
                </View>
                {row.mistakes.map((mistake) => (
                  <AppText key={mistake} variant="caption" tone="muted" style={styles.mistake}>
                    ↳ {mistake}
                  </AppText>
                ))}
              </View>
            ))}
          </Card>
        )}

        {vm.isPast ? (
          <RetroCard vm={vm} />
        ) : vm.outOfWindow ? (
          <Card style={styles.card}>
            <AppText variant="subtitle">Sınav modu</AppText>
            <AppText tone="muted">
              Sınava {vm.windowDays} günden fazla var. Şimdilik haftalık plan yeterli; sınav yaklaşınca buradaki
              sprint planı devreye girer.
            </AppText>
          </Card>
        ) : (
          <Card style={styles.card}>
            <AppText variant="subtitle">Kalan günlerin planı</AppText>
            {vm.planDays.length === 0 ? (
              <AppText tone="muted">Planlanacak adım kalmadı; konuların hazır görünüyor.</AppText>
            ) : (
              vm.planDays.map((day) => (
                <View key={day.date} style={styles.day}>
                  <View style={styles.dayHeader}>
                    <AppText variant="label">{day.label}</AppText>
                    <AppText variant="caption" tone="muted">
                      {day.minutes} dk
                    </AppText>
                  </View>
                  {day.items.map((item) => (
                    <AppText key={item.key} variant="caption" tone="muted">
                      · {item.title} ({item.minutes} dk)
                    </AppText>
                  ))}
                </View>
              ))
            )}
            {vm.notes.map((note) => (
              <AppText key={note} variant="caption" tone="muted">
                {note}
              </AppText>
            ))}
            {vm.cramTasks.total > 0 ? (
              <AppText variant="caption" tone="muted">
                Bu sınav için {vm.cramTasks.total} görev oluşturulmuş, {vm.cramTasks.open} tanesi açık.
              </AppText>
            ) : null}
            {vm.planDays.length > 0 ? (
              <Button
                label={vm.cramTasks.open > 0 ? 'Planı güncelle' : 'Planı görevlere ekle'}
                loading={vm.isCreating}
                onPress={vm.onCreateTasks}
              />
            ) : null}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function RetroCard({ vm }: { vm: ReturnType<typeof useExamModeScreen> }) {
  const styles = useStyles();
  const { retro } = vm;

  if (vm.isReviewed) {
    return (
      <Card style={styles.card}>
        <AppText variant="subtitle">Sınav değerlendirildi</AppText>
        <AppText tone="muted">
          Sonucu kaydettin; bu sınavın konuları tekrar takvimine buna göre yerleşti.
        </AppText>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">Sınav nasıl geçti?</AppText>
      <AppText variant="caption" tone="muted">
        Cevabın konuların tekrar aralıklarını belirler. Özellikle zorlandığın konuları işaretlersen sınav iyi geçse
        bile onlar tekrara döner.
      </AppText>

      <View style={styles.options}>
        {retro.options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: retro.outcome === option.value }}
            style={[styles.option, retro.outcome === option.value && styles.optionSelected]}
            onPress={() => retro.setOutcome(option.value)}
          >
            <AppText variant="caption">{option.label}</AppText>
          </Pressable>
        ))}
      </View>

      {retro.topics.length > 0 ? (
        <View style={styles.options}>
          <AppText variant="caption" tone="muted">
            Zorlandığın konular:
          </AppText>
          {retro.topics.map((topic) => (
            <Pressable
              key={topic.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: retro.flagged.includes(topic.id) }}
              style={[styles.option, retro.flagged.includes(topic.id) && styles.optionSelected]}
              onPress={() => retro.onToggleFlag(topic.id)}
            >
              <AppText variant="caption">{topic.title}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextField
        label="Not (isteğe bağlı)"
        value={retro.note}
        onChangeText={retro.setNote}
        multiline
        maxLength={500}
        placeholder="Hangi soru tipinde zorlandın?"
      />

      <Button label="Sonucu kaydet" loading={retro.isSaving} disabled={!retro.canSubmit} onPress={retro.onSubmit} />
    </Card>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { gap: spacing.xxs },
  card: { gap: spacing.sm },
  flex: { flex: 1 },
  readinessBlock: { gap: spacing.xxs },
  readinessRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mistake: { marginLeft: spacing.sm },
  detail: { width: 84, textAlign: 'right' },
  day: { gap: spacing.xxs, marginTop: spacing.xs },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  option: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
}));
