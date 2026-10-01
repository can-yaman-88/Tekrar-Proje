import { errorMessage, LlmError } from '../errors.ts';
import { MAX_RESPONSE_CHARS } from './guards.ts';

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/**
 * Provider rejections the student can actually do something about. Without
 * these, an empty OpenRouter balance and a malformed schema look identical
 * from the app: "the AI could not interpret this".
 */
function hintForStatus(status: number): string | undefined {
  switch (status) {
    case 401:
    case 403:
      return 'Yapay zekâ anahtarı geçersiz ya da yetkisi yok. Ayarlar’dan kendi OpenRouter anahtarını girebilirsin.';
    case 402:
      return 'OpenRouter bakiyesi bu istek için yetmedi. Hesabına kredi ekleyip tekrar dene.';
    case 404:
      return 'Seçili model bu anahtarla kullanılamıyor. Ayarlar’dan başka bir model seç.';
    default:
      return undefined;
  }
}

/**
 * "…You requested up to 8192 tokens, but can only afford 3104." — OpenRouter's
 * 402 says exactly how far the balance reaches. Null when it says nothing
 * usable, and the refusal stands.
 */
export function affordableTokensFrom(detail: string): number | null {
  const match = /can only afford (\d+)/i.exec(detail);
  const tokens = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

interface RetryOptions {
  attempts: number;
  /** Epoch ms by which the answer must be in, retries included. */
  deadline: number;
}

/** Less time than this left, and another attempt could only time out. */
const MIN_ATTEMPT_MS = 5_000;

const TIMEOUT_HINT =
  'Yapay zekâ modeli zamanında yanıt vermedi. Tekrar dene ya da Ayarlar’dan daha hızlı bir model seç.';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTimeout = (error: unknown) => (error as { name?: unknown } | null)?.name === 'TimeoutError';

/**
 * POSTs JSON, retrying transient failures with jittered exponential backoff,
 * all within one deadline.
 *
 * Each attempt gets whatever time is left rather than a fixed slice of it. A
 * reasoning model that needs 40 s for a check-in used to be cut off at 30 s
 * three times in a row, and the student was told the service was down.
 */
export async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  { attempts, deadline }: RetryOptions,
): Promise<unknown> {
  let lastError = 'unknown error';
  let timedOut = false;
  let attempt = 1;

  for (; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
      });
      if (res.ok) {
        // Read as text so the size can be checked before anything parses it.
        const body = await res.text();
        if (body.length > MAX_RESPONSE_CHARS) {
          throw new LlmError('invalid_output', `Provider returned ${body.length} characters, over the limit.`);
        }
        try {
          return JSON.parse(body) as unknown;
        } catch (cause) {
          throw new LlmError('invalid_output', 'Provider returned a non-JSON body.', { cause });
        }
      }

      const detail = (await res.text()).slice(0, 500);
      lastError = `HTTP ${res.status}: ${detail}`;
      timedOut = false;
      if (!RETRYABLE_STATUS.has(res.status)) {
        // 4xx other than rate limits means our request is wrong — surface it, don't retry.
        throw new LlmError('invalid_output', `Provider rejected request (${lastError})`, {
          hint: hintForStatus(res.status),
          affordableTokens: res.status === 402 ? (affordableTokensFrom(detail) ?? undefined) : undefined,
        });
      }
    } catch (error) {
      if (error instanceof LlmError) throw error;
      lastError = errorMessage(error); // network error or timeout
      timedOut = isTimeout(error);
    }

    const backoff = 2 ** attempt * 250 + Math.random() * 250;
    if (attempt >= attempts || deadline - Date.now() - backoff < MIN_ATTEMPT_MS) break;
    await sleep(backoff);
  }

  throw new LlmError('unavailable', `Provider unavailable after ${attempt} attempts (${lastError})`, {
    hint: timedOut ? TIMEOUT_HINT : undefined,
  });
}
