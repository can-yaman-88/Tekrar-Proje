import { extractText, getDocumentProxy } from 'unpdf';
import { HttpError } from '../_shared/errors.ts';

/** Below this, the PDF is almost certainly a scan with no text layer. */
const MIN_USEFUL_CHARS = 200;

export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  let text: string;
  let pages: number;
  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    text = result.text.replace(/\u0000/g, '').trim();
    pages = result.totalPages;
  } catch (cause) {
    throw new HttpError('bad_request', 'PDF okunamadı. Dosya bozuk olabilir.', { cause });
  }

  if (text.length < MIN_USEFUL_CHARS) {
    throw new HttpError(
      'bad_request',
      'Bu PDF metin içermiyor (taranmış olabilir). Metin tabanlı bir izlence yükle.',
    );
  }
  return { text, pages };
}
