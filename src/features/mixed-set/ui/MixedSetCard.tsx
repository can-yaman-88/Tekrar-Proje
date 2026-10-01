import type { Task } from '@entities/task';
import { AppText, Button, Card, makeStyles } from '@shared/ui';
import type { MixedSetController } from '../model/useMixedSet';

/** On the set's own screen: what it is, and the way to finish (or re-score) it. */
export function MixedSetCard({ task, controller }: { task: Task; controller: MixedSetController }) {
  const styles = useStyles();
  const done = task.status === 'completed';
  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">Karışık tekrar seti</AppText>
      <AppText variant="caption" tone="muted">
        {done
          ? 'Set bitti; her konunun puanı kendi tekrar takvimine yazıldı. Yanlış girdiysen düzeltebilirsin.'
          : 'Soruları yukarıdaki sırayla çöz. Bitince her konu için kaç doğru yaptığını işaretle: %60’ın altında kalan konu yarın yeniden gelir.'}
      </AppText>
      <Button
        label={done ? 'Puanları düzelt' : 'Seti bitirdim'}
        variant={done ? 'secondary' : 'primary'}
        onPress={() => controller.open(task)}
      />
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
}));
