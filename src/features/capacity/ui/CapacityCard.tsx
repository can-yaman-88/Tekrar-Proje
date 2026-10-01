import { formatMinutes } from '@shared/lib/date';
import { AppText, Button, Card, ProgressBar, SegmentedControl, makeStyles, useTheme } from '@shared/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CapacityController, CapacityMode, CapacityRow } from '../model/useLearnedCapacity';

const MODE_OPTIONS: { value: CapacityMode; label: string }[] = [
  { value: 'auto', label: 'Otomatik' },
  { value: 'manual', label: 'Elle' },
  { value: 'closed', label: 'Kapalı' },
];

const BAR_TONE = {
  learned: 'primary',
  override: 'success',
  general: 'warning',
  default: 'warning',
  blocked: 'warning',
} as const;

export function CapacityCard({ capacity }: { capacity: CapacityController }) {
  const styles = useStyles();
  // The scale follows the busiest day, so a 6-hour Saturday does not flatten
  // every other bar to nothing — and a light week still reads as light.
  const scale = Math.max(180, ...capacity.rows.map((row) => row.minutes));

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <AppText variant="label">Günlük çalışma kapasiten</AppText>
        <AppText variant="caption" tone="muted">
          haftada {capacity.weeklyBudgetLabel}
        </AppText>
      </View>
      <AppText variant="caption" tone="muted">
        {capacity.historyLine} Plan her günü kendi bütçesine göre doldurur. Bir güne dokunup kendi sayını girebilir ya
        da günü kapatabilirsin.
      </AppText>

      <View style={styles.rows}>
        {capacity.rows.map((row) => (
          <View key={row.weekday} style={styles.dayBlock}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ expanded: capacity.editing === row.weekday }}
              accessibilityLabel={`${row.label}: ${row.isBlocked ? 'kapalı' : `${row.minutes} dakika, ${row.sourceLabel}`}. Düzenlemek için dokun.`}
              onPress={() => capacity.onEdit(row.weekday)}
            >
              <AppText variant="caption" tone="muted" style={styles.day}>
                {row.shortLabel}
              </AppText>
              <View style={styles.bar}>
                <ProgressBar value={row.minutes / scale} tone={BAR_TONE[row.source]} height={8} />
              </View>
              <View style={styles.value}>
                <AppText variant="caption" tone={row.isBlocked ? 'danger' : 'default'}>
                  {row.isBlocked ? 'kapalı' : formatMinutes(row.minutes)}
                </AppText>
                <AppText variant="caption" tone={row.source === 'override' ? 'success' : 'muted'}>
                  {row.sourceLabel}
                </AppText>
              </View>
            </Pressable>
            {row.classMinutes > 0 && row.budget !== row.minutes && !row.isBlocked ? (
              <AppText variant="caption" tone="muted" style={styles.note}>
                {formatMinutes(row.classMinutes)} ders var: planda {formatMinutes(row.budget)}.
              </AppText>
            ) : null}
            {capacity.editing === row.weekday ? (
              <DayEditor row={row} capacity={capacity} />
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        <LegendDot tone="primary" label="öğrenilen" />
        <LegendDot tone="success" label="senin sayın" />
        <LegendDot tone="warning" label="tahmini" />
      </View>

      <AppText variant="caption" tone="muted">
        {capacity.measuredDays > 0
          ? `${capacity.measuredDays} günde süre tuttun; o günler tahminle değil gerçek dakikayla sayıldı. Eski haftalar yenilerden az ağırlık taşır.`
          : 'Görev ekranındaki zamanlayıcıyı kullanırsan bu sayılar tahmin yerine gerçek süreye dayanır.'}
      </AppText>
    </Card>
  );
}

function DayEditor({ row, capacity }: { row: CapacityRow; capacity: CapacityController }) {
  const styles = useStyles();
  const [mode, setMode] = useState<CapacityMode>(
    row.isBlocked ? 'closed' : row.override !== null ? 'manual' : 'auto',
  );
  const [minutes, setMinutes] = useState<number>(
    row.override ?? Math.min(capacity.maxOverride, Math.max(capacity.minOverride, row.minutes || 60)),
  );

  const step = (delta: number) =>
    setMinutes((value) => Math.min(capacity.maxOverride, Math.max(capacity.minOverride, value + delta)));

  return (
    <View style={styles.editor}>
      <AppText variant="caption" tone="muted">
        {row.detail}
      </AppText>
      <SegmentedControl<CapacityMode>
        options={MODE_OPTIONS}
        value={mode}
        onChange={setMode}
        disabled={capacity.isSaving}
        accessibilityLabel={`${row.label} kapasite kipi`}
      />
      {mode === 'manual' ? (
        <View style={styles.stepper}>
          <Button
            label={`− ${capacity.step}`}
            variant="secondary"
            onPress={() => step(-capacity.step)}
            disabled={capacity.isSaving || minutes <= capacity.minOverride}
            style={styles.stepButton}
          />
          <AppText variant="subtitle" style={styles.stepValue} accessibilityLiveRegion="polite">
            {formatMinutes(minutes)}
          </AppText>
          <Button
            label={`+ ${capacity.step}`}
            variant="secondary"
            onPress={() => step(capacity.step)}
            disabled={capacity.isSaving || minutes >= capacity.maxOverride}
            style={styles.stepButton}
          />
        </View>
      ) : null}
      <AppText variant="caption" tone="muted">
        {mode === 'auto'
          ? 'Geçmişinden öğrenilen sayı kullanılır ve sen çalıştıkça güncellenir.'
          : mode === 'manual'
            ? 'Planlar bu günü tam bu kadar doldurur; ders saatleri bu sayıdan ayrıca düşülmez.'
            : 'Bu güne iş konmaz; o gün duran işler diğer günlere dağıtılır.'}
      </AppText>
      <View style={styles.editorActions}>
        <Button
          label="Kaydet"
          loading={capacity.isSaving}
          onPress={() => capacity.save(row.weekday, mode, mode === 'manual' ? minutes : null)}
          style={styles.flex}
        />
        <Button label="Vazgeç" variant="ghost" onPress={capacity.onCloseEditor} disabled={capacity.isSaving} />
      </View>
    </View>
  );
}

function LegendDot({ tone, label }: { tone: 'primary' | 'success' | 'warning'; label: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: colors[tone] }]} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rows: { gap: spacing.xs },
  dayBlock: { gap: spacing.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  pressed: { opacity: 0.7 },
  day: { width: 32 },
  bar: { flex: 1 },
  value: { width: 92, alignItems: 'flex-end' },
  note: { marginLeft: 40 },
  editor: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepButton: { minWidth: 72 },
  stepValue: { flex: 1, textAlign: 'center' },
  editorActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
  legend: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
}));
