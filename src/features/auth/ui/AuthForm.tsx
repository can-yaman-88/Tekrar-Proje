import { AppText, Button, makeStyles, useTheme } from '@shared/ui';
import { Controller } from 'react-hook-form';
import { TextInput, View } from 'react-native';
import type { AuthFormController } from '../model/useAuthForm';

export function AuthForm({ form }: { form: AuthFormController }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isSignIn = form.mode === 'signIn';

  if (form.awaitingConfirmation) {
    return (
      <View style={styles.container}>
        <AppText variant="subtitle">Gelen kutunu kontrol et</AppText>
        <AppText tone="muted">Onay bağlantısı gönderdik. Bağlantıyı açıp buradan giriş yap.</AppText>
        <Button label="Girişe dön" variant="secondary" onPress={form.toggleMode} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Controller
        control={form.control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            accessibilityLabel="E-posta"
            placeholder="E-posta"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            style={[styles.input, form.errors.email ? styles.inputError : null]}
          />
        )}
      />
      {form.errors.email ? (
        <AppText variant="caption" tone="danger">
          {form.errors.email}
        </AppText>
      ) : null}

      <Controller
        control={form.control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            accessibilityLabel="Şifre"
            placeholder="Şifre"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoComplete={isSignIn ? 'current-password' : 'new-password'}
            textContentType={isSignIn ? 'password' : 'newPassword'}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            onSubmitEditing={form.onSubmit}
            style={[styles.input, form.errors.password ? styles.inputError : null]}
          />
        )}
      />
      {form.errors.password ? (
        <AppText variant="caption" tone="danger">
          {form.errors.password}
        </AppText>
      ) : null}

      {form.submitError ? (
        <AppText variant="caption" tone="danger" accessibilityRole="alert">
          {form.submitError}
        </AppText>
      ) : null}

      <Button label={isSignIn ? 'Giriş yap' : 'Hesap oluştur'} loading={form.isSubmitting} onPress={form.onSubmit} />
      <Button
        label={isSignIn ? 'Hesabın yok mu? Oluştur' : 'Hesabın var mı? Giriş yap'}
        variant="ghost"
        onPress={form.toggleMode}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing, typography }) => ({
  container: { gap: spacing.sm },
  input: {
    ...typography.body,
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  inputError: { borderColor: colors.danger },
}));
