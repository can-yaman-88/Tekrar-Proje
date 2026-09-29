import Ionicons from '@expo/vector-icons/Ionicons';
import type { CheckinChangeKind, DailyCheckinResponse } from '@contracts/daily-checkin.contract';
import { AppText, Button, Card, type ColorTokens, makeStyles, useTheme } from '@shared/ui';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

type IconName = ComponentProps<typeof Ionicons>['name'];

const KIND_ICON: Record<CheckinChangeKind, { icon: IconName; color: keyof ColorTokens }> = {
  done: { icon: 'checkmark-circle', color: 'success' },
  progress: { icon: 'trending-up', color: 'primary' },
  struggle: { icon: 'alert-circle', color: 'warning' },
  added: { icon: 'add-circle', color: 'primary' },
  removed: { icon: 'remove-circle', color: 'danger' },
  moved: { icon: 'arrow-forward-circle', color: 'primary' },
  edited: { icon: 'create', color: 'textMuted' },
  calendar: { icon: 'calendar', color: 'primary' },
  warning: { icon: 'warning', color: 'warning' },
};

export interface CheckInResultProps {
  result: DailyCheckinResponse;
  onDone: () => void;
}

export function CheckInResult({ result, onDone }: CheckInResultProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  // What could not be done as asked reads apart from what was done.
  const done = result.changes.filter((change) => change.kind !== 'warning');
  const warnings = result.changes.filter((change) => change.kind === 'warning');
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

      {result.answers.map((answer) => (
        <Card key={answer.question} style={styles.summary}>
          <AppText variant="label">{answer.question}</AppText>
          {answer.lines.map((line, index) => (
            <AppText key={`${index}-${line}`} variant="caption" tone={index === 0 ? 'default' : 'muted'}>
              {line}
            </AppText>
          ))}
        </Card>
      ))}

      {/*
        Counts cannot show a misread; the list can. If "Carnot'ta takıldım"
        landed on the Gauss set, this is where the student sees it — and
        Geçmiş → Değerlendirmeler is where they undo it.
      */}
      {done.length > 0 ? (
        <Card style={styles.summary}>
          <AppText variant="label">Ne anladım</AppText>
          {done.map((change, index) => (
            <View key={`${index}-${change.text}`} style={styles.change}>
              <Ionicons name={KIND_ICON[change.kind].icon} size={16} color={colors[KIND_ICON[change.kind].color]} />
              <AppText variant="caption" style={styles.changeText}>
                {change.text}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" tone="muted">
            Yanlış anladıysam Geçmiş → Değerlendirmeler’den geri alabilirsin.
          </AppText>
        </Card>
      ) : null}

      {warnings.length > 0 ? (
        <Card style={styles.summary}>
          <AppText variant="label" tone="warning">
            İstediğin gibi yapamadıklarım
          </AppText>
          {warnings.map((change, index) => (
            <AppText key={`${index}-${change.text}`} variant="caption" tone="muted">
              • {change.text}
            </AppText>
          ))}
        </Card>
      ) : null}

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
  change: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  changeText: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm },
}));
