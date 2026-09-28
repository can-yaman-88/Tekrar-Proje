import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, EmptyState, ErrorState, Skeleton, makeStyles, useTheme } from '@shared/ui';
import { Pressable, ScrollView, View } from 'react-native';
import type { BacklogController } from '../model/useBacklogReview';

export function BacklogScreenContent({ backlog }: { backlog: BacklogController }) {
  const styles = useStyles();
  const { colors } = useTheme();

  if (backlog.error) {
    return (
      <ErrorState
        title={backlog.error.title}
        message={backlog.error.message}
        actionLabel="Tekrar dene"
        onAction={backlog.retry}
      />
    );
  }

  if (backlog.isLoading) {
    return (
      <View style={styles.content}>
        <Skeleton height={72} radius={16} />
        <Skeleton height={72} radius={16} />
      </View>
    );
  }

  if (backlog.count === 0) {
    return (
      <EmptyState
        icon="checkmark-done-outline"
        title="Biriken iş yok"
        message={`${backlog.cutoffDays} günden eski açık görevin yok. Liste temiz.`}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <AppText variant="subtitle">
          {backlog.count} görev {backlog.cutoffDays} günden eski
        </AppText>
        <AppText variant="caption" tone="muted">
          Bunlar bugünün planı değil, geçmişin borcu. Hâlâ gerekli olanları önümüzdeki {backlog.spreadDays} güne
          dağıt, gerekmeyenleri kapat — ikisi de dürüst cevap, listede durmaları değil.
        </AppText>
        <View style={styles.selectRow}>
          <Pressable accessibilityRole="button" onPress={backlog.onSelectAll} hitSlop={8}>
            <AppText variant="caption" tone="primary">
              Hepsini seç
            </AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={backlog.onSelectNone} hitSlop={8}>
            <AppText variant="caption" tone="muted">
              Seçimi kaldır
            </AppText>
          </Pressable>
          <AppText variant="caption" tone="muted" style={styles.flexEnd}>
            {backlog.selectedCount} seçili · {backlog.totalMinutes} dk
          </AppText>
        </View>
      </Card>

      {backlog.rows.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.isSelected }}
          accessibilityLabel={`${row.title} seçimi`}
          onPress={() => backlog.onToggle(row.id)}
        >
          <Card style={styles.row}>
            <View style={[styles.check, row.isSelected && styles.checkOn]}>
              {row.isSelected ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
            </View>
            <View style={styles.flex}>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {row.subtitle}
              </AppText>
              <AppText numberOfLines={2}>{row.title}</AppText>
              <AppText variant="caption" tone="warning">
                {row.ageLabel}
                {row.minutes > 0 ? ` · ${row.minutes} dk` : ''}
              </AppText>
            </View>
          </Card>
        </Pressable>
      ))}

      <View style={styles.actions}>
        <Button
          label={`Bu ${backlog.spreadDays} güne dağıt`}
          loading={backlog.isBusy}
          disabled={backlog.selectedCount === 0}
          onPress={backlog.onSpread}
          style={styles.action}
        />
        <Button
          label="Kapat"
          variant="secondary"
          loading={backlog.isBusy}
          disabled={backlog.selectedCount === 0}
          onPress={backlog.onClose}
          style={styles.action}
        />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(({ spacing, colors, radii }) => ({
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { gap: spacing.sm },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexEnd: { flex: 1, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, gap: spacing.xxs },
  check: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
}));
