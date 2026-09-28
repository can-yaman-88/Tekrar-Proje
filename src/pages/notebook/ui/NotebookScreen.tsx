import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SegmentedControl,
  Skeleton,
  makeStyles,
  useTheme,
} from '@shared/ui';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useNotebookScreen, type BookFilter } from '../model/useNotebookScreen';

const FILTERS: { value: BookFilter; label: string }[] = [
  { value: 'open', label: 'Açık' },
  { value: 'resolved', label: 'Çözülen' },
  { value: 'all', label: 'Hepsi' },
];

export function NotebookScreen() {
  const vm = useNotebookScreen();
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
        <View style={styles.headerRow}>
          <AppText variant="display" accessibilityRole="header">
            Defter
          </AppText>
          <Pressable accessibilityRole="button" onPress={vm.onOpenProgress} hitSlop={8}>
            <AppText variant="caption" tone="primary">
              Gidişat ›
            </AppText>
          </Pressable>
        </View>

        {vm.isLoading ? (
          <View style={styles.section}>
            <Skeleton height={96} radius={16} />
            <Skeleton height={140} radius={16} />
          </View>
        ) : (
          <>
            <Card style={styles.card}>
              <View style={styles.headerRow}>
                <AppText variant="subtitle">Tekrar sırada</AppText>
                <Pressable accessibilityRole="button" onPress={vm.onOpenRadar} hitSlop={8}>
                  <AppText variant="caption" tone="primary">
                    Tümü ›
                  </AppText>
                </Pressable>
              </View>
              {vm.reviews.length === 0 ? (
                <AppText tone="muted">Yakın günlerde tekrar bekleyen konu yok.</AppText>
              ) : (
                vm.reviews.map((review) => (
                  <View key={review.id} style={styles.row}>
                    <AppText style={styles.flex} numberOfLines={1}>
                      {review.title}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {review.courseLabel}
                    </AppText>
                    <AppText variant="caption" tone={review.isDue ? 'warning' : 'muted'} style={styles.due}>
                      {review.dueLabel}
                    </AppText>
                  </View>
                ))
              )}
            </Card>

            <View style={styles.headerRow}>
              <AppText variant="subtitle">Takıldığım yerler</AppText>
              <AppText variant="caption" tone="muted">
                {vm.openCount} açık
              </AppText>
            </View>

            <SegmentedControl<BookFilter>
              options={FILTERS}
              value={vm.filter}
              onChange={vm.onFilter}
              accessibilityLabel="Defter filtresi"
            />

            {vm.groups.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title={vm.filter === 'resolved' ? 'Çözülen madde yok' : 'Defter boş'}
                message={
                  vm.filter === 'resolved'
                    ? 'Bir maddeyi çözdüğünde burada birikir.'
                    : 'Değerlendirmede nerede takıldığını yazdıkça buraya işlenir.'
                }
              />
            ) : (
              vm.groups.map((group) => (
                <Card key={group.key} style={styles.card}>
                  <AppText variant="caption" tone="muted">
                    {group.courseLabel}
                  </AppText>
                  <AppText variant="label">{group.topicTitle}</AppText>
                  {group.rows.map((row) => (
                    <View key={row.id} style={styles.row}>
                      <AppText style={[styles.flex, row.isResolved && styles.resolved]}>• {row.label}</AppText>
                      {row.isResolved ? (
                        <AppText variant="caption" tone="success">
                          çözüldü
                        </AppText>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`"${row.label}" maddesini çözüldü olarak işaretle`}
                          hitSlop={8}
                          disabled={vm.resolvingId === row.id}
                          onPress={() => vm.onResolve(row.id)}
                        >
                          <AppText variant="caption" tone={vm.resolvingId === row.id ? 'muted' : 'primary'}>
                            Çözüldü
                          </AppText>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  section: { gap: spacing.md },
  card: { gap: spacing.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  due: { width: 64, textAlign: 'right' },
  resolved: { textDecorationLine: 'line-through', opacity: 0.6 },
}));
