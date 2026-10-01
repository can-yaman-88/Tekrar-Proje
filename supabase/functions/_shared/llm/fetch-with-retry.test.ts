// A slow model must get the whole budget, and a failure must stop at the
// deadline with a reason the student can act on.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { LlmError } from '../errors.ts';
import { postJsonWithRetry } from './fetch-with-retry.ts';

/** Replaces fetch for one test; each step answers or hangs until aborted. */
function stubFetch(steps: (Response | 'hang')[]): { calls: number; restore: () => void } {
  const original = globalThis.fetch;
  const stub = { calls: 0, restore: () => (globalThis.fetch = original) };
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    stub.calls++;
    const step = steps.shift() ?? new Response('{}', { status: 500 });
    if (step !== 'hang') return Promise.resolve(step);
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
  }) as typeof fetch;
  return stub;
}

Deno.test('cevap bütçeyi aşarsa yeniden denenmez, zaman aşımı söylenir', async () => {
  const stub = stubFetch(['hang', 'hang', 'hang']);
  try {
    const error = await assertRejects(
      () => postJsonWithRetry('https://example.invalid', {}, {}, { attempts: 3, deadline: Date.now() + 50 }),
      LlmError,
    );
    assertEquals(error.kind, 'unavailable');
    assertEquals(error.hint?.startsWith('Yapay zekâ modeli zamanında yanıt vermedi'), true);
    // The one attempt had the whole budget; a retry could only have timed out.
    assertEquals(stub.calls, 1);
  } finally {
    stub.restore();
  }
});

Deno.test('hızlı bir sunucu hatası bütçe içinde yeniden denenir', async () => {
  const stub = stubFetch([new Response('busy', { status: 503 }), new Response('{"ok":true}', { status: 200 })]);
  try {
    const body = await postJsonWithRetry('https://example.invalid', {}, {}, { attempts: 3, deadline: Date.now() + 30_000 });
    assertEquals(body, { ok: true });
    assertEquals(stub.calls, 2);
  } finally {
    stub.restore();
  }
});

Deno.test('sunucu hatasıyla biten denemeler zaman aşımı ipucu vermez', async () => {
  const stub = stubFetch([503, 503, 503].map((status) => new Response('busy', { status })));
  try {
    const error = await assertRejects(
      () => postJsonWithRetry('https://example.invalid', {}, {}, { attempts: 3, deadline: Date.now() + 30_000 }),
      LlmError,
    );
    assertEquals(error.hint, undefined);
    assertEquals(stub.calls, 3);
  } finally {
    stub.restore();
  }
});
