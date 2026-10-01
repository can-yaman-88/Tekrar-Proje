import { defaultLinkTitle, useAddAttachment } from '@entities/attachment';
import { isOpen, taskKeys, taskRepository, type Task } from '@entities/task';
import { draftFiles, draftLink, fetchPageTitle, rejectionMessage } from '@features/attachments';
import { addDays, formatRelativeDay, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIncomingShare } from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeIncoming, readIncoming } from './incoming';

export interface TaskChoice {
  id: string;
  title: string;
  subtitle: string;
  isOverdue: boolean;
}

const LOOK_BACK_DAYS = 14;
const LOOK_AHEAD_DAYS = 28;
const MAX_CHOICES = 60;

const fold = (text: string) => text.toLocaleLowerCase('tr-TR');

/**
 * "Paylaş → Tekrar": a link, PDF or photo sent from another app is added to a
 * task the student picks — the open work of the past two weeks and the next
 * four, most pressing first.
 */
export function useShareTargetScreen() {
  const share = useIncomingShare();
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = useToday();
  const from = addDays(today, -LOOK_BACK_DAYS);
  const to = addDays(today, LOOK_AHEAD_DAYS);
  const tasks = useQuery({
    queryKey: [...taskKeys.all, 'share-target', from, to],
    queryFn: () => taskRepository.listBetween(from, to),
  });
  const [search, setSearch] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [titles, setTitles] = useState<Record<string, string | null>>({});

  const incoming = useMemo(
    () => readIncoming(share.sharedPayloads, share.resolvedSharedPayloads),
    [share.sharedPayloads, share.resolvedSharedPayloads],
  );
  const count = incoming.links.length + incoming.files.length;

  // Names for the links, read from the pages while the student picks a task.
  useEffect(() => {
    if (!onlineManager.isOnline()) return;
    let cancelled = false;
    for (const url of incoming.links) {
      void fetchPageTitle(url).then((title) => {
        if (!cancelled) setTitles((current) => (url in current ? current : { ...current, [url]: title }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [incoming.links]);

  const refreshCards = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  }, [queryClient]);
  const { mutate: addMutate } = useAddAttachment({
    onError: (error) => showToast(describeError(error).message, 'danger'),
    onSettled: refreshCards,
  });

  const choices: TaskChoice[] = useMemo(() => {
    const query = fold(search.trim());
    return (tasks.data ?? [])
      .filter((task) => isOpen(task) && task.parentTaskId === null)
      .filter((task) =>
        query === ''
          ? true
          : [task.title, task.topic.title, task.course.name, task.course.code ?? ''].some((text) =>
              fold(text).includes(query),
            ),
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, MAX_CHOICES)
      .map((task) => ({
        id: task.id,
        title: task.title,
        subtitle: `${task.course.code ?? task.course.name} · ${task.topic.title} · ${formatRelativeDay(task.dueDate, today)}`,
        isOverdue: task.dueDate < today,
      }));
  }, [tasks.data, search, today]);

  const leave = useCallback(() => {
    share.clearSharedPayloads();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router, share]);

  const onPick = useCallback(
    async (taskId: string) => {
      const task: Task | undefined = tasks.data?.find((candidate) => candidate.id === taskId);
      if (!task || isSaving) return;
      setSaving(true);
      try {
        const target = { topicId: task.topic.id, taskId: task.id };
        const links = incoming.links.map((url) => draftLink(url, null, titles[url] ?? null, target));
        const drafts = await draftFiles(incoming.files, target);
        for (const attachment of [...links, ...drafts.attachments]) addMutate(attachment);
        const added = links.length + drafts.attachments.length;
        const rejected = rejectionMessage(drafts.rejected);
        if (rejected) showToast(rejected, 'danger');
        else if (added > 0) {
          showToast(
            onlineManager.isOnline()
              ? `${added} ek "${task.title}" görevine eklendi.`
              : `${added} ek eklendi; bağlantı gelince yüklenecek.`,
            'success',
          );
        }
        share.clearSharedPayloads();
        router.replace(`/task/${task.id}`);
      } catch (error) {
        showToast(describeError(error).message, 'danger');
      } finally {
        setSaving(false);
      }
    },
    [addMutate, incoming, isSaving, router, share, tasks.data, titles],
  );

  const waitingForFiles = share.isResolving && incoming.files.length === 0;

  return {
    isLoading: waitingForFiles || (tasks.isPending && tasks.data === undefined),
    isEmpty: !waitingForFiles && count === 0,
    emptyMessage:
      incoming.unsupported > 0
        ? 'Bu paylaşım eklenemiyor: yalnızca link, PDF ve fotoğraf (JPEG, PNG, WebP) eklenebilir.'
        : incoming.hasTextWithoutLink
          ? 'Paylaşılan metinde bir link yok. Bir sayfayı, PDF’i ya da fotoğrafı paylaşabilirsin.'
          : 'Paylaşılan bir şey bulunamadı.',
    summary: describeIncoming(incoming),
    items: [
      ...incoming.links.map((url) => ({
        key: url,
        icon: 'link-outline' as const,
        label: titles[url] ?? defaultLinkTitle(url),
      })),
      ...incoming.files.map((file) => ({
        key: file.uri,
        icon: (file.mimeType ?? '').startsWith('image/')
          ? ('image-outline' as const)
          : ('document-text-outline' as const),
        label: file.name ?? 'Dosya',
      })),
    ],
    skipped: incoming.unsupported,
    tasksError: tasks.isError && tasks.data === undefined ? describeError(tasks.error).message : null,
    retryTasks: () => void tasks.refetch(),
    search,
    onSearch: setSearch,
    choices,
    isSaving,
    onPick: (taskId: string) => void onPick(taskId),
    onCancel: leave,
  };
}

export type ShareTargetController = ReturnType<typeof useShareTargetScreen>;
