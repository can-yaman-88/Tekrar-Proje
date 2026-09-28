import { AppText, Button, Card, EmptyState, ErrorState, Screen, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useCheckinHistoryScreen } from '../model/useCheckinHistoryScreen';

export function CheckinHistoryScreen() {
  const vm = useCheckinHistoryScreen();
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
          <Skeleton height={96} radius={16} />
          <Skeleton height={96} radius={16} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <FlatList
        data={vm.cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <AppText tone="muted" style={styles.intro}>
            Her değerlendirmenin plana ne yaptığı burada. Yanlış anlaşıldıysa geri alabilirsin:
            görevler, çözülen sayıları ve tekrar takvimi eski haline döner. Kaydın kendisini de
            silebilirsin — planı geri alarak ya da olduğu gibi bırakarak.
          </AppText>
        }
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title="Henüz değerlendirme yok"
            message="İlk günlük değerlendirmeni yazdığında burada görünecek."
          />
        }
        renderItem={({ item }) => {
          const isExpanded = vm.expandedId === item.id;
          return (
            <Card style={[styles.card, item.isReverted && styles.cardReverted]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                accessibilityLabel={`${item.dateLabel} değerlendirmesinin ayrıntıları`}
                onPress={() => vm.onToggleExpand(item.id)}
              >
                <View style={styles.headerRow}>
                  <AppText variant="label" style={styles.flex}>
                    {item.dateLabel}
                  </AppText>
                  {item.isReverted ? (
                    <AppText variant="caption" tone="muted">
                      geri alındı
                    </AppText>
                  ) : null}
                </View>
                <AppText>{item.summary}</AppText>
                <AppText variant="caption" tone="muted" style={styles.changes}>
                  {item.changesLabel}
                </AppText>
              </Pressable>

              {isExpanded ? (
                <View style={styles.details}>
                  <AppText variant="caption" tone="muted">
                    Yazdığın metin
                  </AppText>
                  <AppText variant="caption">{item.rawText}</AppText>

                  <AppText variant="caption" tone="muted" style={styles.detailsTitle}>
                    Değişen görevler
                  </AppText>
                  {vm.changesLoading ? (
                    <Skeleton height={16} />
                  ) : vm.changes.length === 0 ? (
                    <AppText variant="caption" tone="muted">
                      Görev durumu değişmedi.
                    </AppText>
                  ) : (
                    vm.changes.map((change) => (
                      <View key={change.id} style={styles.change}>
                        <AppText variant="caption" numberOfLines={2}>
                          {change.title}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          {change.transition}
                          {change.detail ? ` · ${change.detail}` : ''}
                        </AppText>
                      </View>
                    ))
                  )}

                  {item.canRevert ? (
                    <Button
                      label="Bu değerlendirmeyi geri al"
                      variant="ghost"
                      loading={vm.isReverting}
                      onPress={() =>
                        Alert.alert(
                          'Geri al',
                          'Bu değerlendirmenin yaptığı her şey geri alınacak: görev durumları, çözülen sayıları, tekrar takvimi ve oluşturduğu görevler.',
                          [
                            { text: 'Vazgeç', style: 'cancel' },
                            { text: 'Geri al', style: 'destructive', onPress: () => vm.onRevert(item.id) },
                          ],
                        )
                      }
                    />
                  ) : null}

                  <Button
                    label="Kaydı sil"
                    variant="ghost"
                    loading={vm.isDeleting}
                    onPress={() => confirmDelete(item, vm.onDelete)}
                  />
                </View>
              ) : null}
            </Card>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl refreshing={vm.isRefreshing} onRefresh={vm.refresh} tintColor={colors.primary} />
        }
      />
    </Screen>
  );
}

/**
 * Deleting is two different things and the student has to pick one, because
 * only one of them can be taken back.
 *
 * A check-in that still holds the plan can be undone first — that is the safe
 * answer, and it is offered first. Keeping the plan and dropping the record is
 * the other honest answer, and it is final: the snapshots the undo needs go
 * with the record.
 */
function confirmDelete(
  item: { id: string; dateLabel: string; canRevert: boolean },
  onDelete: (id: string, revertFirst: boolean) => void,
): void {
  if (!item.canRevert) {
    Alert.alert(
      'Kaydı sil',
      `${item.dateLabel} değerlendirmesinin kaydı silinecek. Bu değerlendirme zaten geri alınmıştı, planda bir şey değişmeyecek.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sil', style: 'destructive', onPress: () => onDelete(item.id, false) },
      ],
    );
    return;
  }

  Alert.alert(
    'Kaydı sil',
    `${item.dateLabel} değerlendirmesi hâlâ planda duruyor. Önce geri alınsın mı, yoksa plan olduğu gibi kalıp yalnızca kayıt mı silinsin? Yalnızca kaydı silersen bu değerlendirmeyi bir daha geri alamazsın.`,
    [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Geri al ve sil', style: 'destructive', onPress: () => onDelete(item.id, true) },
      { text: 'Sadece kaydı sil', style: 'destructive', onPress: () => onDelete(item.id, false) },
    ],
  );
}

const useStyles = makeStyles(({ colors, spacing }) => ({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { marginBottom: spacing.md },
  card: { gap: spacing.xxs },
  cardReverted: { opacity: 0.6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  changes: { marginTop: spacing.xxs },
  details: { gap: spacing.xs, marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  detailsTitle: { marginTop: spacing.xs },
  change: { gap: spacing.xxs, marginTop: spacing.xxs },
  separator: { height: spacing.sm },
}));
