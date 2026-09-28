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

interface RetryOptions {
  attempts: number;
  timeoutMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POSTs JSON with a per-attempt timeout and jittered exponential backoff on transient failures. */
export async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  { attempts, timeoutMs }: RetryOptions,
): Promise<unknown> {
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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
      if (!RETRYABLE_STATUS.has(res.status)) {
        // 4xx other than rate limits means our request is wrong — surface it, don't retry.
        throw new LlmError('invalid_output', `Provider rejected request (${lastError})`, {
          hint: hintForStatus(res.status),
        });
      }
    } catch (error) {
      if (error instanceof LlmError) throw error;
      lastError = errorMessage(error); // network error or timeout
    }

    if (attempt < attempts) await sleep(2 ** attempt * 250 + Math.random() * 250);
  }

  throw new LlmError('unavailable', `Provider unavailable after ${attempts} attempts (${lastError})`);
}
