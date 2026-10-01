import { cleanTitle } from '@entities/attachment';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ouml: 'ö',
  Ouml: 'Ö',
  uuml: 'ü',
  Uuml: 'Ü',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return safeCodePoint(parseInt(code.slice(2), 16), whole);
    if (code.startsWith('#')) return safeCodePoint(parseInt(code.slice(1), 10), whole);
    return NAMED_ENTITIES[code] ?? whole;
  });
}

function safeCodePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback;
}

/** `<meta property="og:title" content="…">`, attributes in either order. */
function metaContent(html: string, property: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== property) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (value) return value;
  }
  return null;
}

/** A site's name tacked on the end ("… - YouTube") says nothing the row does not. */
const SITE_SUFFIX = /\s+[-–|·]\s+(YouTube|Vikipedi|Wikipedia|Google Drive|Google Docs)\s*$/i;

/**
 * The page's own name for itself: its sharing title, else its <title>.
 * Null when there is none worth showing.
 */
export function extractPageTitle(html: string): string | null {
  const raw = metaContent(html, 'og:title') ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const title = cleanTitle(decodeEntities(raw).replace(SITE_SUFFIX, ''));
  return title.length > 0 ? title : null;
}
