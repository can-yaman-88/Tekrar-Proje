import { ClassSessionRow } from '@entities/class-session';
import { SessionForm } from '@features/class-schedule';
import { AppText, Button, Card, ErrorState, Screen, Skeleton, makeStyles } from '@shared/ui';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useClassScheduleScreen } from '../model/useClassScheduleScreen';

export function ClassScheduleScreen() {
  const vm = useClassScheduleScreen();
  const styles = useStyles();

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText tone="muted">
            Program sen değiştirmedikçe olduğu gibi kalır. Planlayıcı, ders günlerini ve o günün yoğunluğunu
            buradan okur: çalışma, konunun işlendiği günden sonra başlar.
          </AppText>

          <Card style={styles.importCard}>
            <AppText variant="subtitle">Takvimden içe aktar</AppText>
            <AppText variant="caption" tone="muted">
              Telefonundaki takvimden iki haftalık dersleri okur; ders adı ya da kodu eşleşenleri
              programa ekler. Takvime hiçbir şey yazılmaz.
            </AppText>
            <Button
              label={vm.calendarImport.isImporting ? 'Okunuyor…' : 'Takvimi tara'}
              variant="secondary"
              loading={vm.calendarImport.isImporting}
              onPress={vm.calendarImport.importFromCalendar}
            />
            {vm.calendarImport.result && vm.calendarImport.result.unmatched.length > 0 ? (
              <View style={styles.unmatched}>
                <AppText variant="caption" tone="warning">
                  Bu kayıtlar bir derse bağlanamadı, elle ekleyebilirsin:
                </AppText>
                {vm.calendarImport.result.unmatched.map((title) => (
                  <AppText key={title} variant="caption" tone="muted">
                    • {title}
                  </AppText>
                ))}
              </View>
            ) : null}
          </Card>

          <SessionForm form={vm.editor} courses={vm.courses} />

          {vm.isLoading ? (
            <View style={styles.list}>
              <Skeleton height={64} radius={10} />
              <Skeleton height={64} radius={10} />
            </View>
          ) : vm.totalSessions === 0 ? (
            <Card>
              <AppText tone="muted">Program boş. Yukarıdan ilk dersini ekle.</AppText>
            </Card>
          ) : (
            vm.days
              .filter((day) => day.sessions.length > 0)
              .map((day) => (
                <View key={day.weekday} style={styles.day}>
                  <View style={styles.dayHeader}>
                    <AppText variant="label">{day.label}</AppText>
                    {day.totalLabel ? (
                      <AppText variant="caption" tone="muted">
                        {day.totalLabel}
                      </AppText>
                    ) : null}
                  </View>
                  {day.sessions.map((session) => (
                    <ClassSessionRow
                      key={session.id}
                      model={session}
                      onRemove={vm.editor.onRemove}
                      removeDisabled={vm.editor.isRemoving}
                    />
                  ))}
                </View>
              ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  list: { gap: spacing.sm },
  importCard: { gap: spacing.sm },
  unmatched: { gap: spacing.xxs },
  day: { gap: spacing.sm, marginTop: spacing.md },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));
