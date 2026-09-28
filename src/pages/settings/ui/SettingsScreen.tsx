import { useProfile, useSetAutoWeeklyPlan } from '@entities/profile';
import { selectUserEmail, useSessionStore } from '@entities/session';
import { useSignOut } from '@features/auth';
import { CapacityCard, useLearnedCapacity } from '@features/capacity';
import { WeeklyPlanCard } from '@features/weekly-plan';
import { LlmApiKeyCard, useLlmApiKey } from '@features/llm-key';
import { LlmModelCard, useLlmModelSettings } from '@features/llm-model';
import { ReminderSettingsCard, useReminders } from '@features/reminders';
import {
  AppText,
  Button,
  Card,
  Screen,
  SegmentedControl,
  makeStyles,
  useThemeStore,
  type ThemePreference,
} from '@shared/ui';
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
];

export function SettingsScreen() {
  const email = useSessionStore(selectUserEmail);
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const reminders = useReminders();
  const llmModel = useLlmModelSettings();
  const apiKey = useLlmApiKey();
  const capacity = useLearnedCapacity();
  const profile = useProfile();
  const autoWeeklyPlan = useSetAutoWeeklyPlan();
  const signOut = useSignOut();
  const router = useRouter();
  const styles = useStyles();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          Ayarlar
        </AppText>

        <Card style={styles.card}>
          <AppText variant="caption" tone="muted">
            Giriş yapan
          </AppText>
          <AppText variant="subtitle">{email ?? '—'}</AppText>
        </Card>

        <Card style={styles.card}>
          <AppText variant="label">Tema</AppText>
          <AppText variant="caption" tone="muted">
            Sistem seçeneği telefonunun ayarını izler.
          </AppText>
          <SegmentedControl<ThemePreference>
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
            accessibilityLabel="Tema seçimi"
          />
        </Card>

        <WeeklyPlanCard
          autoEnabled={profile.data?.autoWeeklyPlan ?? true}
          isSaving={autoWeeklyPlan.isPending || profile.isPending}
          onToggleAuto={(enabled) => autoWeeklyPlan.mutate(enabled)}
        />

        <CapacityCard capacity={capacity} />

        <Card style={styles.card}>
          <AppText variant="label">Dersler ve izlence</AppText>
          <AppText variant="caption" tone="muted">
            Ders ekleme, izlence yükleme ve ders programı dönemde birkaç kez gerekir; bu yüzden burada durur.
          </AppText>
          <Button label="Derslere git" variant="secondary" onPress={() => router.push('/courses')} />
        </Card>

        <ReminderSettingsCard reminders={reminders} />

        <LlmApiKeyCard apiKey={apiKey} />

        <LlmModelCard settings={llmModel} />

        <Button label="Çıkış yap" variant="secondary" loading={signOut.isPending} onPress={() => signOut.mutate()} />
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { gap: spacing.sm },
}));
