import { SyllabusUploadCard } from '@features/syllabus-upload';
import { GeneratePlanButton } from '@features/weekly-plan';
import { AppText, Button, Card, EmptyState, ErrorState, Screen, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useCoursesScreen } from '../model/useCoursesScreen';

export function CoursesScreen() {
  const vm = useCoursesScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.error) {
    return (
      <Screen>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={vm.isRefreshing} onRefresh={vm.refresh} tintColor={colors.primary} />
        }
      >
        <AppText variant="display" accessibilityRole="header">
          Dersler
        </AppText>

        <SyllabusUploadCard
          uploads={vm.uploads}
          isUploading={vm.upload.isUploading}
          onPick={vm.upload.onPick}
          onRetry={vm.upload.onRetry}
          canRetry={vm.upload.canRetry}
          warnings={vm.upload.warnings}
          onDismissWarnings={vm.upload.onDismissWarnings}
          onRemove={vm.onRemoveUpload}
          isRemoving={vm.isRemovingUpload}
        />

        <Button label="Ders programı" variant="secondary" onPress={vm.openSchedule} />
        <Button label="Tekrar radarı" variant="secondary" onPress={vm.openRadar} />
        {vm.courses.length > 0 ? <GeneratePlanButton variant="secondary" /> : null}

        {vm.isLoading ? (
          <View style={styles.list}>
            <Skeleton height={76} radius={16} />
            <Skeleton height={76} radius={16} />
          </View>
        ) : vm.courses.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title="Henüz ders yok"
            message="Bir izlence yükle; dersin, konuları ve sınavları buraya gelsin."
          />
        ) : (
          <View style={styles.list}>
            {vm.courses.map((course) => (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                accessibilityLabel={`${course.title} dersini aç`}
                onPress={() => vm.openCourse(course.id)}
                style={({ pressed }) => (pressed ? styles.pressed : undefined)}
              >
                <Card style={styles.course}>
                <View style={[styles.accent, { backgroundColor: course.accent }]} />
                <View style={styles.courseBody}>
                  {course.code ? (
                    <AppText variant="caption" tone="muted">
                      {course.code}
                    </AppText>
                  ) : null}
                  <AppText variant="subtitle">{course.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {course.topicsLabel}
                  </AppText>
                  {course.examLabel ? (
                    <AppText variant="caption" tone="warning">
                      {course.examLabel}
                    </AppText>
                  ) : null}
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  list: { gap: spacing.sm },
  course: { flexDirection: 'row', gap: spacing.md, padding: 0, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  accent: { width: 4 },
  courseBody: { flex: 1, gap: spacing.xxs, padding: spacing.lg, paddingLeft: 0 },
}));
