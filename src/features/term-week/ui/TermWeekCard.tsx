import { AppText, Button, Card, makeStyles } from '@shared/ui';
import { Switch, View } from 'react-native';
import type { TermWeekController } from '../model/useTermWeek';

export function TermWeekCard({ term }: { term: TermWeekController }) {
  const styles = useStyles();
  if (term.isLoading) return null;

  return (
    <Card style={styles.card}>
      <AppText variant="label">Dönem haftası</AppText>
      <AppText variant="caption" tone="muted">
        {term.currentWeek === null
          ? 'Bu hafta dönemin kaçıncı haftası? Söylersen plan, henüz işlenmemiş haftaların konularını beklemeye alır.'
          : term.currentWeek < 1
            ? 'Dönem henüz başlamadı.'
            : `Bu hafta dönemin ${term.currentWeek}. haftası.`}
      </AppText>
      <AppText variant="caption" tone="muted">
        {term.sourceLabel}
      </AppText>

      <View style={styles.stepper}>
        <Button
          label="−"
          variant="secondary"
          onPress={term.onDecrease}
          disabled={!term.canDecrease || term.isSaving}
          style={styles.stepButton}
          accessibilityLabel="Bir hafta geri"
        />
        <AppText variant="subtitle" style={styles.value} accessibilityLiveRegion="polite">
          {term.draft}. hafta
        </AppText>
        <Button
          label="+"
          variant="secondary"
          onPress={term.onIncrease}
          disabled={!term.canIncrease || term.isSaving}
          style={styles.stepButton}
          accessibilityLabel="Bir hafta ileri"
        />
      </View>

      <View style={styles.row}>
        <AppText variant="caption" style={styles.flex}>
          Bütün derslerime uygula
        </AppText>
        <Switch
          accessibilityLabel="Bütün derslerime uygula"
          value={term.applyToAll}
          onValueChange={term.onApplyToAll}
          disabled={term.isSaving}
        />
      </View>

      {term.isDirty ? <Button label="Kaydet" loading={term.isSaving} onPress={term.onSave} /> : null}
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepButton: { minWidth: 56 },
  value: { flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
}));
