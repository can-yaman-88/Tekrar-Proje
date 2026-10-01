import { AppText, Button, TextField, makeStyles } from '@shared/ui';
import { View } from 'react-native';
import type { AttachmentsController } from '../model/useAttachments';
import { Sheet } from './Sheet';

/** "Link ekle": an address, and a name if the page's own will not do. */
export function LinkSheet({ controller }: { controller: AttachmentsController['link'] }) {
  const styles = useStyles();
  const vm = controller;
  return (
    <Sheet visible={vm.visible} onDismiss={vm.onDismiss}>
      <AppText variant="subtitle" accessibilityRole="header">
        Link ekle
      </AppText>
      <TextField
        label="Adres"
        value={vm.url}
        onChangeText={vm.onUrl}
        placeholder="https://…"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        inputMode="url"
        returnKeyType="next"
        error={vm.error}
      />
      <TextField
        label="Ad (isteğe bağlı)"
        value={vm.title}
        onChangeText={vm.onTitle}
        placeholder={vm.titlePlaceholder}
        maxLength={200}
        returnKeyType="done"
        onSubmitEditing={vm.onSave}
      />
      <View style={styles.actions}>
        <Button label="Ekle" disabled={!vm.canSave} onPress={vm.onSave} />
        <Button label="Vazgeç" variant="ghost" onPress={vm.onDismiss} />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  actions: { gap: spacing.xs },
}));
