import { AuthForm, useAuthForm } from '@features/auth';
import { AppText, makeStyles, Screen } from '@shared/ui';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

export function SignInScreen() {
  const form = useAuthForm();
  const styles = useStyles();

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.hero}>
          <AppText variant="display">Tekrar</AppText>
          <AppText tone="muted">Daha çok çöz, daha az unut. Gününe göre kendini güncelleyen bir çalışma planı.</AppText>
        </View>
        <AuthForm form={form} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  root: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
  hero: { gap: spacing.sm },
}));
