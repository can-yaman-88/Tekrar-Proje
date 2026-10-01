import { TopicRow } from '@entities/topic';
import { ExamForm } from '@features/exam-edit';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, ErrorState, Screen, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useCourseDetailScreen } from '../model/useCourseDetailScreen';
import { TermWeekCard } from '@features/term-week';

export function CourseDetailScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const {
    isLoading,
    error,
    retry,
    view,
    examEditor,
    term,
    onToggleAdvanced,
    isTogglingAdvanced,
    onDelete,
    isDeleting,
    onOpenExam,
    onOpenTopic,
  } =
    useCourseDetailScreen(courseId);
  const styles = useStyles();
  const { colors } = useTheme();

  if (error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={error.title} message={error.message} actionLabel="Tekrar dene" onAction={retry} />
      </Screen>
    );
  }

  if (isLoading || !view) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton width="60%" height={24} />
          <Skeleton height={72} radius={16} />
          <Skeleton height={64} radius={10} />
          <Skeleton height={64} radius={10} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: view.subtitle ?? view.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          {view.title}
        </AppText>

        <View style={styles.stats}>
          {view.stats.map((stat) => (
            <Card key={stat.label} style={styles.stat}>
              <AppText variant="title">{stat.value}</AppText>
              <AppText variant="caption" tone="muted">
                {stat.label}
              </AppText>
            </Card>
          ))}
        </View>

        <TermWeekCard term={term} />

        <View style={styles.section}>
          <AppText variant="label" tone="muted">
            Sınavlar
          </AppText>
          {view.exams.length === 0 ? (
            <Card>
              <AppText tone="muted">
                Bu derste sınav yok. İzlenceden tarih çıkmadıysa aşağıdan elle ekleyebilirsin.
              </AppText>
            </Card>
          ) : (
            view.exams.map((exam) => (
              <Card key={exam.id} style={styles.examRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${exam.title} sınav modunu aç`}
                  style={styles.flex}
                  onPress={() => onOpenExam(exam.id)}
                >
                  <AppText>{exam.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {exam.kindLabel} · sınav modu
                  </AppText>
                </Pressable>
                <AppText variant="caption" tone={exam.isPast ? 'muted' : 'warning'}>
                  {exam.dateLabel} · {exam.countdown}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${exam.title} sınavını sil`}
                  hitSlop={10}
                  disabled={examEditor.isRemoving}
                  onPress={() => examEditor.onRemove(exam.id)}
                  style={({ pressed }) => (pressed || examEditor.isRemoving ? styles.pressed : undefined)}
                >
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </Card>
            ))
          )}
          <ExamForm form={examEditor} />
        </View>

        {view.weakTopics.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="label" tone="danger">
              Zayıf konular
            </AppText>
            <AppText variant="caption" tone="muted">
              Takıldığın ya da tekrar aralığı kısalan konular. Haftalık plan bunlara öncelik verir.
            </AppText>
            {view.weakTopics.map((topic) => (
              <TopicRow key={topic.id} model={topic} onPress={onOpenTopic} />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <AppText variant="label" tone="muted">
            Tüm konular
          </AppText>
          {view.topics.length === 0 ? (
            <Card>
              <AppText tone="muted">Bu derste konu yok. İzlence yükleyerek ekleyebilirsin.</AppText>
            </Card>
          ) : (
            view.topics.map((topic) => (
              <TopicRow
                key={topic.id}
                model={topic}
                onPress={onOpenTopic}
                onToggleAdvanced={onToggleAdvanced}
                toggleDisabled={isTogglingAdvanced}
              />
            ))
          )}
        </View>

        <Button
          label="Dersi sil"
          variant="ghost"
          loading={isDeleting}
          onPress={() =>
            Alert.alert(
              'Dersi sil',
              `${view.title} dersi, konuları, sınavları, görevleri ve ders programındaki saatleri kalıcı olarak silinecek.`,
              [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Sil', style: 'destructive', onPress: onDelete },
              ],
            )
          }
        />
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm },
  section: { gap: spacing.sm, marginTop: spacing.md },
  examRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  flex: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.5 },
}));
