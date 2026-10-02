import { ConfidenceSheet } from '@entities/topic';
import { AttachmentSection } from '@features/attachments';
import { MistakeComposer, MistakeEntry } from '@features/mistake-book';
import {
  AppText,
  Button,
  Card,
  ErrorState,
  ProgressBar,
  Screen,
  Skeleton,
  makeStyles,
  type TextTone,
} from '@shared/ui';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useTopicReviewScreen, type TopicTaskRow } from '../model/useTopicReviewScreen';

const MASTERY_TONE: Record<string, TextTone> = { new: 'muted', weak: 'danger', learning: 'warning', solid: 'success' };
const MEMORY_BAR = { new: 'primary', fresh: 'success', fading: 'warning', due: 'warning', overdue: 'warning' } as const;
const MEMORY_TONE: Record<string, TextTone> = {
  new: 'muted',
  fresh: 'success',
  fading: 'warning',
  due: 'warning',
  overdue: 'danger',
};

export function TopicReviewScreen() {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const vm = useTopicReviewScreen(topicId);
  const styles = useStyles();

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  if (vm.isLoading || !vm.header || !vm.status) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="80%" height={24} />
          <Skeleton height={180} radius={16} />
          <Skeleton height={120} radius={16} />
        </View>
      </Screen>
    );
  }

  const { status } = vm;

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={vm.isRefreshing} onRefresh={vm.refresh} />}
        >
          <View style={styles.headerBlock}>
            <AppText variant="caption" tone="muted">
              {vm.header.caption}
            </AppText>
            <AppText variant="title" accessibilityRole="header">
              {vm.header.title}
            </AppText>
            <View style={styles.badges}>
              <View style={styles.badge}>
                <AppText variant="caption" tone={MASTERY_TONE[status.mastery]}>
                  {status.masteryLabel}
                </AppText>
              </View>
              <View style={styles.badge}>
                <AppText variant="caption" tone={MEMORY_TONE[status.memory]}>
                  {status.memoryLabel}
                </AppText>
              </View>
            </View>
          </View>

          <Card style={styles.card}>
            <AppText variant="label">Tekrar durumu</AppText>
            <Fact label="Sıradaki tekrar" value={status.nextLabel} tone={status.isDue ? 'warning' : 'default'} />
            <ProgressBar
              value={status.elapsed}
              tone={MEMORY_BAR[status.memory]}
              height={6}
              accessibilityLabel={`Tekrar aralığının yüzde ${Math.round(status.elapsed * 100)}'i geçti`}
            />
            <Fact label="Son çalışma" value={status.lastLabel} />
            <Fact label="Son güven puanı" value={status.confidenceLabel} />
            <Fact label="Son isabet" value={status.accuracyLabel} />
            <Fact label="Çalışma süresi" value={vm.studyLabel} />
            <View style={styles.stats}>
              {status.stats.map((stat) => (
                <View key={stat.label} style={styles.stat}>
                  <AppText variant="subtitle">{stat.value}</AppText>
                  <AppText variant="caption" tone="muted">
                    {stat.label}
                  </AppText>
                </View>
              ))}
            </View>
            <AppText variant="caption" tone="muted">
              Tekrar günü geldiğinde görevi Görevler ekranına kendiliğinden düşer. Vaktinden önce çalışırsan aralık
              uzamaz, saat yeniden başlar; takılırsan konu ertesi güne döner.
            </AppText>
          </Card>

          <View style={styles.section}>
            <Button label="Bugün tekrar ettim" loading={vm.review.isSaving} onPress={vm.review.onStart} />
            <AppText variant="caption" tone="muted">
              {vm.review.openTaskTitle
                ? `Bugünkü "${vm.review.openTaskTitle}" görevin de bununla birlikte kapanır.`
                : 'Görev olmadan çalıştıysan buradan kaydet; 1–5 arası ne kadar hatırladığını sorar.'}
            </AppText>
          </View>

          <View style={styles.section}>
            <AppText variant="subtitle">Tekrar geçmişi</AppText>
            {vm.history.length === 0 ? (
              <Card>
                <AppText tone="muted">
                  Henüz sayılmış bir tekrar yok. Bu konunun bir görevini bitirdiğinde ya da değerlendirmede
                  bahsettiğinde burada görünür.
                </AppText>
              </Card>
            ) : (
              <Card style={styles.timeline}>
                {vm.history.map((row, index) => (
                  <View key={row.id} style={[styles.timelineRow, index > 0 && styles.timelineDivider]}>
                    <View style={styles.timelineDate}>
                      <AppText variant="label">{row.dateLabel}</AppText>
                      <AppText variant="caption" tone="muted">
                        {row.sourceLabel}
                      </AppText>
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="label" tone={row.tone}>
                        {row.verdict}
                      </AppText>
                      {row.detail ? (
                        <AppText variant="caption" tone="muted">
                          {row.detail}
                        </AppText>
                      ) : null}
                      <AppText variant="caption" tone="muted">
                        {row.change}
                      </AppText>
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <AppText variant="subtitle">Takıldığın yerler</AppText>
              <AppText variant="caption" tone="muted">
                {vm.mistakes.openCount} açık
              </AppText>
            </View>
            <Card style={styles.card}>
              {vm.mistakes.entries.length === 0 && !vm.mistakes.isAdding ? (
                <AppText tone="muted">Bu konuda kayıtlı takılma yok.</AppText>
              ) : null}
              {vm.mistakes.entries.map((entry) => (
                <MistakeEntry key={entry.id} entry={entry} actions={vm.mistakes.actions} />
              ))}
              {vm.mistakes.isAdding ? (
                <MistakeComposer topicId={topicId} actions={vm.mistakes.actions} onDone={vm.mistakes.onStopAdding} />
              ) : (
                <Pressable accessibilityRole="button" onPress={vm.mistakes.onStartAdding} hitSlop={8}>
                  <AppText variant="caption" tone="primary">
                    + Madde ekle
                  </AppText>
                </Pressable>
              )}
            </Card>
          </View>

          <AttachmentSection topicId={topicId} title="Konunun ekleri" />

          <View style={styles.section}>
            <AppText variant="subtitle">Görevler</AppText>
            {vm.openTasks.length === 0 && vm.doneTasks.length === 0 ? (
              <Card>
                <AppText tone="muted">Bu konuya bağlı görev yok.</AppText>
              </Card>
            ) : (
              <Card style={styles.card}>
                {vm.openTasks.map((task) => (
                  <TaskLine key={task.id} task={task} onPress={vm.onOpenTask} />
                ))}
                {vm.doneTasks.length > 0 ? (
                  <AppText variant="caption" tone="muted" style={styles.subhead}>
                    Son bitenler
                  </AppText>
                ) : null}
                {vm.doneTasks.map((task) => (
                  <TaskLine key={task.id} task={task} onPress={vm.onOpenTask} />
                ))}
              </Card>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfidenceSheet {...vm.review.sheet} />
    </Screen>
  );
}

function Fact({ label, value, tone = 'default' }: { label: string; value: string; tone?: TextTone }) {
  const styles = useStyles();
  return (
    <View style={styles.fact}>
      <AppText variant="caption" tone="muted" style={styles.factLabel}>
        {label}
      </AppText>
      <AppText variant="label" tone={tone} style={styles.factValue}>
        {value}
      </AppText>
    </View>
  );
}

function TaskLine({ task, onPress }: { task: TopicTaskRow; onPress: (taskId: string) => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(task.id)}
      style={({ pressed }) => [styles.taskLine, pressed && styles.pressed]}
    >
      <AppText style={task.isDone ? styles.done : undefined} numberOfLines={2}>
        {task.title}
      </AppText>
      <AppText variant="caption" tone={task.isLate ? 'warning' : 'muted'}>
        {task.meta}
      </AppText>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  headerBlock: { gap: spacing.xxs },
  badges: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  card: { gap: spacing.sm },
  section: { gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fact: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  factLabel: { width: 110 },
  factValue: { flex: 1 },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xxs },
  timeline: { gap: 0, paddingVertical: spacing.sm },
  timelineRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  timelineDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  timelineDate: { width: 84, gap: spacing.xxs },
  subhead: { marginTop: spacing.sm },
  taskLine: { gap: spacing.xxs, paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
  done: { textDecorationLine: 'line-through', opacity: 0.7 },
}));
