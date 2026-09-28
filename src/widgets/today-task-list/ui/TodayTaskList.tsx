import { TaskCard, type TaskCardModel } from '@entities/task';
import { AppText, makeStyles, useTheme } from '@shared/ui';
import type { ReactElement } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';

export type TaskSectionKey = 'overdue' | 'today' | 'done';

export interface TaskSection {
  key: TaskSectionKey;
  title: string;
  data: TaskCardModel[];
}

export interface TodayTaskListProps {
  sections: TaskSection[];
  header: ReactElement;
  empty?: ReactElement;
  refreshing: boolean;
  onRefresh: () => void;
  onToggle: (taskId: string) => void;
  onPressTask: (taskId: string) => void;
  pendingTaskId: string | null;
}

export function TodayTaskList({
  sections,
  header,
  empty,
  refreshing,
  onRefresh,
  onToggle,
  onPressTask,
  pendingTaskId,
}: TodayTaskListProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <AppText variant="label" tone={section.key === 'overdue' ? 'warning' : 'muted'}>
            {section.title}
          </AppText>
          <AppText variant="caption" tone="muted">
            {section.data.length}
          </AppText>
        </View>
      )}
      renderItem={({ item }) => (
        <TaskCard model={item} onToggle={onToggle} onPress={onPressTask} toggleDisabled={pendingTaskId === item.id} />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    />
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  separator: { height: spacing.sm },
}));
