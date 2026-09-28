import { TaskCard, TaskCardSkeleton } from '@entities/task';
import { AppText, EmptyState, ErrorState, Screen, makeStyles, useTheme } from '@shared/ui';
import { TaskGroupFilter } from '@widgets/task-group-filter';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';
import { useWeekScreen } from '../model/useWeekScreen';

export function WeekScreen() {
  const vm = useWeekScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.error) {
    return (
      <Screen>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  if (vm.isLoading) {
    return (
      <Screen>
        <View style={styles.content}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonItem}>
              <TaskCardSkeleton />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionList
        sections={vm.sections.filter((section) => section.data.length > 0)}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Önceki hafta"
                accessibilityState={{ disabled: !vm.header.canGoBack }}
                disabled={!vm.header.canGoBack}
                onPress={vm.header.onPrevious}
                hitSlop={10}
              >
                <AppText variant="label" tone={vm.header.canGoBack ? 'primary' : 'muted'}>
                  ‹ Önceki
                </AppText>
              </Pressable>
              <AppText variant="label" tone="muted">
                {vm.header.offsetLabel}
              </AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Sonraki hafta" onPress={vm.header.onNext} hitSlop={10}>
                <AppText variant="label" tone="primary">
                  Sonraki ›
                </AppText>
              </Pressable>
            </View>
            <AppText variant="title" accessibilityRole="header">
              {vm.header.rangeLabel}
            </AppText>
            <View style={styles.progressRow}>
              <AppText variant="caption" tone="muted" style={styles.flex}>
                {vm.header.progressLabel}
              </AppText>
              <Pressable accessibilityRole="button" onPress={vm.onOpenSummary} hitSlop={8}>
                <AppText variant="caption" tone="primary">
                  Haftalık özet ›
                </AppText>
              </Pressable>
            </View>
            <TaskGroupFilter value={vm.filter.value} counts={vm.filter.counts} onChange={vm.filter.onChange} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title="Bu haftada görev yok"
            message="Görevler ekranından ya da Ayarlar → Dersler bölümünden haftalık planı oluşturabilirsin."
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <AppText variant="label" tone={section.isToday ? 'primary' : 'muted'}>
              {section.title}
              {section.isToday ? ' · bugün' : ''}
            </AppText>
            {section.minutesLabel ? (
              <AppText variant="caption" tone="muted">
                {section.minutesLabel}
              </AppText>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <TaskCard
            model={item}
            onToggle={vm.onToggle}
            onPress={vm.onPressTask}
            toggleDisabled={vm.pendingTaskId === item.id}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={vm.isRefreshing} onRefresh={vm.refresh} tintColor={colors.primary} />
        }
      />
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { gap: spacing.xs, paddingTop: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  separator: { height: spacing.sm },
  skeletonItem: { marginBottom: spacing.sm },
}));
