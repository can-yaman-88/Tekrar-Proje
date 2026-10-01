import type { AttachmentMime } from '@contracts/enums.contract';

export type { AttachmentMime };
export type AttachmentKind = 'file' | 'link';

/**
 * Where an item comes from, seen from the screen listing it:
 *   task    added to this very task;
 *   group   added to its learning task, a step or a sibling step;
 *   source  the check-in file the task was read out of (read-only);
 *   topic   anything else on the same topic.
 */
export type AttachmentRelation = 'task' | 'group' | 'source' | 'topic';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  title: string;
  url: string | null;
  /** Storage bucket of a file; null for links. */
  bucket: string | null;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  relation: AttachmentRelation;
  /** The task it was added to, if that task still exists. */
  taskId: string | null;
  taskTitle: string | null;
  /** Source files belong to a check-in and are not renamed or deleted from here. */
  editable: boolean;
  /** Added on this phone and not on the server yet (offline, or uploading). */
  isPending: boolean;
  /** The phone's own copy of a pending file: opened from here meanwhile. */
  localUri: string | null;
}

/** What the phone knows about an attachment before the server does. */
export interface NewAttachment {
  /** Chosen on the device, so an offline add is the same row when it lands. */
  id: string;
  topicId: string;
  taskId: string | null;
  kind: AttachmentKind;
  title: string;
  url: string | null;
  /** A file waiting in the outbox (see attachment-files). */
  localUri: string | null;
  mimeType: AttachmentMime | null;
  sizeBytes: number | null;
}

export const ATTACHMENT_BUCKET = 'attachments';
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_QUOTA_BYTES = 300 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;

const MIME_BY_EXTENSION: Record<string, AttachmentMime> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const EXTENSION_BY_MIME: Record<AttachmentMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The file types an attachment may be, from whatever a picker or another app
 * reported: a MIME type, a file name, or both. Null for anything else.
 */
export function acceptedMime(mimeType: string | null | undefined, filename?: string | null): AttachmentMime | null {
  const mime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'image/jpg' || mime === 'image/pjpeg') return 'image/jpeg';
  if (mime in EXTENSION_BY_MIME) return mime as AttachmentMime;
  const extension = (filename ?? '').split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  // A picker that knows nothing says "application/octet-stream"; the name decides then.
  if (mime === '' || mime === 'application/octet-stream' || mime === 'image/*') {
    return MIME_BY_EXTENSION[extension] ?? null;
  }
  return null;
}

export const extensionFor = (mime: AttachmentMime): string => EXTENSION_BY_MIME[mime];

export const isImage = (attachment: Pick<Attachment, 'kind' | 'mimeType'>): boolean =>
  attachment.kind === 'file' && (attachment.mimeType ?? '').startsWith('image/');

export const isPdf = (attachment: Pick<Attachment, 'kind' | 'mimeType'>): boolean =>
  attachment.kind === 'file' && attachment.mimeType === 'application/pdf';

/** The object's name inside the student's folder: their id, then the row's. */
export const storagePathFor = (userId: string, attachmentId: string, mime: AttachmentMime): string =>
  `${userId}/${attachmentId}.${extensionFor(mime)}`;

/** One line, no runs of spaces, no longer than the column allows. */
export function cleanTitle(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH).trim();
}

/** "Hafta_3-slaytlar.pdf" → "Hafta 3-slaytlar". */
export function titleFromFilename(filename: string | null | undefined): string {
  const base = (filename ?? '').split('/').pop() ?? '';
  const withoutExtension = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return cleanTitle(withoutExtension.replace(/[_]+/g, ' ')) || 'Dosya';
}

/**
 * What the student typed or pasted, as a web address the database accepts —
 * or null. "youtu.be/abc" becomes "https://youtu.be/abc"; a host needs a dot
 * (or to be localhost), and only http(s) is a link.
 */
export function normalizeUrl(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (raw === '' || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  const match = /^(https?):\/\/([^/?#\s]+)([/?#].*)?$/i.exec(withScheme);
  if (!match) return null;
  const [, scheme = '', authority = '', rest = ''] = match;
  const host = authority.replace(/^[^@]*@/, '').replace(/:\d+$/, '');
  if (!/^(localhost|[^.]+(\.[^.]+)+)$/i.test(host)) return null;
  const url = `${scheme.toLowerCase()}://${authority}${rest}`;
  return url.length <= MAX_URL_LENGTH ? url : null;
}

/** The first web address in a piece of shared text ("Şuna bak: https://…"). */
export function firstUrlIn(text: string | null | undefined): string | null {
  const match = /\bhttps?:\/\/[^\s<>"']+/i.exec(text ?? '');
  if (!match) return null;
  // A sentence's full stop or closing bracket is not part of the address.
  return normalizeUrl(match[0].replace(/[.,;:!?)\]]+$/, ''));
}

const SITE_NAMES: [RegExp, string][] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/^drive\.google\.com$/, 'Google Drive'],
  [/^docs\.google\.com$/, 'Google Dokümanlar'],
  [/(^|\.)wikipedia\.org$/, 'Vikipedi'],
  [/(^|\.)khanacademy\.org$/, 'Khan Academy'],
];

/** "www.youtube.com" → "YouTube", anything else → its host without "www.". */
export function siteName(url: string): string {
  const host = (/^https?:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(url)?.[1] ?? url).toLowerCase().replace(/^www\./, '');
  return SITE_NAMES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** A link with no name of its own: its site and path, briefly. */
export function defaultLinkTitle(url: string): string {
  const path = (/^https?:\/\/[^/?#]+([^?#]*)/i.exec(url)?.[1] ?? '').replace(/\/+$/, '');
  const lastSegment = decodeSafely(path.split('/').pop() ?? '');
  const site = siteName(url);
  return cleanTitle(lastSegment ? `${site} · ${lastSegment}` : site).slice(0, 80);
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value).replace(/[-_]+/g, ' ');
  } catch {
    return value;
  }
}

/** "840 KB", "2,4 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const KIND_LABEL = { pdf: 'PDF', image: 'Görsel', link: 'Link' } as const;

/** "PDF · 2,4 MB", "YouTube", "Görsel · 840 KB". */
export function describeAttachment(attachment: Attachment): string {
  if (attachment.kind === 'link') return attachment.url ? siteName(attachment.url) : KIND_LABEL.link;
  const kind = isPdf(attachment) ? KIND_LABEL.pdf : KIND_LABEL.image;
  const size = formatBytes(attachment.sizeBytes);
  return size ? `${kind} · ${size}` : kind;
}

export const RELATION_LABEL: Record<AttachmentRelation, string> = {
  task: 'Bu görevin ekleri',
  group: 'Grubun ekleri',
  source: 'Görevin çıktığı dosya',
  topic: 'Konunun diğer ekleri',
};

const RELATION_ORDER: AttachmentRelation[] = ['task', 'group', 'source', 'topic'];

export interface AttachmentSection {
  relation: AttachmentRelation;
  title: string;
  items: Attachment[];
}

/** The list in the order the screen shows it: nearest first, newest first within. */
export function sectionsOf(attachments: readonly Attachment[]): AttachmentSection[] {
  return RELATION_ORDER.flatMap((relation) => {
    const items = attachments
      .filter((attachment) => attachment.relation === relation)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.length > 0 ? [{ relation, title: RELATION_LABEL[relation], items }] : [];
  });
}
