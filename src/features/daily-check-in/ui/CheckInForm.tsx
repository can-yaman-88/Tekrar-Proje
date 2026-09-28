import { AppText, Button, makeStyles, useTheme } from '@shared/ui';
import { Controller } from 'react-hook-form';
import { TextInput, View } from 'react-native';
import type { CheckinFormController } from '../model/useCheckinForm';
import { AttachmentPicker } from './AttachmentPicker';

const PLACEHOLDER =
  'örn. "30 kafes problemini bitirdim, iyiydi. Carnot setine başladım ama verim türetmesinde takıldım. Gauss\'a hiç bakamadım."';

/** What the report can change besides reporting; elle yapılan her şey buraya da yazılabilir. */
const POWERS_HINT =
  'Aynı yazıyla planı da değiştirebilirsin: “pazarı boşalt, görevleri bugünden dağıt”, ' +
  '“fizik ödevi 25 soruymuş”, “şu üçünü tek ödev olarak grupla”, “ödeve 40 dakika harcadım”, ' +
  '“vize 5 aralığa ertelendi”, “geçen takıldığım bağıl hız meselesi oturdu”.';

export function CheckInForm({ form }: { form: CheckinFormController }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
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

      {/*
        The report can do everything the student can do by hand, and nothing on
        this screen said so — so they kept doing it by hand.
      */}
      <View style={styles.powers}>
        <AppText variant="caption" tone="muted">
          {POWERS_HINT}
        </AppText>
      </View>

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
  powers: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  hint: { flex: 1 },
  errorBox: { backgroundColor: colors.dangerMuted, borderRadius: radii.md, padding: spacing.md, gap: spacing.xxs },
}));
