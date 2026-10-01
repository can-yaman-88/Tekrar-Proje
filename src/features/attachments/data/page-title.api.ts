import { cleanTitle, siteName } from '@entities/attachment';
import { extractPageTitle } from '../domain/page-title';

const TIMEOUT_MS = 5000;
const MAX_HTML_CHARS = 400_000;

async function fetchWithTimeout(url: string, accept: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: accept } });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A name for a link, read from the page itself — a suggestion only: no
 * connection, a slow site or a page with no title just means no suggestion.
 * YouTube answers through oEmbed, which skips its cookie wall.
 */
export async function fetchPageTitle(url: string): Promise<string | null> {
  if (siteName(url) === 'YouTube') {
    const response = await fetchWithTimeout(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      'application/json',
    );
    try {
      const body = (await response?.json()) as { title?: unknown } | undefined;
      const title = typeof body?.title === 'string' ? cleanTitle(body.title) : '';
      if (title) return title;
    } catch {
      // Fall through to the page.
    }
  }

  const response = await fetchWithTimeout(url, 'text/html');
  if (!response || !(response.headers.get('content-type') ?? '').includes('html')) return null;
  try {
    return extractPageTitle((await response.text()).slice(0, MAX_HTML_CHARS));
  } catch {
    return null;
  }
}
