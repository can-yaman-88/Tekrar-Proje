import {
  acceptedMime,
  cleanTitle,
  defaultLinkTitle,
  discardStaged,
  MAX_ATTACHMENT_BYTES,
  stageFile,
  type NewAttachment,
} from '@entities/attachment';
import * as Crypto from 'expo-crypto';
import { fileTitle, type Rejection } from '../domain/drafts';
import type { PickedFile } from './pick-files';

/** Where new material goes: a task (and so its topic), or a topic directly. */
export interface AttachmentTarget {
  topicId: string;
  taskId: string | null;
}

export interface Drafts {
  attachments: NewAttachment[];
  rejected: Rejection[];
}

/**
 * Turns picked or shared files into attachments ready for the queue: each is
 * checked, copied into the outbox under a fresh id, and named. What cannot be
 * added is reported, not thrown — the rest still go.
 */
export async function draftFiles(files: readonly PickedFile[], target: AttachmentTarget): Promise<Drafts> {
  const result: Drafts = { attachments: [], rejected: [] };
  for (const file of files) {
    const name = file.name ?? file.uri.split('/').pop() ?? 'Dosya';
    const mime = acceptedMime(file.mimeType, name);
    if (!mime) {
      result.rejected.push({ name, reason: 'unsupported' });
      continue;
    }
    if (file.sizeBytes !== null && file.sizeBytes > MAX_ATTACHMENT_BYTES) {
      result.rejected.push({ name, reason: 'too_big' });
      continue;
    }
    const id = Crypto.randomUUID();
    let staged: { uri: string; sizeBytes: number };
    try {
      staged = await stageFile(file.uri, id, mime);
    } catch {
      result.rejected.push({ name, reason: 'unreadable' });
      continue;
    }
    if (staged.sizeBytes > MAX_ATTACHMENT_BYTES) {
      discardStaged(staged.uri);
      result.rejected.push({ name, reason: 'too_big' });
      continue;
    }
    result.attachments.push({
      id,
      topicId: target.topicId,
      taskId: target.taskId,
      kind: 'file',
      title: fileTitle(file.name, mime),
      url: null,
      localUri: staged.uri,
      mimeType: mime,
      sizeBytes: staged.sizeBytes,
    });
  }
  return result;
}

/** A link with the name the student gave, else the page's, else its site's. */
export function draftLink(
  url: string,
  title: string | null,
  suggested: string | null,
  target: AttachmentTarget,
): NewAttachment {
  return {
    id: Crypto.randomUUID(),
    topicId: target.topicId,
    taskId: target.taskId,
    kind: 'link',
    title: cleanTitle(title) || cleanTitle(suggested) || defaultLinkTitle(url),
    url,
    localUri: null,
    mimeType: null,
    sizeBytes: null,
  };
}
