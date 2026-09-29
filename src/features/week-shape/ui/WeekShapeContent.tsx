import { AppText, Button, Card, EmptyState, ErrorState, Screen, Skeleton, makeStyles } from '@shared/ui';
import { ScrollView, View } from 'react-native';
import type { WeekShapeController } from '../model/useWeekShape';

export function WeekShapeContent({ shape }: { shape: WeekShapeController }) {
  const styles = useStyles();

  if (shape.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState
          title={shape.error.title}
          message={shape.error.message}
          actionLabel="Tekrar dene"
          onAction={shape.refresh}
        />
      </Screen>
    );
  }

  if (shape.isLoading) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton height={96} radius={16} />
          <Skeleton height={140} radius={16} />
        </View>
      </Screen>
    );
  }

  if (shape.isApplied) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="checkmark-done-outline"
          title="Hafta düzenlendi"
          message="Değişiklikler uygulandı. Hafta sekmesinde yeni hâlini görebilirsin."
        />
      </Screen>
    );
  }

  if (shape.preview.isEmpty) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="sparkles-outline"
          title="Hafta zaten düzende"
          message="Konsept ve Feynman aynı günde, sınavlar da onlardan sonra. Taşınacak bir şey yok."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <AppText variant="label">Ne değişecek?</AppText>
          <AppText variant="caption" tone="muted">
            {shape.preview.summary} Hiçbir şey uygulanmadan önce değişmez; istersen geri dönebilirsin.
          </AppText>
        </Card>

        {shape.preview.moveRows.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="label">Taşınacak görevler</AppText>
            {shape.preview.moveRows.map((row) => (
              <View key={row.id} style={styles.row}>
                <AppText numberOfLines={2}>{row.title}</AppText>
                <AppText variant="caption" tone="muted">
                  {row.detail}
                </AppText>
              </View>
            ))}
          </Card>
        ) : null}

        {shape.preview.groupRows.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="label">Tek göreve toplanacaklar</AppText>
            <AppText variant="caption" tone="muted">
              Konsept sayfası ve Feynman anlatımı arka arkaya yapılan tek bir oturum; listede de tek
              kart olarak duracaklar.
            </AppText>
            {shape.preview.groupRows.map((row) => (
              <View key={row.id} style={styles.row}>
                <AppText numberOfLines={2}>{row.title}</AppText>
                <AppText variant="caption" tone="muted">
                  {row.detail}
                </AppText>
              </View>
            ))}
          </Card>
        ) : null}

        {shape.preview.notes.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="label">Çözülemeyenler</AppText>
            {shape.preview.notes.map((note) => (
              <AppText key={note} variant="caption" tone="muted">
                · {note}
              </AppText>
            ))}
          </Card>
        ) : null}

        <Button label="Uygula" loading={shape.isApplying} onPress={shape.onApply} />
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  card: { gap: spacing.xs },
  row: { gap: spacing.xxs, marginTop: spacing.xxs },
}));
