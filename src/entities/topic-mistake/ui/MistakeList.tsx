import { AppText, Card, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';
import { mistakeLabel, type TopicMistake } from '../domain/topic-mistake';

export interface MistakeListProps {
  mistakes: readonly TopicMistake[];
  onResolve?: (mistakeId: string) => void;
  resolvingId?: string | null;
  title?: string;
}

/** What went wrong last time, so it is read before the same topic is met again. */
export function MistakeList({ mistakes, onResolve, resolvingId, title = 'Geçen sefer takıldığın yerler' }: MistakeListProps) {
  const styles = useStyles();
  if (mistakes.length === 0) return null;

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">{title}</AppText>
      {mistakes.map((mistake) => (
        <View key={mistake.id} style={styles.row}>
          <AppText style={styles.body}>• {mistakeLabel(mistake)}</AppText>
          {onResolve ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`"${mistakeLabel(mistake)}" maddesini çözüldü olarak işaretle`}
              hitSlop={8}
              disabled={resolvingId === mistake.id}
              onPress={() => onResolve(mistake.id)}
            >
              <AppText variant="caption" tone={resolvingId === mistake.id ? 'muted' : 'primary'}>
                Çözüldü
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  body: { flex: 1 },
}));
