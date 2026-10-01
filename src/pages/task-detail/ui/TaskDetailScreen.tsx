import { NoteItem } from '@entities/task-note';
import { MistakeList } from '@entities/topic-mistake';
import { NoteComposer } from '@features/task-note-add';
import { TaskTimerCard } from '@features/task-timer';
import { formatShortDate, localDateOf } from '@shared/lib/date';
import { AppText, Card, ErrorState, Screen, Skeleton, makeStyles } from '@shared/ui';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useTaskDetail } from '../model/useTaskDetail';
import { TaskAllocationSection } from './TaskAllocationSection';
import { TaskEditSection } from './TaskEditSection';
import { TaskSubtaskSection } from './TaskSubtaskSection';

export function TaskDetailScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const detail = useTaskDetail(taskId);
  const styles = useStyles();

  if (detail.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState
          title={detail.error.title}
          message={detail.error.message}
          actionLabel={detail.error.canRetry ? 'Tekrar dene' : undefined}
          onAction={detail.retry}
        />
      </Screen>
    );
  }

  if (detail.isLoading || !detail.task || !detail.header) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="80%" height={24} />
          <Skeleton height={46} radius={10} />
          <Skeleton height={46} radius={10} />
          <Skeleton height={96} radius={10} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerBlock}>
            <AppText variant="caption" tone="muted">
              {detail.header.course} · {detail.header.topic}
            </AppText>
            <AppText variant="title" accessibilityRole="header">
              {detail.task.title}
            </AppText>
            <AppText variant="caption" tone="muted">
              {detail.header.typeLabel} · {detail.header.statusLabel}
              {detail.header.completedLabel ? ` · ${detail.header.completedLabel}` : ''}
            </AppText>
            {detail.header.accuracyLabel ? (
              <AppText variant="caption" tone="muted">
                {detail.header.accuracyLabel}
              </AppText>
            ) : null}
            {detail.review ? (
              <Pressable accessibilityRole="button" onPress={detail.review.onOpen} hitSlop={8} style={styles.reviewLink}>
                <AppText variant="caption" tone={detail.review.isDue ? 'warning' : 'primary'}>
                  {detail.review.label} ›
                </AppText>
              </Pressable>
            ) : null}
          </View>

          <MistakeList
            mistakes={detail.mistakes}
            onResolve={detail.onResolveMistake}
            resolvingId={detail.resolvingMistakeId}
          />

          <TaskSubtaskSection task={detail.task} />

          {detail.showsAllocation ? <TaskAllocationSection task={detail.task} /> : null}

          <TaskTimerCard timer={detail.timer} />

          <TaskEditSection task={detail.task} />

          <View style={styles.notes}>
            <AppText variant="subtitle">Notlar</AppText>
            <NoteComposer form={detail.noteForm} />
            {detail.notesLoading ? (
              <Skeleton height={64} radius={10} />
            ) : detail.notes.length === 0 ? (
              <Card>
                <AppText tone="muted">
                  Henüz not yok. Takıldığın yeri yazarsan bir sonraki tekrarda karşına çıkar.
                </AppText>
              </Card>
            ) : (
              detail.notes.map((note) => (
                <NoteItem
                  key={note.id}
                  note={note}
                  dateLabel={formatShortDate(localDateOf(note.createdAt))}
                  onDelete={detail.noteForm.onDelete}
                  deleteDisabled={detail.noteForm.isDeleting}
                />
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerBlock: { gap: spacing.xxs },
  reviewLink: { alignSelf: 'flex-start', paddingTop: spacing.xs },
  notes: { gap: spacing.sm, marginTop: spacing.lg },
}));
