import { CheckInForm, CheckInResult, useCheckinForm } from '@features/daily-check-in';
import { AppText, makeStyles } from '@shared/ui';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

export function CheckInScreen() {
  const form = useCheckinForm();
  const router = useRouter();
  const styles = useStyles();

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="title" accessibilityRole="header">
          {form.result ? 'Plan güncellendi' : 'Bugün nasıl geçti?'}
        </AppText>
        {form.result ? (
          <CheckInResult result={form.result} onDone={() => router.back()} />
        ) : (
          <>
            <AppText tone="muted">
              Bir arkadaşına anlatır gibi yaz. Yapamadığın işler otomatik olarak yeniden planlanır.
            </AppText>
            <CheckInForm form={form} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors, spacing }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
}));
