import { Button, TextField, makeStyles } from '@shared/ui';
import { Controller } from 'react-hook-form';
import { View } from 'react-native';
import type { NoteFormController } from '../model/useNoteForm';

export function NoteComposer({ form }: { form: NoteFormController }) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Controller
        control={form.control}
        name="body"
        render={({ field }) => (
          <TextField
            label="Yeni not"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
            maxLength={form.maxLength}
            placeholder="Nerede takıldın, hangi formülü unuttun?"
            error={form.error}
          />
        )}
      />
      <Button label="Not ekle" loading={form.isSaving} onPress={form.onSubmit} />
    </View>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  container: { gap: spacing.sm },
}));
