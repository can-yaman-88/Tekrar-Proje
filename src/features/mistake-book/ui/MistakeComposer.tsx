import { MISTAKE_BODY_MAX, MISTAKE_CONCEPT_MAX } from '@entities/topic-mistake';
import { Button, TextField, makeStyles } from '@shared/ui';
import { useState } from 'react';
import { View } from 'react-native';
import type { MistakeActions } from '../model/useMistakeActions';

/**
 * Writing a slip down by hand, without waiting for the evening check-in. The
 * sentence is what matters; the label only groups it.
 */
export function MistakeComposer({
  topicId,
  actions,
  onDone,
}: {
  topicId: string;
  actions: MistakeActions;
  onDone?: () => void;
}) {
  const styles = useStyles();
  const [body, setBody] = useState('');
  const [concept, setConcept] = useState('');

  const submit = async () => {
    const saved = await actions.add(topicId, body, concept.trim() === '' ? null : concept);
    if (!saved) return;
    setBody('');
    setConcept('');
    onDone?.();
  };

  return (
    <View style={styles.container}>
      <TextField
        label="Nerede takıldın?"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={MISTAKE_BODY_MAX}
        placeholder="Örn. birim çevirirken paydayı ters alıyorum"
      />
      <TextField
        label="Kısa etiket (isteğe bağlı)"
        value={concept}
        onChangeText={setConcept}
        maxLength={MISTAKE_CONCEPT_MAX}
        placeholder="Örn. Mol hesapları"
      />
      <View style={styles.actions}>
        <Button label="Deftere ekle" loading={actions.isAdding} onPress={() => void submit()} style={styles.flex} />
        {onDone ? <Button label="Vazgeç" variant="ghost" onPress={onDone} /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ spacing }) => ({
  container: { gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
}));
