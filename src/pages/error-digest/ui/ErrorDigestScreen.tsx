import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SegmentedControl,
  Skeleton,
  makeStyles,
  useTheme,
  type TextTone,
} from '@shared/ui';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import {
  PERIOD_OPTIONS,
  useErrorDigestScreen,
  type ErrorDigestController,
  type GroupRow,
} from '../model/useErrorDigestScreen';

const STATUS_TONE: Record<GroupRow['status'], TextTone> = {
  regression: 'danger',
  new: 'warning',
  resolved: 'success',
  open: 'muted',
};

export function ErrorDigestScreen() {
  const vm = useErrorDigestScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.isCheckingAccess) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton height={88} radius={12} />
        </View>
      </Screen>
    );
  }

  if (vm.error) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  if (!vm.isAdmin) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="lock-closed-outline"
          title="Yalnızca yöneticiler için"
          message="Hata özetini görmek için hesabın panodan app_admins tablosuna eklenmeli (README → Hata raporları)."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={vm.isRefreshing} onRefresh={() => void vm.refresh()} tintColor={colors.primary} />
        }
      >
        <SegmentedControl
          options={PERIOD_OPTIONS}
          value={vm.period}
          onChange={vm.onPeriod}
          accessibilityLabel="Dönem"
        />

        {vm.period === 'weeks' && vm.weeks.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeks}>
            {vm.weeks.map((week) => (
              <Pressable
                key={week.weekStart}
                onPress={() => vm.onWeek(week.weekStart)}
                accessibilityRole="button"
                accessibilityState={{ selected: week.isSelected }}
                style={[styles.weekChip, week.isSelected && styles.weekChipSelected]}
              >
                <AppText variant="caption" tone={week.isSelected ? 'primary' : 'muted'}>
                  {week.label} · {week.total}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {vm.isLoading ? (
          <>
            <Skeleton height={88} radius={12} />
            <Skeleton height={120} radius={12} />
          </>
        ) : vm.view === null ? (
          <EmptyState
            icon="calendar-outline"
            title="Henüz haftalık özet yok"
            message="Özet her pazartesi sabahı geçen haftanın raporlarıyla oluşur. O zamana kadar son 7 güne bakabilirsin."
          />
        ) : (
          <Digest vm={vm} view={vm.view} />
        )}
      </ScrollView>
    </Screen>
  );
}

function Digest({ vm, view }: { vm: ErrorDigestController; view: NonNullable<ErrorDigestController['view']> }) {
  const styles = useStyles();
  return (
    <>
      <Card style={styles.summary}>
        <AppText variant="caption" tone="muted">
          {vm.periodLabel}
        </AppText>
        <View style={styles.tiles}>
          {view.tiles.map((tile) => (
            <View key={tile.key} style={styles.tile}>
              <AppText variant="title" tone={tile.value > 0 && tile.tone !== 'default' ? tile.tone : 'default'}>
                {tile.value}
              </AppText>
              <AppText variant="caption" tone="muted">
                {tile.label}
              </AppText>
            </View>
          ))}
        </View>
        <AppText variant="caption" tone="muted">
          {view.trend} · {view.sourceLine}
        </AppText>
        {view.versionsLine ? (
          <AppText variant="caption" tone="muted">
            Sürümler: {view.versionsLine}
          </AppText>
        ) : null}
      </Card>

      {view.groups.length === 0 ? (
        <EmptyState icon="checkmark-circle-outline" title="Hata yok" message="Bu dönemde hiç rapor gelmedi." />
      ) : (
        <View style={styles.groups}>
          <AppText variant="label" tone="muted">
            En çok yaşananlar
          </AppText>
          {view.groups.map((group) => (
            <GroupCard key={group.fingerprint} vm={vm} group={group} />
          ))}
          {view.moreGroups > 0 ? (
            <AppText variant="caption" tone="muted">
              ve {view.moreGroups} grup daha (daha seyrek).
            </AppText>
          ) : null}
        </View>
      )}
    </>
  );
}

function GroupCard({ vm, group }: { vm: ErrorDigestController; group: GroupRow }) {
  const styles = useStyles();
  const isOpen = vm.expanded === group.fingerprint;
  return (
    <Card style={styles.group}>
      <Pressable
        onPress={() => vm.onToggleGroup(group.fingerprint)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint="Raporları gösterir"
        style={styles.groupHeader}
      >
        <View style={styles.groupTitleRow}>
          <AppText variant="label" style={styles.flex} numberOfLines={1}>
            {group.place}
          </AppText>
          <AppText variant="caption" tone={STATUS_TONE[group.status]}>
            {group.statusLabel}
          </AppText>
        </View>
        <AppText variant="caption" numberOfLines={isOpen ? undefined : 2}>
          {group.message}
        </AppText>
        <AppText variant="caption" tone="muted">
          {group.origin} · {group.countLabel} · {group.seenLabel}
        </AppText>
      </Pressable>

      {isOpen ? (
        <View style={styles.detail}>
          {vm.detail.isLoading ? <Skeleton height={60} radius={8} /> : null}
          {vm.detail.error ? (
            <AppText variant="caption" tone="danger">
              {vm.detail.error}
            </AppText>
          ) : null}
          {vm.detail.note ? (
            <AppText variant="caption" tone="muted">
              Not: {vm.detail.note}
            </AppText>
          ) : null}
          {vm.detail.reports.map((report) => (
            <View key={report.id} style={styles.report}>
              <AppText variant="caption" tone="muted">
                {report.timeLabel}
                {report.reporter ? ` · #${report.reporter}` : ''}
              </AppText>
              <AppText variant="caption">{report.message}</AppText>
              {report.facts.length > 0 ? (
                <AppText variant="caption" tone="muted">
                  {report.facts.join(' · ')}
                </AppText>
              ) : null}
              {report.stack ? (
                <AppText variant="caption" tone="muted" style={styles.stack} selectable>
                  {report.stack}
                </AppText>
              ) : null}
            </View>
          ))}
          <Button
            label={group.isResolved ? 'Yeniden aç' : 'Düzeltildi olarak işaretle'}
            variant={group.isResolved ? 'ghost' : 'secondary'}
            loading={vm.resolvingFingerprint === group.fingerprint}
            onPress={() => vm.onResolve(group.fingerprint, !group.isResolved)}
          />
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  weeks: { gap: spacing.sm, paddingVertical: spacing.xxs },
  weekChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  weekChipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  summary: { gap: spacing.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { minWidth: 56, gap: spacing.xxs },
  groups: { gap: spacing.sm },
  group: { gap: spacing.sm },
  groupHeader: { gap: spacing.xxs },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  detail: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  report: { gap: spacing.xxs },
  stack: { fontFamily: 'monospace', fontSize: 11, lineHeight: 15 },
}));
