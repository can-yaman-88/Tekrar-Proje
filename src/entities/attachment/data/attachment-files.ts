import { Directory, File, Paths } from 'expo-file-system';
import { extensionFor, type AttachmentMime } from '../domain/attachment';

/**
 * Two folders on the phone:
 *   outbox  files added here and not uploaded yet (documents: survives a
 *           restart, so an offline add is never lost);
 *   cache   copies of files already on the server, for opening without a
 *           download (cache: the system may clear it; it is fetched again).
 */
const OUTBOX = 'attachment-outbox';
const CACHE = 'attachments';

function folder(parent: Directory, name: string): Directory {
  const directory = new Directory(parent, name);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

const fileName = (id: string, mime: AttachmentMime) => `${id}.${extensionFor(mime)}`;

/**
 * The outbox file a queued upload names. The queue stores a full path, and on
 * iOS an app update moves the app's folders: the name still finds it.
 */
function staged(localUri: string): File {
  const direct = new File(localUri);
  if (direct.exists) return direct;
  return new File(Paths.document, OUTBOX, localUri.split('/').pop() ?? '');
}

/** Copies a picked or shared file into the outbox under the attachment's id. */
export async function stageFile(
  sourceUri: string,
  id: string,
  mime: AttachmentMime,
): Promise<{ uri: string; sizeBytes: number }> {
  const target = new File(folder(Paths.document, OUTBOX), fileName(id, mime));
  if (target.exists) target.delete();
  await new File(sourceUri).copy(target);
  return { uri: target.uri, sizeBytes: target.size };
}

export async function readFileBytes(uri: string): Promise<ArrayBuffer> {
  return staged(uri).arrayBuffer();
}

/** Once uploaded, the outbox copy becomes the cached one: the first open is instant. */
export function adoptIntoCache(localUri: string, id: string, mime: AttachmentMime): void {
  try {
    const file = staged(localUri);
    if (!file.exists) return;
    const target = new File(folder(Paths.cache, CACHE), fileName(id, mime));
    if (target.exists) target.delete();
    file.moveSync(target);
  } catch {
    // Only a convenience: the file is on the server either way.
  }
}

export function discardStaged(localUri: string | null): void {
  if (!localUri) return;
  try {
    const file = staged(localUri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to keep.
  }
}

/** A local copy to open: the cached one, or the outbox file still waiting. */
export function localCopyOf(id: string, mime: AttachmentMime, localUri: string | null = null): File | null {
  if (localUri) {
    const file = staged(localUri);
    if (file.exists) return file;
  }
  const cached = new File(Paths.cache, CACHE, fileName(id, mime));
  return cached.exists ? cached : null;
}

export async function downloadToCache(url: string, id: string, mime: AttachmentMime): Promise<File> {
  const target = new File(folder(Paths.cache, CACHE), fileName(id, mime));
  if (target.exists) target.delete();
  return File.downloadFileAsync(url, target, { idempotent: true });
}

/**
 * Outbox files no queued upload refers to any more — the upload failed for
 * good, or the queue was cleared — are deleted. Run after the queue is restored.
 */
export function sweepOutbox(keepIds: ReadonlySet<string>): void {
  try {
    const outbox = new Directory(Paths.document, OUTBOX);
    if (!outbox.exists) return;
    for (const entry of outbox.list()) {
      const id = entry.name.split('.')[0] ?? '';
      if (entry instanceof File && !keepIds.has(id)) entry.delete();
    }
  } catch {
    // Tidying only.
  }
}

/** Signing out leaves nothing of this student's files on the phone. */
export function clearAttachmentFiles(): void {
  for (const directory of [new Directory(Paths.document, OUTBOX), new Directory(Paths.cache, CACHE)]) {
    try {
      if (directory.exists) directory.delete();
    } catch {
      // Best effort.
    }
  }
}
