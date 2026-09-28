import { TaskCard, TaskCardSkeleton } from '@entities/task';
import { AppText, Button, Card, EmptyState, ErrorState, Screen, makeStyles, useTheme } from '@shared/ui';
import { RefreshControl, SectionList, View } from 'react-native';
import { useHistoryScreen } from '../model/useHistoryScreen';

export function HistoryScreen() {
  const vm = useHistoryScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.isLoading) {
    return (
      <Screen>
        <View style={styles.content}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonItem}>
              <TaskCardSkeleton />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  if (vm.error) {
    return (
      <Screen>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.refresh} />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionList
        sections={vm.sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <AppText variant="display" accessibilityRole="header">
              Tamamlananlar
            </AppText>
            <Button label="Değerlendirmeler" variant="secondary" onPress={vm.openCheckinHistory} />
            <View style={styles.stats}>
              <Card style={styles.stat}>
                <AppText variant="title" tone="success">
                  {vm.stats.completed}
                </AppText>
                <AppText variant="caption" tone="muted">
                  tamamlandı
                </AppText>
              </Card>
              <Card style={styles.stat}>
                <AppText variant="title" tone="danger">
                  {vm.stats.failed}
                </AppText>
                <AppText variant="caption" tone="muted">
                  takıldım
                </AppText>
              </Card>
              <Card style={styles.stat}>
                <AppText variant="title">{vm.stats.total}</AppText>
                <AppText variant="caption" tone="muted">
                  toplam
                </AppText>
              </Card>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="checkmark-done-outline"
            title="Henüz biten görev yok"
            message="Bir görevi tamamladığında burada geçmişini görürsün."
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <AppText variant="label" tone="muted">
              {section.title}
            </AppText>
            <AppText variant="caption" tone="muted">
              {section.data.length}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => <TaskCard model={item} onPress={vm.openTask} showToggle={false} />}
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
  header: { gap: spacing.md, paddingTop: spacing.lg },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  separator: { height: spacing.sm },
  skeletonItem: { marginBottom: spacing.sm },
}));
