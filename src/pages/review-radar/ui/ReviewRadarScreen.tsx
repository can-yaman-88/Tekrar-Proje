import { TopicRow } from '@entities/topic';
import { AppText, EmptyState, ErrorState, Screen, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { RefreshControl, SectionList, View } from 'react-native';
import { useReviewRadarScreen } from '../model/useReviewRadarScreen';

export function ReviewRadarScreen() {
  const vm = useReviewRadarScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.refresh} />
      </Screen>
    );
  }

  if (vm.isLoading) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton height={64} radius={10} />
          <Skeleton height={64} radius={10} />
          <Skeleton height={64} radius={10} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <SectionList
        sections={vm.sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <AppText tone="muted" style={styles.intro}>
            Unutulmak üzere olanı gösterir. Tekrar günü gelen konunun görevi o gün Görevler ekranına düşer
            (Feynman sayfası, ertesi gün sınav). Bir konuya dokun: ne zaman çalıştığını, güven puanını ve
            bütün tekrar geçmişini gör.
          </AppText>
        }
        ListEmptyComponent={
          <EmptyState
            icon="radio-outline"
            title="Radar boş"
            message="Konular çalışılmaya başlandıkça tekrar takvimi burada oluşur."
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <AppText variant="label" tone={section.key === 'due' ? 'danger' : 'muted'}>
                {section.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {section.data.length}
              </AppText>
            </View>
            <AppText variant="caption" tone="muted">
              {section.hint}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => <TopicRow model={item} onPress={vm.onOpenTopic} />}
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
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  intro: { marginBottom: spacing.sm },
  sectionHeader: { gap: spacing.xxs, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between' },
  separator: { height: spacing.sm },
}));
