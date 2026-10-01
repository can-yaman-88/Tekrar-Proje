import { AppText, Button, Skeleton, makeStyles } from '@shared/ui';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import type { MixedSetController } from '../model/useMixedSet';

/**
 * "Set nasıl geçti?" — one row per topic, one tap for how many were right.
 * Each topic's score goes to its own review schedule.
 */
export function MixedSetSheet({ controller }: { controller: MixedSetController }) {
  const styles = useStyles();
  const vm = controller;
  return (
    <Modal visible={vm.visible} transparent animationType="fade" onRequestClose={vm.onDismiss}>
      <Pressable style={styles.backdrop} onPress={vm.onDismiss} accessibilityLabel="Kapat">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <AppText variant="subtitle" accessibilityRole="header">
            {vm.title}
          </AppText>
          {vm.subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {vm.subtitle}
            </AppText>
          ) : null}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {vm.isLoading ? <Skeleton height={72} radius={10} /> : null}
            {vm.error ? (
              <AppText variant="caption" tone="danger">
                {vm.error}
              </AppText>
            ) : null}
            {vm.rows.map((row) => (
              <View key={row.id} style={styles.row}>
                <AppText variant="label">
                  {row.letter ? `${row.letter} · ` : ''}
                  {row.topicTitle}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {row.problems} sorudan kaç doğru?
                </AppText>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {Array.from({ length: row.problems + 1 }, (_, n) => (
                    <Pressable
                      key={n}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: row.correct === n }}
                      accessibilityLabel={`${row.topicTitle}: ${row.problems} sorudan ${n} doğru`}
                      onPress={() => vm.onAnswer(row.id, n)}
                      style={({ pressed }) => [
                        styles.chip,
                        row.correct === n && styles.chipSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AppText variant="label" tone={row.correct === n ? 'inverse' : 'default'}>
                        {n}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
                <AppText variant="caption" tone={row.hint.tone}>
                  {row.hint.text}
                </AppText>
              </View>
            ))}
          </ScrollView>

          <AppText variant="caption" tone="muted">
            %60’ın altında kalan konu yarın yeniden karşına gelir; set yine de bitmiş sayılır.
          </AppText>
          <View style={styles.actions}>
            <Button label="Kaydet" disabled={!vm.canSubmit} onPress={vm.onSubmit} />
            <Button label="Vazgeç" variant="ghost" onPress={vm.onDismiss} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    maxHeight: '88%',
  },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.lg },
  row: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minWidth: 40,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.8 },
  actions: { gap: spacing.xs },
}));
