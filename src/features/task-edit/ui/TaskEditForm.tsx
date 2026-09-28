import {
  EDITABLE_TASK_STATUSES,
  TASK_GROUP_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_BY_GROUP,
  type TaskStatus,
  type TaskType,
} from '@entities/task';
import { AppText, Button, SegmentedControl, TextField, makeStyles } from '@shared/ui';
import { addDays, todayLocal } from '@shared/lib/date';
import { Controller } from 'react-hook-form';
import { Alert, View } from 'react-native';
import type { TaskEditController } from '../model/useTaskEditForm';

// Only the loop's three labels: "Ödev" describes where a task came from, and
// that is not something an edit can change.
const EDITABLE_GROUPS = ['concepts', 'quiz', 'feynman'] as const;
const TYPE_OPTIONS = EDITABLE_GROUPS.map((group) => ({
  value: TASK_TYPE_BY_GROUP[group],
  label: TASK_GROUP_LABEL[group],
}));

const STATUS_OPTIONS = EDITABLE_TASK_STATUSES.map((value) => ({ value, label: TASK_STATUS_LABEL[value] }));

const DUE_SHORTCUTS = [
  { label: 'Bugün', days: 0 },
  { label: 'Yarın', days: 1 },
  { label: '+3 gün', days: 3 },
  { label: '+1 hafta', days: 7 },
];

export function TaskEditForm({ form }: { form: TaskEditController }) {
  const styles = useStyles();

  const confirmDelete = () =>
    Alert.alert('Görevi sil', 'Bu görev ve notları kalıcı olarak silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: form.onDelete },
    ]);

  return (
    <View style={styles.container}>
      <View style={styles.group}>
        <AppText variant="caption" tone="muted">
          Durum
        </AppText>
        <SegmentedControl<TaskStatus>
          options={STATUS_OPTIONS}
          value={form.status}
          onChange={form.onChangeStatus}
          disabled={form.isChangingStatus}
          accessibilityLabel="Görev durumu"
        />
      </View>

      <View style={styles.group}>
        <AppText variant="caption" tone="muted">
          Etiket
        </AppText>
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <SegmentedControl<TaskType> options={TYPE_OPTIONS} value={field.value} onChange={field.onChange} />
          )}
        />
      </View>

      <Controller
        control={form.control}
        name="dueDate"
        render={({ field }) => (
          <View style={styles.group}>
            <TextField
              label="Teslim tarihi"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              autoCapitalize="none"
              placeholder="2026-10-05"
              error={form.errors.dueDate?.message ?? null}
            />
            <View style={styles.row}>
              {DUE_SHORTCUTS.map((shortcut) => (
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

      <Controller
        control={form.control}
        name="startsOn"
        render={({ field }) => (
          <View style={styles.group}>
            <TextField
              label="Başlama günü (isteğe bağlı)"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              autoCapitalize="none"
              placeholder="Boş bırakırsan uygulama kendi dağıtır"
              error={form.errors.startsOn?.message ?? null}
            />
            <View style={styles.row}>
              <Button
                label="Bugünden başla"
                variant="secondary"
                style={styles.shortcut}
                onPress={() => field.onChange(todayLocal())}
              />
              <Button
                label="Otomatik"
                variant="ghost"
                style={styles.shortcut}
                onPress={() => field.onChange('')}
              />
            </View>
          </View>
        )}
      />

      <View style={styles.row}>
        <Controller
          control={form.control}
          name="completedCount"
          render={({ field }) => (
            <View style={styles.half}>
              <TextField
                label="Çözülen"
                value={String(field.value)}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                keyboardType="number-pad"
                error={form.errors.completedCount?.message ?? null}
              />
            </View>
          )}
        />
        <Controller
          control={form.control}
          name="targetCount"
          render={({ field }) => (
            <View style={styles.half}>
              <TextField
                label="Hedef"
                value={field.value === null ? '' : String(field.value)}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                keyboardType="number-pad"
                placeholder="—"
                error={form.errors.targetCount?.message ?? null}
              />
            </View>
          )}
        />
        <Controller
          control={form.control}
          name="estimatedMinutes"
          render={({ field }) => (
            <View style={styles.half}>
              <TextField
                label="Süre (dk)"
                value={field.value === null ? '' : String(field.value)}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                keyboardType="number-pad"
                placeholder="—"
                error={form.errors.estimatedMinutes?.message ?? null}
              />
            </View>
          )}
        />
      </View>

      <Controller
        control={form.control}
        name="instructions"
        render={({ field }) => (
          <TextField
            label="Yönerge"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
            placeholder="Neye odaklanmalısın?"
            error={form.errors.instructions?.message ?? null}
          />
        )}
      />

      <Button
        label={form.isDirty ? 'Değişiklikleri kaydet' : 'Kaydedildi'}
        loading={form.isSaving}
        disabled={!form.isDirty}
        onPress={form.onSubmit}
      />
      <Button label="Görevi sil" variant="ghost" loading={form.isDeleting} onPress={confirmDelete} />
    </View>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  container: { gap: spacing.md },
  group: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  shortcut: { flex: 1, minHeight: 36, paddingHorizontal: spacing.xs },
}));
