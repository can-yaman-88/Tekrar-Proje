import { AppText, Button, Card, TextField, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { TaskAllocationController } from '../model/useTaskAllocation';

export function AllocationCard({ allocation }: { allocation: TaskAllocationController }) {
  const styles = useStyles();

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <AppText variant="subtitle">Ödev dağılımı</AppText>
        <AppText variant="caption" tone="muted">
          kalan {allocation.remainingMinutes} dk
        </AppText>
      </View>
      <AppText variant="caption" tone="muted">
        Boş kapasitene göre dağıtıldı. Bir güne kendin rakam yazarsan o gün sabitlenir, kalan iş diğer günlere
        yeniden dağılır; 0 yazmak o günü kapatır.
      </AppText>

      {allocation.rows.map((row) => (
        <View key={row.date} style={styles.row}>
          <View style={styles.dayBlock}>
            <AppText variant="caption">{row.label}</AppText>
            <AppText variant="caption" tone="muted">
              {row.committedMinutes > 0 ? `o gün ${row.committedMinutes} dk başka iş` : 'boş gün'}
            </AppText>
          </View>
          <View style={styles.input}>
            <TextField
              label=""
              value={String(row.minutes)}
              onChangeText={(value) => allocation.onSetDay(row.date, Number(value.replace(/\D/g, '')) || 0)}
              keyboardType="number-pad"
              accessibilityLabel={`${row.label} için dakika`}
            />
          </View>
          <View style={styles.modeBlock}>
            <AppText variant="caption" tone={row.mode === 'off' ? 'danger' : row.mode === 'manual' ? 'primary' : 'muted'}>
              {row.mode === 'off' ? 'kapalı' : row.mode === 'manual' ? 'elle' : 'otomatik'}
            </AppText>
            {row.mode === 'auto' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.label} gününü kapat`}
                hitSlop={8}
                onPress={() => allocation.onCloseDay(row.date)}
              >
                <AppText variant="caption" tone="muted">
                  kapat
                </AppText>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.label} gününü otomatiğe döndür`}
                hitSlop={8}
                onPress={() => allocation.onClearDay(row.date)}
              >
                <AppText variant="caption" tone="primary">
                  otomatik
                </AppText>
              </Pressable>
            )}
          </View>
        </View>
      ))}

      <AppText variant="caption" tone={allocation.allocatedMinutes < allocation.remainingMinutes ? 'warning' : 'muted'}>
        dağıtılan {allocation.allocatedMinutes} / {allocation.remainingMinutes} dk
        {allocation.allocatedMinutes < allocation.remainingMinutes ? ' — kalanı sığdıracak gün yok' : ''}
      </AppText>

      <View style={styles.actions}>
        <Button
          label="Kaydet"
          loading={allocation.isSaving}
          disabled={!allocation.hasChanges}
          onPress={allocation.onSave}
          style={styles.action}
        />
        <Button
          label="Hepsi otomatik"
          variant="ghost"
          disabled={allocation.isSaving}
          onPress={allocation.onResetAll}
          style={styles.action}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayBlock: { flex: 1, gap: spacing.xxs },
  input: { width: 76 },
  modeBlock: { width: 72, alignItems: 'flex-end', gap: spacing.xxs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
}));
