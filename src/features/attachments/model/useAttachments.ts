import {
  ATTACHMENT_BUCKET,
  isImage,
  localCopyOf,
  acceptedMime,
  normalizeUrl,
  sectionsOf,
  useAddAttachment,
  useAttachmentPreviews,
  useRemoveAttachment,
  useRenameAttachment,
  useTaskMaterials,
  useTopicMaterials,
  type Attachment,
  type NewAttachment,
} from '@entities/attachment';
import { taskKeys } from '@entities/task';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { fetchPageTitle } from '../data/page-title.api';
import { rejectionMessage } from '../domain/drafts';
import { draftFiles, draftLink, type AttachmentTarget } from './attachment-drafts';
import { openAttachment, shareAttachment, viewInOtherApp } from './open-attachment';
import { pickImages, pickPdfs, takePhoto, type PickedFile } from './pick-files';

export interface AttachmentListSection {
  key: string;
  /** Null on a topic's screen, where everything is the topic's. */
  title: string | null;
  items: Attachment[];
}

export interface AttachmentAction {
  key: 'open' | 'share' | 'rename' | 'delete';
  label: string;
  destructive?: boolean;
}

/** The link form: the address, an optional name, and the page's own name as a hint. */
function useLinkDraft(isOpen: boolean) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  // The page's name, remembered with the address it belongs to: a name found
  // for what was typed a moment ago is not offered for what is typed now.
  const [found, setFound] = useState<{ url: string; title: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizeUrl(url);
  const suggestion = found && found.url === normalized ? found.title : null;

  useEffect(() => {
    if (!isOpen || !normalized || !onlineManager.isOnline()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchPageTitle(normalized).then((title) => {
        if (!cancelled) setFound({ url: normalized, title });
      });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, normalized]);

  return {
    url,
    title,
    suggestion,
    error,
    normalized,
    onUrl: (next: string) => {
      setUrl(next);
      setError(null);
    },
    onTitle: setTitle,
    setError,
    reset: () => {
      setUrl('');
      setTitle('');
      setFound(null);
      setError(null);
    },
  };
}

/** The rename form: a new name, and for a link its address. */
function useRenameDraft() {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  return {
    attachment,
    title,
    url,
    error,
    begin: (target: Attachment) => {
      setAttachment(target);
      setTitle(target.title);
      setUrl(target.url ?? '');
      setError(null);
    },
    end: () => setAttachment(null),
    onTitle: setTitle,
    onUrl: (next: string) => {
      setUrl(next);
      setError(null);
    },
    setError,
  };
}

/**
 * Everything the "Ekler" section does, for a task (its own material, its
 * group's, its topic's) or for a topic (all of it). Writes go through the
 * offline queue: an add is visible at once and uploads when it can.
 */
export function useAttachments(target: AttachmentTarget) {
  const { topicId, taskId } = target;
  const queryClient = useQueryClient();
  const onTaskScreen = taskId !== null;
  const taskQuery = useTaskMaterials(taskId);
  const topicQuery = useTopicMaterials(onTaskScreen ? null : topicId);
  const query = onTaskScreen ? taskQuery : topicQuery;
  const list = useMemo(() => query.data ?? [], [query.data]);
  const previews = useAttachmentPreviews(list);

  // A task's card shows how many attachments it has.
  const refreshCards = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  }, [queryClient]);
  const reportError = useCallback((error: unknown) => showToast(describeError(error).message, 'danger'), []);
  const { mutate: addMutate } = useAddAttachment({ onError: reportError, onSettled: refreshCards });
  const { mutate: renameMutate } = useRenameAttachment({ onError: reportError });
  const { mutate: removeMutate } = useRemoveAttachment({ onError: reportError, onSettled: refreshCards });

  const [isAdding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ uri: string; attachment: Attachment } | null>(null);
  const [actionsFor, setActionsFor] = useState<Attachment | null>(null);
  const [isLinkOpen, setLinkOpen] = useState(false);
  const link = useLinkDraft(isLinkOpen);
  const renameDraft = useRenameDraft();

  const enqueue = useCallback(
    (attachments: readonly NewAttachment[]) => {
      for (const attachment of attachments) addMutate(attachment);
      if (attachments.length > 0 && !onlineManager.isOnline()) {
        showToast('Çevrimdışısın; ekler bağlantı gelince yüklenecek.', 'info');
      }
    },
    [addMutate],
  );

  const addFrom = useCallback(
    async (pick: () => Promise<PickedFile[]>) => {
      setAdding(true);
      try {
        const files = await pick();
        if (files.length === 0) return;
        const drafts = await draftFiles(files, target);
        enqueue(drafts.attachments);
        const rejected = rejectionMessage(drafts.rejected);
        if (rejected) showToast(rejected, 'danger');
      } catch (error) {
        showToast(describeError(error).message, 'danger');
      } finally {
        setAdding(false);
      }
    },
    [enqueue, target],
  );

  const onOpen = useCallback(async (attachment: Attachment) => {
    setBusyId(attachment.id);
    try {
      const outcome = await openAttachment(attachment);
      if (outcome.kind === 'image') setViewer({ uri: outcome.uri, attachment });
    } catch (error) {
      showToast(describeError(error).message, 'danger');
    } finally {
      setBusyId(null);
    }
  }, []);

  const onShare = useCallback(async (attachment: Attachment) => {
    setBusyId(attachment.id);
    try {
      await shareAttachment(attachment);
    } catch (error) {
      showToast(describeError(error).message, 'danger');
    } finally {
      setBusyId(null);
    }
  }, []);

  const confirmDelete = useCallback(
    (attachment: Attachment) => {
      const elsewhere =
        onTaskScreen && attachment.relation !== 'task'
          ? ' Bu ek konunun diğer görevlerinde de görünüyor; hepsinden kalkar.'
          : '';
      const where = attachment.kind === 'file' ? ' Dosya sunucudan da silinir.' : '';
      Alert.alert('Eki sil', `"${attachment.title}" silinsin mi?${where}${elsewhere}`, [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sil', style: 'destructive', onPress: () => removeMutate(attachment.id) },
      ]);
    },
    [onTaskScreen, removeMutate],
  );

  // Thumbnails: the phone's own copy if there is one, else a signed address.
  const previewOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const attachment of list) {
      if (!isImage(attachment)) continue;
      const mime = acceptedMime(attachment.mimeType);
      const local = mime ? safeLocalCopy(attachment, mime) : null;
      const remote =
        attachment.bucket === ATTACHMENT_BUCKET && attachment.storagePath
          ? previews.data?.[attachment.storagePath]
          : undefined;
      const uri = local ?? remote;
      if (uri) map.set(attachment.id, uri);
    }
    return map;
  }, [list, previews.data]);

  const sections: AttachmentListSection[] = onTaskScreen
    ? sectionsOf(list).map((section) => ({ key: section.relation, title: section.title, items: section.items }))
    : list.length > 0
      ? [{ key: 'topic', title: null, items: list }]
      : [];

  const actionsOf = (attachment: Attachment): AttachmentAction[] => [
    { key: 'open', label: attachment.kind === 'link' ? 'Linki aç' : 'Aç' },
    { key: 'share', label: 'Paylaş' },
    ...(attachment.editable
      ? ([
          { key: 'rename', label: attachment.kind === 'link' ? 'Adını ya da adresini düzenle' : 'Yeniden adlandır' },
          { key: 'delete', label: 'Sil', destructive: true },
        ] satisfies AttachmentAction[])
      : []),
  ];

  return {
    isLoading: query.data === undefined && query.fetchStatus === 'fetching',
    // Offline with nothing saved: the list comes when the connection does;
    // adding works meanwhile.
    isOffline: query.data === undefined && query.fetchStatus === 'paused',
    error: query.isError && query.data === undefined ? describeError(query.error).message : null,
    retry: () => void query.refetch(),
    count: list.length,
    sections,
    showsTaskOf: (attachment: Attachment) => !onTaskScreen || attachment.relation === 'topic',
    previewOf: (attachment: Attachment) => previewOf.get(attachment.id) ?? null,
    busyId,
    isAdding,
    onTaskScreen,

    addPdf: () => void addFrom(pickPdfs),
    addPhotos: () => void addFrom(pickImages),
    takePhoto: () => void addFrom(takePhoto),
    openLink: () => {
      link.reset();
      setLinkOpen(true);
    },

    onOpen: (attachment: Attachment) => void onOpen(attachment),
    onMore: setActionsFor,

    actions: {
      attachment: actionsFor,
      items: actionsFor ? actionsOf(actionsFor) : [],
      onDismiss: () => setActionsFor(null),
      onSelect: (key: AttachmentAction['key']) => {
        const attachment = actionsFor;
        setActionsFor(null);
        if (!attachment) return;
        if (key === 'open') void onOpen(attachment);
        if (key === 'share') void onShare(attachment);
        if (key === 'rename') renameDraft.begin(attachment);
        if (key === 'delete') confirmDelete(attachment);
      },
    },

    link: {
      visible: isLinkOpen,
      url: link.url,
      title: link.title,
      titlePlaceholder: link.suggestion ?? 'Boş bırakırsan sayfanın adı kullanılır',
      error: link.error,
      canSave: link.url.trim().length > 0,
      onUrl: link.onUrl,
      onTitle: link.onTitle,
      onDismiss: () => setLinkOpen(false),
      onSave: () => {
        if (!link.normalized) {
          link.setError('Geçerli bir web adresi yaz; örneğin https://www.youtube.com/…');
          return;
        }
        enqueue([draftLink(link.normalized, link.title, link.suggestion, target)]);
        setLinkOpen(false);
        link.reset();
      },
    },

    rename: {
      visible: renameDraft.attachment !== null,
      isLink: renameDraft.attachment?.kind === 'link',
      title: renameDraft.title,
      url: renameDraft.url,
      error: renameDraft.error,
      onTitle: renameDraft.onTitle,
      onUrl: renameDraft.onUrl,
      onDismiss: renameDraft.end,
      onSave: () => {
        const attachment = renameDraft.attachment;
        if (!attachment) return;
        if (renameDraft.title.trim().length === 0) {
          renameDraft.setError('Bir ad yaz.');
          return;
        }
        let url: string | null = null;
        if (attachment.kind === 'link') {
          url = normalizeUrl(renameDraft.url);
          if (!url) {
            renameDraft.setError('Geçerli bir web adresi yaz.');
            return;
          }
        }
        renameMutate({ attachmentId: attachment.id, title: renameDraft.title, url });
        renameDraft.end();
      },
    },

    viewer: {
      visible: viewer !== null,
      uri: viewer?.uri ?? null,
      title: viewer?.attachment.title ?? '',
      onDismiss: () => setViewer(null),
      onShare: () => {
        if (viewer) void onShare(viewer.attachment);
      },
      // Android's own photo viewer zooms; the in-app one only fits the picture.
      canOpenElsewhere: Platform.OS === 'android',
      onOpenElsewhere: () => {
        if (viewer) void viewInOtherApp(viewer.attachment).catch(reportError);
      },
    },
  };
}

function safeLocalCopy(attachment: Attachment, mime: NonNullable<ReturnType<typeof acceptedMime>>): string | null {
  try {
    return localCopyOf(attachment.id, mime, attachment.localUri)?.uri ?? null;
  } catch {
    return null;
  }
}

export type AttachmentsController = ReturnType<typeof useAttachments>;
