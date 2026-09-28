import { useClearLlmApiKey, useProfile, useSetLlmApiKey } from '@entities/profile';
import { formatLongDate } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useCallback, useState } from 'react';

/** Mirrors the database's own check, so the student is told before a round trip. */
const MIN_KEY_LENGTH = 20;
const MAX_KEY_LENGTH = 400;

/**
 * The student's own OpenRouter key.
 *
 * What is typed here goes straight to the database, which keeps it in Vault.
 * The app never stores it, never caches it and cannot read it back — after
 * saving, the only thing it knows is the last four characters. So the field is
 * always empty on arrival: there is nothing to prefill.
 */
export function useLlmApiKey() {
  const profile = useProfile();
  const save = useSetLlmApiKey();
  const clear = useClearLlmApiKey();
  const [draft, setDraft] = useState('');

  const onSave = useCallback(() => {
    const key = draft.trim();
    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
      showToast('Bu bir API anahtarına benzemiyor. Anahtarın tamamını yapıştır.', 'danger');
      return;
    }
    if (/\s/.test(key)) {
      showToast('Anahtarda boşluk var; kopyalarken fazladan karakter almış olabilirsin.', 'danger');
      return;
    }
    save.mutate(key, {
      onSuccess: () => {
        setDraft('');
        showToast('Anahtar kaydedildi. Bundan sonra çağrılar senin hesabından geçecek.', 'success');
      },
      onError: (error) => showToast(describeError(error).message, 'danger'),
    });
  }, [draft, save]);

  const onClear = useCallback(() => {
    clear.mutate(undefined, {
      onSuccess: () => showToast('Anahtar silindi; sunucudaki varsayılan anahtara dönüldü.', 'success'),
      onError: (error) => showToast(describeError(error).message, 'danger'),
    });
  }, [clear]);

  const hint = profile.data?.llmKeyHint ?? null;
  const setAt = profile.data?.llmKeySetAt ?? null;

  return {
    isLoading: profile.isPending,
    /** True when a key of the student's own is in use. */
    hasKey: hint !== null,
    /** e.g. "••••1a2b · 26 Eylül 2026" — never the key itself. */
    keyLabel: hint === null ? null : `••••${hint}${setAt ? ` · ${formatLongDate(setAt.slice(0, 10))}` : ''}`,
    draft,
    onChangeDraft: setDraft,
    canSave: draft.trim().length >= MIN_KEY_LENGTH && !save.isPending,
    isSaving: save.isPending,
    isClearing: clear.isPending,
    onSave,
    onClear,
  };
}

export type LlmApiKeyController = ReturnType<typeof useLlmApiKey>;
