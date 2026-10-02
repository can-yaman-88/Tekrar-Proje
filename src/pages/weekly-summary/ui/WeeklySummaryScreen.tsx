import { useWeeklySummary, WeekBarChart } from '@features/weekly-summary';
import { AppText, Button, Card, ErrorState, ProgressBar, Screen, Skeleton, makeStyles } from '@shared/ui';
import { Pressable, ScrollView, View } from 'react-native';

export function WeeklySummaryScreen() {
  const vm = useWeeklySummary();
  const styles = useStyles();

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  if (vm.isLoading) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton height={72} radius={16} />
          <Skeleton height={140} radius={16} />
          <Skeleton height={120} radius={16} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.weekNav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Önceki hafta" onPress={vm.onPreviousWeek}>
            <AppText tone="primary">‹ Önceki</AppText>
          </Pressable>
          <AppText variant="label">{vm.rangeLabel}</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sonraki hafta"
            disabled={vm.isCurrentWeek}
            onPress={vm.onNextWeek}
          >
            <AppText tone={vm.isCurrentWeek ? 'muted' : 'primary'}>Sonraki ›</AppText>
          </Pressable>
        </View>

        <Card style={styles.card}>
          <AppText variant="subtitle">{vm.headline}</AppText>
          <View style={styles.statGrid}>
            {vm.stats.map((stat) => (
              <View key={stat.label} style={styles.stat}>
                <AppText variant="title">{stat.value}</AppText>
                <AppText variant="caption" tone="muted">
                  {stat.label}
                </AppText>
              </View>
            ))}
          </View>
        </Card>

        <Card style={styles.card}>
          <AppText variant="subtitle">Gün gün</AppText>
          <WeekBarChart days={vm.days} />
          <AppText variant="caption" tone="muted">
            {vm.hasMeasuredTime
              ? 'Çubuklar zamanlayıcıyla ölçülen süre, altındaki sayı o gün biten görev.'
              : 'Süre tutmadığın için çubuklar tahmini süreyi gösteriyor.'}
          </AppText>
        </Card>

        {vm.courses.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="subtitle">Derslere göre süre</AppText>
            {vm.courses.map((course) => (
              <View key={course.id} style={styles.courseRow}>
                <View style={styles.row}>
                  <AppText style={styles.flex} numberOfLines={1}>
                    {course.label}
                  </AppText>
                  <AppText variant="label">{course.minutesLabel}</AppText>
                </View>
                <ProgressBar value={course.ratio} height={4} accessibilityLabel={`${course.label} ${course.minutesLabel}`} />
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {course.topicsLabel}
                </AppText>
              </View>
            ))}
            <AppText variant="caption" tone="muted">
              Görev zamanlayıcısı ve Focus Timer’la ölçülen süre birlikte.
            </AppText>
          </Card>
        ) : null}

        {vm.groups.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="subtitle">Etiketlere göre</AppText>
            {vm.groups.map((group) => (
              <View key={group.group} style={styles.row}>
                <AppText style={styles.flex}>{group.label}</AppText>
                <AppText variant="caption" tone={group.completed === group.total ? 'success' : 'muted'}>
                  {group.completed}/{group.total}
                </AppText>
              </View>
            ))}
          </Card>
        ) : null}

        {vm.calibration.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="subtitle">Tahmin – gerçek</AppText>
            {vm.calibration.map((row) => (
              <View key={row.label} style={styles.row}>
                <AppText style={styles.flex}>{row.label}</AppText>
                <AppText variant="caption" tone="muted">
                  {row.estimated} dk → {row.actual} dk
                </AppText>
                <AppText variant="caption" tone={row.drift > 5 ? 'warning' : row.drift < -5 ? 'success' : 'muted'}>
                  {row.drift > 0 ? `+${row.drift}` : row.drift}
                </AppText>
              </View>
            ))}
            <AppText variant="caption" tone="muted">
              Plan bu sürelere göre kuruluyor; sapma büyükse haftalık plan da kayar.
            </AppText>
          </Card>
        ) : null}

        {vm.struggling.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="subtitle">Zorlandığın konular</AppText>
            {vm.struggling.map((topic) => (
              <View key={topic.id} style={styles.row}>
                <AppText style={styles.flex} numberOfLines={1}>
                  {topic.title}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {topic.detail}
                </AppText>
              </View>
            ))}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <AppText variant="subtitle">Sonraki adım</AppText>
          <Button label="Gidişat: derslerin sınavlara göre durumu" variant="secondary" onPress={vm.onOpenProgress} />
          <Button label="Biriken işleri gözden geçir" variant="ghost" onPress={vm.onOpenBacklog} />
        </Card>

        <Card style={styles.card}>
          <AppText variant="subtitle">Gelecek haftanın tekrarları</AppText>
          {vm.nextWeek.length === 0 ? (
            <AppText tone="muted">Gelecek hafta için planlanmış tekrar yok.</AppText>
          ) : (
            vm.nextWeek.map((topic) => (
              <View key={topic.id} style={styles.row}>
                <AppText style={styles.flex} numberOfLines={1}>
                  {topic.title}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {topic.detail}
                </AppText>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  weekNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { gap: spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { minWidth: '40%', gap: spacing.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  courseRow: { gap: spacing.xxs },
  flex: { flex: 1 },
}));
