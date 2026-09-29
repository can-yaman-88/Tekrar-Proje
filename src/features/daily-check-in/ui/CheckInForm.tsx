import { formatLongDate } from '@shared/lib/date';
import { AppText, Button, makeStyles, useTheme } from '@shared/ui';
import { Controller } from 'react-hook-form';
import { Pressable, TextInput, View } from 'react-native';
import { DAY_ROLLOVER_HOUR } from '../domain/report-date';
import type { CheckinFormController } from '../model/useCheckinForm';
import { AttachmentPicker } from './AttachmentPicker';
import { CheckinExamples } from './CheckinExamples';

const PLACEHOLDER =
  'örn. "30 kafes problemini bitirdim, iyiydi. Carnot setine başladım ama verim türetmesinde takıldım. Gauss\'a hiç bakamadım."';

/**
 * The sentences a tired student types most. One tap, and they can still add to
 * it — "Bugün hiç çalışamadım." is a complete report on its own.
 */
const QUICK_PHRASES = [
  'Bugünkü görevlerin hepsini bitirdim.',
  'Bugün hiç çalışamadım.',
  'Yarın sadece 1 saatim var.',
  'Yarın ne var?',
] as const;

export function CheckInForm({ form }: { form: CheckinFormController }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      {form.filedUnderYesterday ? (
        <AppText variant="caption" tone="warning">
          Saat {String(DAY_ROLLOVER_HOUR).padStart(2, '0')}.00’e kadar yazılan rapor biten güne sayılır:{' '}
          {formatLongDate(form.reportDate)}.
        </AppText>
      ) : null}
      <Controller
        control={form.control}
        name="report"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            accessibilityLabel="Daily report"
            multiline
            autoFocus
            textAlignVertical="top"
            placeholder={PLACEHOLDER}
            placeholderTextColor={colors.textMuted}
            maxLength={form.maxLength}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            editable={!form.isSubmitting}
            style={[styles.input, form.fieldError ? styles.inputError : null]}
          />
        )}
      />
      <View style={styles.footer}>
        <AppText variant="caption" tone={form.fieldError ? 'danger' : 'muted'} style={styles.hint}>
          {form.fieldError ??
            'Neyi çözdüğünü, nerede takıldığını ve neye bakamadığını yaz. Birkaç gün ara verdiysen hepsini tek seferde anlat: "pazartesi…", "dün…".'}
        </AppText>
        <AppText variant="caption" tone="muted">
          {form.charCount}/{form.maxLength}
        </AppText>
      </View>

      <View style={styles.phrases} accessibilityLabel="Hazır cümleler">
        {QUICK_PHRASES.map((phrase) => (
          <Pressable
            key={phrase}
            accessibilityRole="button"
            accessibilityHint="Cümleyi raporun sonuna ekler"
            disabled={form.isSubmitting}
            onPress={() => form.appendPhrase(phrase)}
            style={({ pressed }) => [styles.phrase, pressed && styles.pressed]}
          >
            <AppText variant="caption" tone="primary">
              {phrase}
            </AppText>
          </Pressable>
        ))}
      </View>

      {/*
        The report can do everything the student can do by hand, and nothing on
        this screen said so — so they kept doing it by hand.
      */}
      <CheckinExamples />

      <AttachmentPicker attachments={form.attachments} disabled={form.isSubmitting} />

      {form.submitError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <AppText variant="label" tone="danger">
            {form.submitError.title}
          </AppText>
          <AppText variant="caption" tone="danger">
            {form.submitError.message} Yazdıkların kaydedildi, tekrar deneyebilirsin.
          </AppText>
        </View>
      ) : null}

      <Button
        label={form.submitError ? 'Tekrar dene' : 'Günümü değerlendir'}
        loading={form.isSubmitting}
        onPress={form.onSubmit}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing, typography }) => ({
  container: { gap: spacing.md },
  input: {
    ...typography.body,
    minHeight: 180,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  inputError: { borderColor: colors.danger },
  phrases: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  phrase: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryMuted,
  },
  pressed: { opacity: 0.7 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  hint: { flex: 1 },
  errorBox: { backgroundColor: colors.dangerMuted, borderRadius: radii.md, padding: spacing.md, gap: spacing.xxs },
}));
