import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { topicMistakeRepository } from '../data/topic-mistake.repository';

export const topicMistakeKeys = {
  all: ['topic-mistakes'] as const,
  book: (includeResolved: boolean) => ['topic-mistakes', 'book', includeResolved] as const,
  forTopic: (topicId: string) => ['topic-mistakes', 'topic', topicId] as const,
  forTopics: (topicIds: readonly string[]) => ['topic-mistakes', 'topics', [...topicIds].sort().join(',')] as const,
};

/** Every entry, for the notebook tab. */
export function useMistakeBook(includeResolved: boolean) {
  return useQuery({
    queryKey: topicMistakeKeys.book(includeResolved),
    queryFn: () => topicMistakeRepository.listAll(includeResolved),
  });
}

export function useTopicMistakes(topicId: string | null) {
  return useQuery({
    queryKey: topicMistakeKeys.forTopic(topicId ?? 'none'),
    queryFn: () => topicMistakeRepository.listForTopic(topicId ?? ''),
    enabled: topicId !== null,
  });
}

export function useTopicMistakesFor(topicIds: readonly string[]) {
  return useQuery({
    queryKey: topicMistakeKeys.forTopics(topicIds),
    queryFn: () => topicMistakeRepository.listForTopics(topicIds),
    enabled: topicIds.length > 0,
  });
}

export function useResolveMistake() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (mistakeId: string) => topicMistakeRepository.resolve(mistakeId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicMistakeKeys.all }),
  });
}

export function useAddMistake(topicId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (body: string) => topicMistakeRepository.add(topicId, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicMistakeKeys.all }),
  });
}
