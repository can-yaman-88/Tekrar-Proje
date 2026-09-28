import { EXAM_KIND_LABEL, SELECTABLE_EXAM_KINDS } from '@entities/exam';
import { AppText, Button, Card, SegmentedControl, TextField, makeStyles } from '@shared/ui';
import { addDays, todayLocal } from '@shared/lib/date';
import { Controller } from 'react-hook-form';
import { View } from 'react-native';
import type { ExamEditorController } from '../model/useExamEditor';

const KIND_OPTIONS = SELECTABLE_EXAM_KINDS.map((kind) => ({ value: kind, label: EXAM_KIND_LABEL[kind] }));
const DATE_SHORTCUTS = [
  { label: '+1 hafta', days: 7 },
  { label: '+2 hafta', days: 14 },
  { label: '+1 ay', days: 30 },
];

export function ExamForm({ form }: { form: ExamEditorController }) {
  const styles = useStyles();

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">Sınav ekle</AppText>
      <AppText variant="caption" tone="muted">
        İzlencede tarih yazmıyorsa buradan gir. Plan, sınav yaklaştıkça bu tarihe göre sıkılaşır.
      </AppText>

      <Controller
        control={form.control}
        name="kind"
        render={({ field }) => <SegmentedControl options={KIND_OPTIONS} value={field.value} onChange={field.onChange} />}
      />

      <Controller
        control={form.control}
        name="title"
        render={({ field }) => (
          <TextField
            label="Ad"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="Vize 1"
            error={form.errors.title}
          />
        )}
      />

      <Controller
        control={form.control}
        name="examDate"
        render={({ field }) => (
          <View style={styles.group}>
            <TextField
              label="Tarih"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              autoCapitalize="none"
              placeholder="2026-11-04"
              error={form.errors.examDate}
            />
            <View style={styles.row}>
              {DATE_SHORTCUTS.map((shortcut) => (
                <Button
                  key={shortcut.label}
                  label={shortcut.label}
                  variant="secondary"
                  style={styles.shortcut}
                  onPress={() => field.onChange(addDays(todayLocal(), shortcut.days))}
                />
              ))}
            </View>
          </View>
        )}
      />

      <Button label="Sınavı ekle" loading={form.isSaving} onPress={form.onSubmit} />
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.sm },
  group: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  shortcut: { flex: 1, minHeight: 36, paddingHorizontal: spacing.xs },
}));
