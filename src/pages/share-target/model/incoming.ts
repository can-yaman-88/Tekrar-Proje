import { acceptedMime, firstUrlIn, normalizeUrl } from '@entities/attachment';
import type { PickedFile } from '@features/attachments';

/** What another app handed over, as expo-sharing reports it (only the fields used here). */
export interface IncomingPayload {
  value: string;
  shareType: string;
  mimeType?: string;
}

export interface ResolvedIncomingPayload extends IncomingPayload {
  contentUri: string | null;
  contentType?: string | null;
  contentMimeType: string | null;
  originalName: string | null;
  contentSize: number | null;
}

export interface IncomingShare {
  links: string[];
  files: PickedFile[];
  /** Videos, audio, documents of other kinds: named in the message, not added. */
  unsupported: number;
  /** Text that held no address: "Paylaşılan metinde link yok". */
  hasTextWithoutLink: boolean;
}

const FILE_TYPES = new Set(['image', 'file', 'video', 'audio']);

/**
 * Sorts a share into what can become attachments. Text and URLs are read
 * from the raw payloads (no network needed); files from the resolved ones,
 * which expo-sharing has already copied into the app's cache.
 */
export function readIncoming(
  raw: readonly IncomingPayload[],
  resolved: readonly ResolvedIncomingPayload[],
): IncomingShare {
  const links: string[] = [];
  let hasTextWithoutLink = false;
  for (const payload of raw) {
    if (payload.shareType !== 'text' && payload.shareType !== 'url') continue;
    const url = payload.shareType === 'url' ? normalizeUrl(payload.value) : firstUrlIn(payload.value);
    if (url) {
      if (!links.includes(url)) links.push(url);
    } else if (payload.value.trim().length > 0) {
      hasTextWithoutLink = true;
    }
  }

  const files: PickedFile[] = [];
  let unsupported = 0;
  for (const payload of resolved) {
    if (!FILE_TYPES.has(payload.shareType) || !payload.contentUri) continue;
    const mimeType = payload.contentMimeType ?? payload.mimeType ?? null;
    if (!acceptedMime(mimeType, payload.originalName ?? payload.contentUri)) {
      unsupported += 1;
      continue;
    }
    files.push({
      uri: payload.contentUri,
      name: payload.originalName,
      mimeType,
      sizeBytes: payload.contentSize,
    });
  }

  return { links, files, unsupported, hasTextWithoutLink };
}

/** "1 link · 2 fotoğraf · 1 PDF". */
export function describeIncoming(share: IncomingShare): string {
  const pdfs = share.files.filter((file) => acceptedMime(file.mimeType, file.name ?? file.uri) === 'application/pdf');
  const photos = share.files.length - pdfs.length;
  const parts = [
    share.links.length > 0 ? `${share.links.length} link` : null,
    photos > 0 ? `${photos} fotoğraf` : null,
    pdfs.length > 0 ? `${pdfs.length} PDF` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(' · ');
}
