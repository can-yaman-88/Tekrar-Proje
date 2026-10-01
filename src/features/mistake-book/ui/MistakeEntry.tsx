import { MISTAKE_BODY_MAX, MISTAKE_CONCEPT_MAX } from '@entities/topic-mistake';
import { AppText, Button, TextField, makeStyles } from '@shared/ui';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import type { MistakeActions } from '../model/useMistakeActions';

export interface MistakeEntryModel {
  id: string;
  body: string;
  concept: string | null;
  /** The label, when it says something the sentence does not. */
  chip: string | null;
  /** "28 Eyl · değerlendirmeden · Kafes sınavı" */
  meta: string;
  isResolved: boolean;
  /** "çözüldü: 30 Eyl" */
  resolvedLabel: string | null;
}

/**
 * One entry of the mistake book: the student's own sentence first, its label
 * as a chip, where it came from underneath. "Çözdüm" is one tap and can be
 * taken back from the toast; a long press offers editing and deleting.
 */
export function MistakeEntry({ entry, actions }: { entry: MistakeEntryModel; actions: MistakeActions }) {
  const styles = useStyles();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(entry.body);
  const [concept, setConcept] = useState(entry.concept ?? '');
  const busy = actions.busyId === entry.id;

  const openMenu = () =>
    Alert.alert('Bu madde', entry.body, [
      { text: 'Düzenle', onPress: () => setEditing(true) },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Silinsin mi?', 'Bu madde defterden tamamen kalkar; geri alınamaz.', [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Sil', style: 'destructive', onPress: () => actions.remove(entry.id) },
          ]),
      },
      { text: 'Vazgeç', style: 'cancel' },
    ]);

  if (editing) {
    return (
      <View style={styles.editor}>
        <TextField
          label="Ne oldu? (kendi cümlen)"
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={MISTAKE_BODY_MAX}
        />
        <TextField
          label="Kısa etiket (isteğe bağlı)"
          value={concept}
          onChangeText={setConcept}
          maxLength={MISTAKE_CONCEPT_MAX}
          placeholder="Örn. Birim çevirme"
        />
        <View style={styles.editorActions}>
          <Button
            label="Kaydet"
            loading={actions.isUpdating}
            style={styles.flex}
            onPress={() =>
              void actions.update(entry.id, body, concept.trim() === '' ? null : concept).then((saved) => {
                if (saved) setEditing(false);
              })
            }
          />
          <Button
            label="Vazgeç"
            variant="ghost"
            onPress={() => {
              setBody(entry.body);
              setConcept(entry.concept ?? '');
              setEditing(false);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onLongPress={openMenu}
      delayLongPress={350}
      accessibilityHint="Düzenlemek ya da silmek için basılı tut"
      style={({ pressed }) => [styles.entry, entry.isResolved && styles.resolved, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        {entry.chip ? (
          <View style={styles.chip}>
            <AppText variant="caption" tone="primary" numberOfLines={1}>
              {entry.chip}
            </AppText>
          </View>
        ) : null}
        <AppText style={entry.isResolved ? styles.strike : undefined}>{entry.body}</AppText>
        <AppText variant="caption" tone="muted">
          {entry.isResolved && entry.resolvedLabel ? `${entry.meta} · ${entry.resolvedLabel}` : entry.meta}
        </AppText>
      </View>
      <View style={styles.side}>
        {entry.isResolved ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`"${entry.body}" maddesini yeniden aç`}
            hitSlop={8}
            disabled={busy}
            onPress={() => actions.reopen(entry.id)}
            style={[styles.pill, styles.pillMuted]}
          >
            <AppText variant="caption" tone={busy ? 'muted' : 'primary'}>
              Geri aç
            </AppText>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`"${entry.body}" maddesini çözüldü olarak işaretle`}
            hitSlop={8}
            disabled={busy}
            onPress={() => actions.resolve(entry.id)}
            style={[styles.pill, styles.pillSuccess]}
          >
            <AppText variant="caption" tone={busy ? 'muted' : 'success'}>
              ✓ Çözdüm
            </AppText>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Düzenle ya da sil"
          hitSlop={10}
          onPress={openMenu}
          style={styles.more}
        >
          <AppText variant="label" tone="muted">
            ⋯
          </AppText>
        </Pressable>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  entry: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resolved: { opacity: 0.7 },
  pressed: { opacity: 0.6 },
  text: { flex: 1, gap: spacing.xxs },
  strike: { textDecorationLine: 'line-through' },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryMuted,
    maxWidth: '100%',
  },
  side: { alignItems: 'flex-end', gap: spacing.xs },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill },
  pillSuccess: { backgroundColor: colors.successMuted },
  pillMuted: { backgroundColor: colors.surfaceMuted },
  more: { paddingHorizontal: spacing.xs },
  editor: { gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
}));
