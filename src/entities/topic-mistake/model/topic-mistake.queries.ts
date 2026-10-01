import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { topicMistakeRepository } from '../data/topic-mistake.repository';
import { normalizeMistake, type TopicMistake, type TopicMistakeWithContext } from '../domain/topic-mistake';

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

/** What each queued write carries; persisted as-is by the offline queue. */
export interface ResolveMistakeVariables {
  mistakeId: string;
  /** When the student said so — a replay hours later keeps the moment. */
  at: string;
}
export interface UpdateMistakeVariables {
  mistakeId: string;
  body: string;
  concept: string | null;
}
export interface AddMistakeVariables {
  /** Chosen on the device, so the entry is real before the server sees it. */
  id: string;
  topicId: string;
  body: string;
  concept: string | null;
}

export const topicMistakeMutationKeys = {
  resolve: ['topic-mistakes', 'resolve'] as const,
  reopen: ['topic-mistakes', 'reopen'] as const,
  remove: ['topic-mistakes', 'remove'] as const,
  update: ['topic-mistakes', 'update'] as const,
  add: ['topic-mistakes', 'add'] as const,
};

/**
 * One queue for the whole book: an entry added offline, then edited, then
 * resolved must reach the server in that order, not all at once.
 */
export const TOPIC_MISTAKE_SCOPE = { id: 'topic-mistakes' } as const;

export const runResolveMistake = ({ mistakeId, at }: ResolveMistakeVariables) =>
  topicMistakeRepository.resolve(mistakeId, at);
export const runReopenMistake = (mistakeId: string) => topicMistakeRepository.reopen(mistakeId);
export const runDeleteMistake = (mistakeId: string) => topicMistakeRepository.remove(mistakeId);
export const runUpdateMistake = ({ mistakeId, body, concept }: UpdateMistakeVariables) =>
  topicMistakeRepository.update(mistakeId, body, concept);
export const runAddMistake = ({ id, topicId, body, concept }: AddMistakeVariables) =>
  topicMistakeRepository.add(id, topicId, body, concept);

type CachedList = TopicMistake[] | TopicMistakeWithContext[];
type Snapshot = [QueryKey, CachedList | undefined][];

/** Lists that hold open entries only; a resolved one leaves them. */
function holdsOpenOnly(key: QueryKey): boolean {
  const [, kind, arg] = key;
  return kind === 'topic' || kind === 'topics' || (kind === 'book' && arg === false);
}

/** Whether a cached list is about this topic (the book is about every topic). */
function covers(key: QueryKey, topicId: string): boolean {
  const [, kind, arg] = key;
  if (kind === 'book') return true;
  if (kind === 'topic' || kind === 'topic-history') return arg === topicId;
  if (kind === 'topics') return typeof arg === 'string' && arg.split(',').includes(topicId);
  return false;
}

/**
 * Shows a write in every cached list at once, and returns what to put back if
 * the server says no. While offline this is all the student sees until the
 * queue drains — so it has to be right.
 */
function useOptimisticBook<TVariables>(
  mutationKey: readonly unknown[],
  mutationFn: (variables: TVariables) => Promise<void>,
  apply: (list: CachedList, key: QueryKey, variables: TVariables) => CachedList,
) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, TVariables, { snapshot: Snapshot }>({
    mutationKey,
    scope: TOPIC_MISTAKE_SCOPE,
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: topicMistakeKeys.all });
      const snapshot = queryClient.getQueriesData<CachedList>({ queryKey: topicMistakeKeys.all });
      for (const [key, list] of snapshot) {
        if (list) queryClient.setQueryData<CachedList>(key, apply(list, key, variables));
      }
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      for (const [key, list] of context?.snapshot ?? []) queryClient.setQueryData(key, list);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicMistakeKeys.all }),
  });
}

const mapList = (list: CachedList, fn: (entry: TopicMistake) => TopicMistake | null): CachedList =>
  (list as TopicMistake[]).flatMap((entry) => {
    const next = fn(entry);
    return next === null ? [] : [next];
  }) as CachedList;

export const useResolveMistake = () =>
  useOptimisticBook(topicMistakeMutationKeys.resolve, runResolveMistake, (list, key, { mistakeId, at }) =>
    mapList(list, (entry) =>
      entry.id !== mistakeId ? entry : holdsOpenOnly(key) ? null : { ...entry, resolvedAt: at },
    ),
  );

export const useReopenMistake = () =>
  useOptimisticBook(topicMistakeMutationKeys.reopen, runReopenMistake, (list, _key, mistakeId) =>
    // An open-only list missing it gets it back on the refetch that follows.
    mapList(list, (entry) => (entry.id === mistakeId ? { ...entry, resolvedAt: null } : entry)),
  );

export const useDeleteMistake = () =>
  useOptimisticBook(topicMistakeMutationKeys.remove, runDeleteMistake, (list, _key, mistakeId) =>
    mapList(list, (entry) => (entry.id === mistakeId ? null : entry)),
  );

export const useUpdateMistake = () =>
  useOptimisticBook(topicMistakeMutationKeys.update, runUpdateMistake, (list, _key, { mistakeId, body, concept }) => {
    const clean = normalizeMistake(body, concept);
    if (!clean) return list;
    return mapList(list, (entry) => (entry.id === mistakeId ? { ...entry, ...clean } : entry));
  });

export const useAddMistake = () =>
  useOptimisticBook(topicMistakeMutationKeys.add, runAddMistake, (list, key, { id, topicId, body, concept }) => {
    const clean = normalizeMistake(body, concept);
    if (!clean || !covers(key, topicId)) return list;
    const entry: TopicMistake = {
      id,
      topicId,
      body: clean.body,
      concept: clean.concept,
      taskId: null,
      fromCheckin: false,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    if (key[1] !== 'book') return [entry, ...(list as TopicMistake[])];
    // The book files entries under course and topic names; borrow them from a
    // sibling entry, or let the refetch bring it in.
    const sibling = (list as TopicMistakeWithContext[]).find((other) => other.topicId === topicId);
    if (!sibling) return list;
    const filed: TopicMistakeWithContext = {
      ...entry,
      topicTitle: sibling.topicTitle,
      topicWeek: sibling.topicWeek,
      topicPosition: sibling.topicPosition,
      courseLabel: sibling.courseLabel,
      taskTitle: null,
    };
    return [filed, ...(list as TopicMistakeWithContext[])];
  });
