import { CheckInForm, CheckInResult, useCheckinForm } from '@features/daily-check-in';
import { useReportReminders } from '@features/reminders';
import { AppText, makeStyles, Screen } from '@shared/ui';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

export function CheckInScreen() {
  const form = useCheckinForm();
  const router = useRouter();
  // The server cannot ring the phone: what the report asked to be reminded of
  // is scheduled here, once the answer is in.
  useReportReminders(form.result);
  const styles = useStyles();

  // Without the bottom edge the send and retry buttons sat under Android's navigation bar.
  return (
    <Screen edges={['bottom']}>
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
    </Screen>
  );
}

const useStyles = makeStyles(({ colors, spacing }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
}));
