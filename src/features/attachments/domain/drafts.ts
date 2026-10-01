import { titleFromFilename, type AttachmentMime } from '@entities/attachment';

/** Camera and gallery names say nothing: "IMG_20261001_140512", "PXL_…", "1000123". */
const MEANINGLESS_NAME =
  /^(img|pxl|image|photo|foto|screenshot|dsc|mvimg|signal|whatsapp image)?[\s_-]*[\d_\-.\s]*$|^[0-9a-f-]{20,}$/i;

/**
 * A name for a new file: the file's own, unless it is a camera's serial
 * number — then "Fotoğraf · 1 Eki 14:05", which at least says when.
 */
export function fileTitle(name: string | null | undefined, mime: AttachmentMime, now: Date = new Date()): string {
  const fromName = name ? titleFromFilename(name) : '';
  if (fromName && fromName !== 'Dosya' && !MEANINGLESS_NAME.test(fromName)) return fromName;
  const day = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${mime === 'application/pdf' ? 'Belge' : 'Fotoğraf'} · ${day} ${time}`;
}

export type RejectionReason = 'unsupported' | 'too_big' | 'unreadable';

export interface Rejection {
  name: string;
  reason: RejectionReason;
}

const REASON_TEXT: Record<RejectionReason, string> = {
  unsupported: 'yalnızca PDF, JPEG, PNG ve WebP eklenebilir',
  too_big: '20 MB sınırını aşıyor',
  unreadable: 'telefonda okunamadı',
};

/** One line for the files that did not make it, naming the first. */
export function rejectionMessage(rejections: readonly Rejection[]): string | null {
  const [first] = rejections;
  if (!first) return null;
  const head = `"${first.name}" eklenmedi: ${REASON_TEXT[first.reason]}.`;
  return rejections.length > 1 ? `${head} (${rejections.length - 1} dosya daha eklenmedi.)` : head;
}
