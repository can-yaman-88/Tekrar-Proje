import { AppText, makeStyles } from '@shared/ui';
import { Pressable, View } from 'react-native';
import type { AttachmentsController } from '../model/useAttachments';
import { Sheet } from './Sheet';

/** What can be done with one attachment: open, share, rename, delete. */
export function ActionsSheet({ controller }: { controller: AttachmentsController['actions'] }) {
  const styles = useStyles();
  const vm = controller;
  return (
    <Sheet visible={vm.attachment !== null} onDismiss={vm.onDismiss}>
      <AppText variant="subtitle" numberOfLines={2} accessibilityRole="header">
        {vm.attachment?.title ?? ''}
      </AppText>
      {vm.attachment && !vm.attachment.editable ? (
        <AppText variant="caption" tone="muted">
          Bu dosya bir değerlendirmeyle gönderildi; adı ve kendisi o kayıtla birlikte durur.
        </AppText>
      ) : null}
      <View style={styles.list}>
        {vm.items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => vm.onSelect(item.key)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <AppText variant="body" tone={item.destructive ? 'danger' : 'default'}>
              {item.label}
            </AppText>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={vm.onDismiss}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
        >
          <AppText variant="body" tone="muted">
            Vazgeç
          </AppText>
        </Pressable>
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors, spacing }) => ({
  list: { gap: 0 },
  item: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.6 },
}));
