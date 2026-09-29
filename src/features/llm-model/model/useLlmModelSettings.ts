import type { LlmModel } from '@contracts/llm-models.contract';
import { profileKeys, profileRepository, useProfile } from '@entities/profile';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchLlmModels } from '../data/llm-model.api';

/**
 * Rows drawn at a time. The whole catalogue (hundreds of models) is reachable —
 * by search, "daha fazla göster" or "tümünü göster" — but the settings screen
 * does not draw four hundred rows every time it opens.
 */
const PAGE_SIZE = 40;

/**
 * Model choice lives on the profile; the key and the provider stay on the
 * server. Testing a model runs one real structured-output call through it.
 */
export function useLlmModelSettings() {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const catalogue = useQuery({
    // A new key, so a list cached before the catalogue stopped being cut at
    // 120 is not shown for another hour from disk.
    queryKey: ['llm-models', 'full-catalogue'],
    queryFn: () => fetchLlmModels(),
    staleTime: 60 * 60_000,
  });

  const select = useMutation({
    mutationFn: (modelId: string | null) => profileRepository.setLlmModel(modelId),
    onSuccess: async (_data, modelId) => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      showToast(modelId ? `Model değiştirildi: ${modelId}` : 'Varsayılan modele dönüldü.', 'success');
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const test = useMutation({
    mutationFn: (modelId: string) => fetchLlmModels(modelId),
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const matching = useMemo<LlmModel[]>(() => {
    const all = catalogue.data?.models ?? [];
    const term = search.trim().toLocaleLowerCase('tr');
    return term ? all.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase('tr').includes(term)) : all;
  }, [catalogue.data, search]);
  const models = useMemo(() => matching.slice(0, visible), [matching, visible]);

  const selected = profile.data?.llmModel ?? null;

  return {
    isLoading: catalogue.isPending || profile.isPending,
    error: catalogue.isError ? describeError(catalogue.error) : null,
    retry: () => void catalogue.refetch(),
    provider: catalogue.data?.provider ?? null,
    defaultModel: catalogue.data?.defaultModel ?? null,
    selected,
    effectiveModel: selected ?? catalogue.data?.defaultModel ?? null,
    models,
    totalModels: catalogue.data?.models.length ?? 0,
    /** Models the search matches; `models` is the part of them drawn so far. */
    matchingModels: matching.length,
    hiddenModels: Math.max(0, matching.length - models.length),
    onShowMore: () => setVisible((count) => count + PAGE_SIZE),
    onShowAll: () => setVisible(Number.MAX_SAFE_INTEGER),
    search,
    // A new search starts from its first page again.
    onSearch: (text: string) => {
      setSearch(text);
      setVisible(PAGE_SIZE);
    },
    onSelect: (modelId: string | null) => select.mutate(modelId),
    isSaving: select.isPending,
    onTest: (modelId: string) => test.mutate(modelId),
    isTesting: test.isPending,
    testResult: test.data?.test ?? null,
  };
}

export type LlmModelController = ReturnType<typeof useLlmModelSettings>;
