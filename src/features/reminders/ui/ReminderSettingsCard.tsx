import { AppText, Card, SegmentedControl, makeStyles } from '@shared/ui';
import { Switch, View } from 'react-native';
import type { RemindersController } from '../model/useReminders';
import type { ReminderHour, ReviewHour } from '../model/reminders.store';

export function ReminderSettingsCard({ reminders }: { reminders: RemindersController }) {
  const styles = useStyles();
  const hourOptions = reminders.hours.map((hour) => ({ value: String(hour) as `${ReminderHour}`, label: `${hour}:00` }));
  const reviewHourOptions = reminders.reviewHours.map((hour) => ({
    value: String(hour) as `${ReviewHour}`,
    label: `${String(hour).padStart(2, '0')}:00`,
  }));

  return (
    <Card style={styles.card}>
      <AppText variant="label">Hatırlatmalar</AppText>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <AppText>Günlük değerlendirme</AppText>
          <AppText variant="caption" tone="muted">
            Akşam hatırlatır; bildirimdeki düğmeyle görevi oradan bitirebilirsin.
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Günlük değerlendirme hatırlatması"
          value={reminders.checkinEnabled}
          disabled={reminders.isBusy}
          onValueChange={reminders.setCheckinEnabled}
        />
      </View>

      {reminders.checkinEnabled ? (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <AppText>Saati kendi öğrensin</AppText>
            <AppText variant="caption" tone="muted">
              Hangi gün ne zaman çalıştığına bakar, her gün için ayrı saat seçer. Zamanlayıcıyı kullandıkça
              isabetlenir.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Hatırlatma saatini öğren"
            value={reminders.smartTiming}
            disabled={reminders.isBusy}
            onValueChange={reminders.setSmartTiming}
          />
        </View>
      ) : null}

      {reminders.checkinEnabled && !reminders.smartTiming ? (
        <SegmentedControl
          options={hourOptions}
          value={String(reminders.checkinHour) as `${ReminderHour}`}
          onChange={(value) => reminders.setCheckinHour(Number(value) as ReminderHour)}
          disabled={reminders.isBusy}
          accessibilityLabel="Hatırlatma saati"
        />
      ) : null}

      <View style={styles.row}>
        <View style={styles.rowText}>
          <AppText>Tekrar zamanı</AppText>
          <AppText variant="caption" tone="muted">
            Bir konunun aralıklı tekrar günü geldiğinde haber verir; kaçırılan tekrar ertesi gün yine hatırlatılır.
            {reminders.reviewsEnabled
              ? reminders.reviewsByPush
                ? ' Sunucudan gelir: uygulamayı açmasan da ulaşır.'
                : ' Bu cihazda kurulur; uygulamayı birkaç günde bir açman yeterli.'
              : ''}
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Tekrar hatırlatmaları"
          value={reminders.reviewsEnabled}
          disabled={reminders.isBusy}
          onValueChange={reminders.setReviewsEnabled}
        />
      </View>

      {reminders.reviewsEnabled ? (
        <SegmentedControl
          options={reviewHourOptions}
          value={String(reminders.reviewHour) as `${ReviewHour}`}
          onChange={(value) => reminders.setReviewHour(Number(value) as ReviewHour)}
          disabled={reminders.isBusy}
          accessibilityLabel="Tekrar hatırlatma saati"
        />
      ) : null}

      <View style={styles.row}>
        <View style={styles.rowText}>
          <AppText>Haftalık özet</AppText>
          <AppText variant="caption" tone="muted">
            Pazar akşamı haftanın özetini hatırlatır.
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Haftalık özet hatırlatması"
          value={reminders.summaryEnabled}
          disabled={reminders.isBusy}
          onValueChange={reminders.setSummaryEnabled}
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <AppText>Sınav geri sayımı</AppText>
          <AppText variant="caption" tone="muted">
            Sınavdan 7, 3 ve 1 gün önce uyarır.
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Sınav hatırlatmaları"
          value={reminders.examsEnabled}
          disabled={reminders.isBusy}
          onValueChange={reminders.setExamsEnabled}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: spacing.xxs },
}));
