import { AppText, Card, ProgressBar, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { CapacityController } from '../model/useLearnedCapacity';

const MAX_BAR_MINUTES = 240;

export function CapacityCard({ capacity }: { capacity: CapacityController }) {
  const styles = useStyles();

  return (
    <Card style={styles.card}>
      <AppText variant="label">Günlük çalışma kapasiten</AppText>
      <AppText variant="caption" tone="muted">
        {capacity.hasHistory
          ? `Son ${capacity.weeks} haftada gerçekten bitirdiğin işe göre, gün gün. Plan bu bütçelere sığacak şekilde kuruluyor.`
          : `Henüz yeterli geçmiş yok; şimdilik varsayılan bütçe kullanılıyor. Görevleri tamamladıkça burası senin ritmine göre şekillenecek.`}
      </AppText>

      <View style={styles.rows}>
        {capacity.rows.map((row) => (
          <Pressable
            key={row.weekday}
            style={styles.row}
            accessibilityRole="switch"
            accessibilityState={{ checked: !row.isBlocked, disabled: capacity.isSavingBlocked }}
            accessibilityLabel={`${row.label}: ${row.isBlocked ? 'kapalı' : `${row.minutes} dakika`}. Değiştirmek için dokun.`}
            disabled={capacity.isSavingBlocked}
            onPress={() => capacity.toggleBlocked(row.weekday)}
          >
            <AppText variant="caption" tone="muted" style={styles.day}>
              {row.label}
            </AppText>
            <View style={styles.bar}>
              <ProgressBar
                value={row.minutes / MAX_BAR_MINUTES}
                tone={row.isLearned ? 'primary' : 'warning'}
                accessibilityLabel={`${row.label}: ${row.minutes} dakika`}
              />
            </View>
            <AppText
              variant="caption"
              tone={row.isBlocked ? 'danger' : row.isLearned ? 'default' : 'muted'}
              style={styles.minutes}
            >
              {row.isBlocked ? 'kapalı' : `${row.minutes} dk`}
            </AppText>
          </Pressable>
        ))}
      </View>

      <AppText variant="caption" tone="muted">
        Hiç çalışamadığın bir gün varsa üstüne dokunup kapat: plan o güne iş koymaz, kapattığın günde
        duran işler de diğer günlere dağıtılır.
      </AppText>

      {capacity.hasHistory ? (
        <AppText variant="caption" tone="muted">
          Turuncu çubuklar henüz ölçülmemiş günler — varsayılan değer.
          {capacity.measuredDays > 0
            ? ` ${capacity.measuredDays} günde süre tuttuğun için o günler tahminle değil gerçek dakikayla hesaplandı.`
            : ' Görev ekranındaki zamanlayıcıyı kullanırsan bu sayılar tahmin yerine gerçek süreye dayanır.'}
        </AppText>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  rows: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  day: { width: 76 },
  bar: { flex: 1 },
  minutes: { width: 52, textAlign: 'right' },
}));
