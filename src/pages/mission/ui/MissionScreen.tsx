import { ConfidenceSheet } from '@entities/topic';
import { GeneratePlanButton } from '@features/weekly-plan';
import { AppText, EmptyState, ErrorState, Screen } from '@shared/ui';
import { Pressable, View } from 'react-native';
import { ExamCountdownStrip } from '@widgets/exam-countdown-strip';
import { MissionHeader } from '@widgets/mission-header';
import { TaskGroupFilter } from '@widgets/task-group-filter';
import { TodayTaskList } from '@widgets/today-task-list';

import { useMissionScreen } from '../model/useMissionScreen';
import { MissionScreenSkeleton } from './MissionScreen.skeleton';
import { useMissionStyles } from './MissionScreen.styles';

export function MissionScreen() {
  const vm = useMissionScreen();
  const styles = useMissionStyles();

  if (vm.state.kind === 'loading') {
    return (
      <Screen>
        <MissionScreenSkeleton />
      </Screen>
    );
  }

  if (vm.state.kind === 'error') {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <ErrorState
            title={vm.state.error.title}
            message={vm.state.error.message}
            actionLabel={vm.state.error.canRetry ? 'Tekrar dene' : undefined}
            onAction={vm.retry}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TodayTaskList
        {...vm.list}
        header={
          <View>
            <MissionHeader {...vm.header} onOpenBacklog={vm.onOpenBacklog} />
            {vm.catchUp ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kaçırılan günleri değerlendir"
                onPress={vm.catchUp.onPress}
                style={({ pressed }) => [styles.catchUpBanner, pressed && styles.pressed]}
              >
                <AppText variant="caption" tone="primary">
                  {vm.catchUp.message}
                </AppText>
              </Pressable>
            ) : null}
            {vm.offline ? (
              <View style={styles.offlineBanner} accessibilityRole="alert">
                <AppText variant="caption" tone={vm.offline.isOnline ? 'primary' : 'muted'}>
                  {vm.offline.message}
                </AppText>
              </View>
            ) : null}
            {vm.deadlinePressure ? (
              <View style={styles.pressureBanner} accessibilityRole="alert">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: vm.deadlinePressure.isExpanded }}
                  accessibilityLabel="Teslim uyarısını aç kapa"
                  onPress={vm.deadlinePressure.onToggle}
                  style={styles.pressureHeader}
                >
                  <AppText variant="label" tone="warning">
                    Teslim uyarısı
                  </AppText>
                  <AppText variant="caption" tone="warning">
                    {vm.deadlinePressure.isExpanded ? 'gizle ▴' : 'göster ▾'}
                  </AppText>
                </Pressable>
                {vm.deadlinePressure.isExpanded ? (
                  <>
                    <AppText variant="caption" tone="warning">
                      {vm.deadlinePressure.message}
                    </AppText>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={vm.deadlinePressure.onHideForToday}
                      style={styles.pressureDismiss}
                    >
                      <AppText variant="caption" tone="muted">
                        Bugün için kapat
                      </AppText>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
            {vm.staleWarning ? (
              <View style={styles.staleBanner} accessibilityRole="alert">
                <AppText variant="caption" tone="warning">
                  {vm.staleWarning.title} — {vm.staleWarning.message}
                </AppText>
              </View>
            ) : null}
            <ExamCountdownStrip {...vm.exams} onSelect={vm.onOpenExam} />
            <TaskGroupFilter value={vm.filter.value} counts={vm.filter.counts} onChange={vm.filter.onChange} />
          </View>
        }
        empty={
          <View style={styles.empty}>
            <EmptyState
              icon="sparkles-outline"
              title="Planın boş"
              message="Derslerin hazırsa haftalık planı oluştur; izlence yüklemediysen Ayarlar → Dersler bölümüne uğra."
            />
            <GeneratePlanButton style={styles.emptyAction} />
          </View>
        }
      />
      <ConfidenceSheet {...vm.rating} secondary={{ label: 'Puanlamadan bitir', onPress: vm.rating.onSkip }} />
    </Screen>
  );
}
