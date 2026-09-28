import type { LlmModel } from '@contracts/llm-models.contract';
import { profileKeys, profileRepository, useProfile } from '@entities/profile';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchLlmModels } from '../data/llm-model.api';

const MAX_VISIBLE = 40;

/**
 * Model choice lives on the profile; the key and the provider stay on the
 * server. Testing a model runs one real structured-output call through it.
 */
export function useLlmModelSettings() {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [search, setSearch] = useState('');

  const catalogue = useQuery({
    queryKey: ['llm-models'],
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

  const models = useMemo<LlmModel[]>(() => {
    const all = catalogue.data?.models ?? [];
    const term = search.trim().toLocaleLowerCase('tr');
    const filtered = term
      ? all.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase('tr').includes(term))
      : all;
    return filtered.slice(0, MAX_VISIBLE);
  }, [catalogue.data, search]);

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
    search,
    onSearch: setSearch,
    onSelect: (modelId: string | null) => select.mutate(modelId),
    isSaving: select.isPending,
    onTest: (modelId: string) => test.mutate(modelId),
    isTesting: test.isPending,
    testResult: test.data?.test ?? null,
  };
}

export type LlmModelController = ReturnType<typeof useLlmModelSettings>;
