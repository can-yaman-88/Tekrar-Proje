import { AppText, Card, EmptyState, ErrorState, ProgressBar, Screen, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useProgressScreen } from '../model/useProgressScreen';

export function ProgressScreen() {
  const vm = useProgressScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={vm.isRefreshing} onRefresh={vm.refresh} tintColor={colors.primary} />
        }
      >
        <AppText variant="caption" tone="muted">
          Her ders için: kaç konunun döngüsü bitti, sıradaki sınava ne kadar kaldı ve bu hızla yetişip
          yetişmediğin. Hız son üç haftanın ölçümü; yeterli veri yoksa uydurulmaz.
        </AppText>

        {vm.isLoading ? (
          <>
            <Skeleton height={120} radius={16} />
            <Skeleton height={120} radius={16} />
          </>
        ) : vm.rows.length === 0 ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Henüz gidişat yok"
            message="İzlence yükleyip konular oluştuğunda burada ders ders durumunu görürsün."
          />
        ) : (
          vm.rows.map((row) => (
            <Card key={row.id} style={styles.card}>
              <View style={styles.headerRow}>
                <AppText variant="subtitle">{row.courseLabel}</AppText>
                {row.accuracyLabel ? (
                  <AppText variant="caption" tone="muted">
                    {row.accuracyLabel}
                  </AppText>
                ) : null}
              </View>

              <ProgressBar
                value={row.coverage}
                tone={row.verdict === 'behind' ? 'warning' : 'primary'}
                accessibilityLabel={row.coverageLabel}
              />
              <AppText variant="caption" tone="muted">
                {row.coverageLabel}
              </AppText>

              {row.examLabel ? (
                <AppText variant="caption" tone="muted">
                  {row.examLabel}
                </AppText>
              ) : null}

              <AppText variant="caption" tone={vm.toneOf(row.verdict)}>
                {row.message}
              </AppText>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { gap: spacing.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));
