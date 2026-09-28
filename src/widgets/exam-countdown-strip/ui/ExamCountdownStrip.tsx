import { ExamChip, type ExamChipModel, ExamChipSkeleton } from '@entities/exam';
import { AppText, makeStyles } from '@shared/ui';
import { ScrollView, View } from 'react-native';

export interface ExamCountdownStripProps {
  exams: readonly ExamChipModel[];
  loading: boolean;
  /** Opens exam mode for that exam. */
  onSelect?: (examId: string) => void;
}

/** Hidden entirely when there is nothing upcoming — no empty chrome. */
export function ExamCountdownStrip({ exams, loading, onSelect }: ExamCountdownStripProps) {
  const styles = useStyles();
  if (!loading && exams.length === 0) return null;

  return (
    <View style={styles.container}>
      <AppText variant="label" tone="muted">
        Yaklaşan sınavlar
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {loading
          ? [0, 1, 2].map((i) => <ExamChipSkeleton key={i} />)
          : exams.map((exam) => <ExamChip key={exam.id} model={exam} onPress={onSelect} />)}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  container: { gap: spacing.sm, marginTop: spacing.lg },
  row: { gap: spacing.sm },
}));
