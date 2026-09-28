import { AppText, Card, makeStyles } from '@shared/ui';
import { Switch, View } from 'react-native';
import { GeneratePlanButton } from './GeneratePlanButton';

export interface WeeklyPlanCardProps {
  autoEnabled: boolean;
  isSaving: boolean;
  onToggleAuto: (enabled: boolean) => void;
}

/** Plan settings in one place: let it run itself, or drive it by hand. */
export function WeeklyPlanCard({ autoEnabled, isSaving, onToggleAuto }: WeeklyPlanCardProps) {
  const styles = useStyles();

  return (
    <Card style={styles.card}>
      <AppText variant="label">Haftalık plan</AppText>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <AppText>Otomatik oluştur</AppText>
          <AppText variant="caption" tone="muted">
            {autoEnabled
              ? 'Pazartesi sabahları plan kendiliğinden üretilir. Senin dokunduğun görevler korunur.'
              : 'Kapalı. Planı aşağıdan ya da Ayarlar → Dersler üzerinden kendin üretirsin.'}
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Otomatik haftalık plan"
          value={autoEnabled}
          disabled={isSaving}
          onValueChange={onToggleAuto}
        />
      </View>

      <GeneratePlanButton variant="secondary" />
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: spacing.xxs },
}));
