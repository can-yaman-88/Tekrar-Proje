// Turns the files attached to a check-in into model input:
// PDFs become text (same extractor as the syllabus pipeline), images are
// passed through as vision parts.
import { extractText, getDocumentProxy } from 'unpdf';
import type { ImagePart } from '../_shared/llm/index.ts';

export interface StoredAttachment {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface PreparedAttachments {
  /** Text blocks, one per readable PDF. */
  documents: { filename: string; text: string }[];
  images: ImagePart[];
  /** Files that could not be used, in the user's language. */
  notes: string[];
}

const MAX_IMAGES = 3;
/** Base64 inflates by ~33%; keep the whole request comfortably inside provider limits. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_CHARS = 12_000;
const MIN_PDF_CHARS = 40;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function prepareAttachments(attachments: readonly StoredAttachment[]): Promise<PreparedAttachments> {
  const documents: PreparedAttachments['documents'] = [];
  const images: ImagePart[] = [];
  const notes: string[] = [];
  let imageBytes = 0;

  for (const attachment of attachments) {
    if (attachment.mimeType === 'application/pdf') {
      try {
        const pdf = await getDocumentProxy(attachment.bytes);
        const { text } = await extractText(pdf, { mergePages: true });
        const clean = text.replace(/\u0000/g, '').trim();
        if (clean.length < MIN_PDF_CHARS) {
          notes.push(`${attachment.filename}: PDF metin içermiyor (taranmış olabilir), okunamadı.`);
          continue;
        }
        documents.push({ filename: attachment.filename, text: clean.slice(0, MAX_PDF_CHARS) });
      } catch {
        notes.push(`${attachment.filename}: PDF açılamadı.`);
      }
      continue;
    }

    if (attachment.mimeType === 'image/jpeg' || attachment.mimeType === 'image/png' || attachment.mimeType === 'image/webp') {
      if (images.length >= MAX_IMAGES) {
        notes.push(`${attachment.filename}: en fazla ${MAX_IMAGES} görsel işleniyor, bu atlandı.`);
        continue;
      }
      if (attachment.bytes.byteLength > MAX_IMAGE_BYTES) {
        notes.push(`${attachment.filename}: görsel çok büyük (4 MB üstü), atlandı.`);
        continue;
      }
      if (imageBytes + attachment.bytes.byteLength > MAX_TOTAL_IMAGE_BYTES) {
        notes.push(`${attachment.filename}: toplam görsel boyutu sınırı aşıldı, atlandı.`);
        continue;
      }
      imageBytes += attachment.bytes.byteLength;
      images.push({ mimeType: attachment.mimeType, base64: toBase64(attachment.bytes) });
      continue;
    }

    notes.push(`${attachment.filename}: desteklenmeyen dosya türü.`);
  }

  return { documents, images, notes };
}
