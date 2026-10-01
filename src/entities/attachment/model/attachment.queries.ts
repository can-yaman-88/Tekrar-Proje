import { toAppError } from '@shared/lib/errors';
import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adoptIntoCache, discardStaged } from '../data/attachment-files';
import { attachmentRepository } from '../data/attachment.repository';
import {
  ATTACHMENT_BUCKET,
  cleanTitle,
  isImage,
  type Attachment,
  type AttachmentRelation,
  type NewAttachment,
} from '../domain/attachment';

export const attachmentKeys = {
  all: ['attachments'] as const,
  task: (taskId: string) => ['attachments', 'task', taskId] as const,
  topic: (topicId: string) => ['attachments', 'topic', topicId] as const,
  previews: (paths: readonly string[]) => ['attachments', 'previews', [...paths].sort().join(',')] as const,
};

export const attachmentMutationKeys = {
  add: ['attachments', 'add'] as const,
  rename: ['attachments', 'rename'] as const,
  remove: ['attachments', 'remove'] as const,
};

/**
 * One queue for every attachment write: a file added offline, then renamed,
 * then deleted reaches the server in that order.
 */
export const ATTACHMENT_SCOPE = { id: 'attachments' } as const;

export interface RenameAttachmentVariables {
  attachmentId: string;
  title: string;
  /** A link's corrected address; null leaves it (and every file) as it is. */
  url: string | null;
}

/** Uploads waiting on the phone survive a dropped connection: try again, then again. */
export const attachmentRetry = (failureCount: number, error: unknown): boolean => {
  const kind = toAppError(error).kind;
  return (kind === 'network' || kind === 'server') && failureCount < 4;
};

/**
 * The queued add. A file that the server will never take (too big, wrong
 * type, the folder full) is let go of on the phone too; a network failure
 * keeps it for the next try.
 */
export async function runAddAttachment(attachment: NewAttachment): Promise<void> {
  try {
    await attachmentRepository.add(attachment);
  } catch (error) {
    if (!toAppError(error).retryable) discardStaged(attachment.localUri);
    throw error;
  }
  if (attachment.localUri && attachment.mimeType) {
    adoptIntoCache(attachment.localUri, attachment.id, attachment.mimeType);
  }
}

export const runRenameAttachment = ({ attachmentId, title, url }: RenameAttachmentVariables) =>
  attachmentRepository.rename(attachmentId, cleanTitle(title), url);

export const runRemoveAttachment = (attachmentId: string) => attachmentRepository.remove(attachmentId);

export function useTaskMaterials(taskId: string | null) {
  return useQuery({
    queryKey: attachmentKeys.task(taskId ?? 'none'),
    queryFn: () => attachmentRepository.listForTask(taskId ?? ''),
    enabled: taskId !== null,
  });
}

export function useTopicMaterials(topicId: string | null) {
  return useQuery({
    queryKey: attachmentKeys.topic(topicId ?? 'none'),
    queryFn: () => attachmentRepository.listForTopic(topicId ?? ''),
    enabled: topicId !== null,
  });
}

/**
 * Short-lived addresses for the pictures in a list, for thumbnails. Never
 * persisted: they expire within the hour.
 */
export function useAttachmentPreviews(attachments: readonly Attachment[]) {
  const paths = attachments
    .filter((attachment) => isImage(attachment) && attachment.bucket === ATTACHMENT_BUCKET && attachment.storagePath)
    .map((attachment) => attachment.storagePath as string);
  return useQuery({
    queryKey: attachmentKeys.previews(paths),
    queryFn: () => attachmentRepository.signedUrls(ATTACHMENT_BUCKET, paths),
    enabled: paths.length > 0,
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    meta: { persist: false },
  });
}

type Snapshot = [QueryKey, Attachment[] | undefined][];

/** Which cached list an attachment shows up in, and as what. */
function relationIn(key: QueryKey, attachment: NewAttachment): AttachmentRelation | null {
  const [, kind, id] = key;
  if (kind === 'task') return id === attachment.taskId ? 'task' : null;
  if (kind === 'topic') return id === attachment.topicId ? (attachment.taskId ? 'task' : 'topic') : null;
  return null;
}

const isList = (key: QueryKey) => key[1] === 'task' || key[1] === 'topic';

/**
 * Shows a write in every cached list at once and puts the lists back if the
 * server says no. While offline this is what the student sees.
 */
/** Called once per write, however many are sent at once (unlike mutate's own callbacks). */
export interface AttachmentWriteCallbacks<TVariables> {
  onError?: (error: Error, variables: TVariables) => void;
  onSettled?: () => void;
}

function useOptimisticAttachments<TVariables>(
  mutationKey: readonly unknown[],
  mutationFn: (variables: TVariables) => Promise<void>,
  apply: (list: Attachment[] | undefined, key: QueryKey, variables: TVariables) => Attachment[] | undefined,
  callbacks: AttachmentWriteCallbacks<TVariables> = {},
) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, TVariables, { snapshot: Snapshot }>({
    mutationKey,
    scope: ATTACHMENT_SCOPE,
    mutationFn,
    retry: attachmentRetry,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: attachmentKeys.all });
      const snapshot = queryClient
        .getQueriesData<Attachment[]>({ queryKey: attachmentKeys.all })
        .filter(([key]) => isList(key));
      for (const [key, list] of snapshot) {
        const next = apply(list, key, variables);
        if (next !== undefined && next !== list) queryClient.setQueryData<Attachment[]>(key, next);
      }
      return { snapshot };
    },
    onError: (error, variables, context) => {
      for (const [key, list] of context?.snapshot ?? []) queryClient.setQueryData(key, list);
      callbacks.onError?.(error, variables);
    },
    onSettled: () => {
      callbacks.onSettled?.();
      return queryClient.invalidateQueries({ queryKey: attachmentKeys.all });
    },
  });
}

export const useAddAttachment = (callbacks?: AttachmentWriteCallbacks<NewAttachment>) =>
  useOptimisticAttachments(
    attachmentMutationKeys.add,
    runAddAttachment,
    (list, key, attachment) => {
      const relation = relationIn(key, attachment);
      if (relation === null || list?.some((item) => item.id === attachment.id)) return list;
      const shown: Attachment = {
        id: attachment.id,
        kind: attachment.kind,
        title: attachment.title,
        url: attachment.url,
        bucket: attachment.kind === 'file' ? ATTACHMENT_BUCKET : null,
        storagePath: null,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: new Date().toISOString(),
        relation,
        taskId: attachment.taskId,
        taskTitle: null,
        editable: true,
        isPending: true,
        localUri: attachment.localUri,
      };
      // A list never loaded (offline from the start) still shows what was just added.
      return [shown, ...(list ?? [])];
    },
    callbacks,
  );

export const useRenameAttachment = (callbacks?: AttachmentWriteCallbacks<RenameAttachmentVariables>) =>
  useOptimisticAttachments(
    attachmentMutationKeys.rename,
    runRenameAttachment,
    (list, _key, { attachmentId, title, url }) =>
      list?.map((item) =>
        item.id === attachmentId ? { ...item, title: cleanTitle(title) || item.title, url: url ?? item.url } : item,
      ),
    callbacks,
  );

export const useRemoveAttachment = (callbacks?: AttachmentWriteCallbacks<string>) =>
  useOptimisticAttachments(
    attachmentMutationKeys.remove,
    runRemoveAttachment,
    (list, _key, attachmentId) => list?.filter((item) => item.id !== attachmentId),
    callbacks,
  );
