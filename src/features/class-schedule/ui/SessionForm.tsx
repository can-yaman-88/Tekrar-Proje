import { WEEKDAY_SHORT, WEEKDAYS, type Weekday } from '@entities/class-session';
import type { CourseRef } from '@entities/course';
import { AppText, Button, Card, SegmentedControl, TextField, makeStyles } from '@shared/ui';
import { Controller } from 'react-hook-form';
import { Switch, View } from 'react-native';
import type { ScheduleEditorController } from '../model/useScheduleEditor';

const WEEKDAY_OPTIONS = WEEKDAYS.map((day) => ({ value: String(day), label: WEEKDAY_SHORT[day] }));

export function SessionForm({ form, courses }: { form: ScheduleEditorController; courses: readonly CourseRef[] }) {
  const styles = useStyles();
  const courseOptions = courses.map((course) => ({ value: course.id, label: course.code ?? course.name }));

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">Ders ekle</AppText>

      {courseOptions.length === 0 ? (
        <AppText tone="muted">Önce bir ders eklemelisin; izlence yükleyerek oluşturabilirsin.</AppText>
      ) : (
        <>
          <View style={styles.group}>
            <AppText variant="caption" tone="muted">
              Ders
            </AppText>
            <Controller
              control={form.control}
              name="courseId"
              render={({ field }) => (
                <SegmentedControl options={courseOptions} value={field.value} onChange={field.onChange} />
              )}
            />
          </View>

          <View style={styles.group}>
            <AppText variant="caption" tone="muted">
              Gün
            </AppText>
            <Controller
              control={form.control}
              name="weekday"
              render={({ field }) => (
                <SegmentedControl
                  options={WEEKDAY_OPTIONS}
                  value={String(field.value)}
                  onChange={(value) => field.onChange(Number(value) as Weekday)}
                />
              )}
            />
          </View>

          <View style={styles.row}>
            <Controller
              control={form.control}
              name="startTime"
              render={({ field }) => (
                <View style={styles.half}>
                  <TextField
                    label="Başlangıç"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="09:00"
                    keyboardType="numbers-and-punctuation"
                    error={form.errors.startTime}
                  />
                </View>
              )}
            />
            <Controller
              control={form.control}
              name="endTime"
              render={({ field }) => (
                <View style={styles.half}>
                  <TextField
                    label="Bitiş"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="10:50"
                    keyboardType="numbers-and-punctuation"
                    error={form.errors.endTime}
                  />
                </View>
              )}
            />
          </View>

          <Controller
            control={form.control}
            name="location"
            render={({ field }) => (
              <TextField
                label="Yer (isteğe bağlı)"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="D-201"
                error={form.errors.location}
              />
            )}
          />

          <Controller
            control={form.control}
            name="isLab"
            render={({ field }) => (
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <AppText>Laboratuvar saati</AppText>
                  <AppText variant="caption" tone="muted">
                    Planlayıcı laboratuvara hiç karışmaz; yalnızca o günü dolu sayar.
                  </AppText>
                </View>
                <Switch
                  accessibilityLabel="Laboratuvar saati"
                  value={field.value}
                  onValueChange={field.onChange}
                />
              </View>
            )}
          />

          <Button label="Programa ekle" loading={form.isSaving} onPress={form.onSubmit} />
        </>
      )}
    </Card>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  card: { gap: spacing.md },
  group: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: spacing.xxs },
}));
