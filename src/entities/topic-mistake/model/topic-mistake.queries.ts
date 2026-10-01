import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { topicMistakeRepository } from '../data/topic-mistake.repository';

export const topicMistakeKeys = {
  all: ['topic-mistakes'] as const,
  book: (includeResolved: boolean) => ['topic-mistakes', 'book', includeResolved] as const,
  forTopic: (topicId: string) => ['topic-mistakes', 'topic', topicId] as const,
  topicHistory: (topicId: string) => ['topic-mistakes', 'topic-history', topicId] as const,
  forTopics: (topicIds: readonly string[]) => ['topic-mistakes', 'topics', [...topicIds].sort().join(',')] as const,
};

/** Every entry, for the notebook tab. */
export function useMistakeBook(includeResolved: boolean) {
  return useQuery({
    queryKey: topicMistakeKeys.book(includeResolved),
    queryFn: () => topicMistakeRepository.listAll(includeResolved),
  });
}

/** Open entries of one topic: what to read before meeting it again. */
export function useTopicMistakes(topicId: string | null) {
  return useQuery({
    queryKey: topicMistakeKeys.forTopic(topicId ?? 'none'),
    queryFn: () => topicMistakeRepository.listForTopic(topicId ?? ''),
    enabled: topicId !== null,
  });
}

/** Open and resolved entries of one topic, for the topic's own screen. */
export function useTopicMistakeHistory(topicId: string) {
  return useQuery({
    queryKey: topicMistakeKeys.topicHistory(topicId),
    queryFn: () => topicMistakeRepository.listForTopic(topicId, true),
  });
}

export function useTopicMistakesFor(topicIds: readonly string[]) {
  return useQuery({
    queryKey: topicMistakeKeys.forTopics(topicIds),
    queryFn: () => topicMistakeRepository.listForTopics(topicIds),
    enabled: topicIds.length > 0,
  });
}

function useBookMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicMistakeKeys.all }),
  });
}

export const useResolveMistake = () => useBookMutation((mistakeId: string) => topicMistakeRepository.resolve(mistakeId));

export const useReopenMistake = () => useBookMutation((mistakeId: string) => topicMistakeRepository.reopen(mistakeId));

export const useDeleteMistake = () => useBookMutation((mistakeId: string) => topicMistakeRepository.remove(mistakeId));

export const useUpdateMistake = () =>
  useBookMutation(({ mistakeId, body, concept }: { mistakeId: string; body: string; concept: string | null }) =>
    topicMistakeRepository.update(mistakeId, body, concept),
  );

export const useAddMistake = () =>
  useBookMutation(({ topicId, body, concept }: { topicId: string; body: string; concept: string | null }) =>
    topicMistakeRepository.add(topicId, body, concept),
  );
