import type { DailyCheckinResponse } from '@contracts/daily-checkin.contract';
import { AppText, Button, Card, makeStyles } from '@shared/ui';
import { View } from 'react-native';

export interface CheckInResultProps {
  result: DailyCheckinResponse;
  onDone: () => void;
}

export function CheckInResult({ result, onDone }: CheckInResultProps) {
  const styles = useStyles();
  // Four numbers is one too many for a row of cards, so the third slot goes to
  // whatever actually happened: a day being emptied is the loudest of the three,
  // then a removal, and the review count when the report was an ordinary one.
  const stats = [
    { label: 'görev güncellendi', value: result.updatedTaskIds.length },
    { label: 'görev eklendi', value: result.createdTaskIds.length },
    ...(result.movedTaskIds.length > 0
      ? [{ label: 'görev başka güne alındı', value: result.movedTaskIds.length }]
      : result.removedTaskIds.length > 0
        ? [{ label: 'görev kaldırıldı', value: result.removedTaskIds.length }]
        : [{ label: 'konu tekrarı', value: result.reviewedTopicIds.length }]),
  ];

  return (
    <View style={styles.container}>
      <Card style={styles.summary}>
        <AppText variant="caption" tone="muted">
          Günün özeti
        </AppText>
        <AppText variant="subtitle">{result.summary}</AppText>
      </Card>

      <View style={styles.stats}>
        {stats.map((s) => (
          <Card key={s.label} style={styles.stat}>
            <AppText variant="title">{s.value}</AppText>
            <AppText variant="caption" tone="muted">
              {s.label}
            </AppText>
          </Card>
        ))}
      </View>

      {result.mistakesRecorded > 0 ? (
        <Card style={styles.summary}>
          <AppText variant="caption" tone="muted">
            {result.mistakesRecorded} madde hata defterine eklendi; o konunun görevini açtığında karşına çıkacak.
          </AppText>
        </Card>
      ) : null}

      {result.attachmentNotes.length > 0 ? (
        <Card style={styles.summary}>
          <AppText variant="label" tone="warning">
            Dosyalarla ilgili
          </AppText>
          {result.attachmentNotes.map((note) => (
            <AppText key={note} variant="caption" tone="muted">
              • {note}
            </AppText>
          ))}
        </Card>
      ) : null}

      {result.unmatchedMentions.length > 0 ? (
        <Card style={styles.summary}>
          <AppText variant="label">Bunları bir göreve bağlayamadım</AppText>
          {result.unmatchedMentions.map((m) => (
            <AppText key={m} variant="caption" tone="muted">
              • {m}
            </AppText>
          ))}
        </Card>
      ) : null}

      <Button label="Görevlere dön" onPress={onDone} />
    </View>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  container: { gap: spacing.md },
  summary: { gap: spacing.xs },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm },
}));
