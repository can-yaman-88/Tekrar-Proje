import { AppText, Button, TextField, makeStyles } from '@shared/ui';
import { View } from 'react-native';
import type { AttachmentsController } from '../model/useAttachments';
import { Sheet } from './Sheet';

export function RenameSheet({ controller }: { controller: AttachmentsController['rename'] }) {
  const styles = useStyles();
  const vm = controller;
  return (
    <Sheet visible={vm.visible} onDismiss={vm.onDismiss}>
      <AppText variant="subtitle" accessibilityRole="header">
        {vm.isLink ? 'Linki düzenle' : 'Yeniden adlandır'}
      </AppText>
      <TextField
        label="Ad"
        value={vm.title}
        onChangeText={vm.onTitle}
        autoFocus
        maxLength={200}
        returnKeyType="done"
        onSubmitEditing={vm.isLink ? undefined : vm.onSave}
        error={vm.isLink ? null : vm.error}
      />
      {vm.isLink ? (
        <TextField
          label="Adres"
          value={vm.url}
          onChangeText={vm.onUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
          returnKeyType="done"
          onSubmitEditing={vm.onSave}
          error={vm.error}
        />
      ) : null}
      <View style={styles.actions}>
        <Button label="Kaydet" onPress={vm.onSave} />
        <Button label="Vazgeç" variant="ghost" onPress={vm.onDismiss} />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  actions: { gap: spacing.xs },
}));
