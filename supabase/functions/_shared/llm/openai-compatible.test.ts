// OpenRouter prices a request at its worst case before answering it. These
// check that a check-in reserves only what it needs, and that a balance which
// cannot cover the reservation — but can cover the answer — still gets one.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { z } from 'zod';
import { LlmError } from '../errors.ts';
import { affordableTokensFrom } from './fetch-with-retry.ts';
import { OpenAiCompatibleProvider } from './openai-compatible.ts';

const Schema = z.object({ ok: z.boolean() });

const provider = () =>
  new OpenAiCompatibleProvider({
    name: 'openrouter',
    apiKey: 'test',
    model: 'test/model',
    timeoutMs: 5_000,
    maxOutputTokens: 8_192,
    baseUrl: 'https://example.invalid/api/v1',
  });

const completion = () =>
  new Response(
    JSON.stringify({ model: 'test/model', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }),
    { status: 200 },
  );
const noCredit = (afford: number) =>
  new Response(
    JSON.stringify({
      error: {
        code: 402,
        message: `This request requires more credits, or fewer max_tokens. You requested up to 3072 tokens, but can only afford ${afford}.`,
      },
    }),
    { status: 402 },
  );

/** Replaces fetch for one test, recording every max_tokens it was asked for. */
function stubFetch(responses: Response[]): { limits: number[]; restore: () => void } {
  const original = globalThis.fetch;
  const limits: number[] = [];
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    limits.push(JSON.parse(String(init?.body)).max_tokens);
    const next = responses.shift();
    return Promise.resolve(next ?? new Response('{}', { status: 500 }));
  }) as typeof fetch;
  return { limits, restore: () => (globalThis.fetch = original) };
}

Deno.test('istek kendi çıktı sınırını ister, dağıtımın sınırını aşmadan', async () => {
  const stub = stubFetch([completion()]);
  try {
    const result = await provider().generateStructured({
      system: 's',
      user: 'u',
      schema: Schema,
      schemaName: 'test',
      maxOutputTokens: 3_072,
    });
    assertEquals(result.data, { ok: true });
    assertEquals(stub.limits, [3_072]);
  } finally {
    stub.restore();
  }
});

Deno.test('402: bakiye cevaba yetiyorsa sınır düşürülüp bir kez daha sorulur', async () => {
  const stub = stubFetch([noCredit(2_100), completion()]);
  try {
    const result = await provider().generateStructured({
      system: 's',
      user: 'u',
      schema: Schema,
      schemaName: 'test',
      maxOutputTokens: 3_072,
    });
    assertEquals(result.data, { ok: true });
    assertEquals(stub.limits, [3_072, 2_068]);
  } finally {
    stub.restore();
  }
});

Deno.test('402: bakiye bir cevaba bile yetmiyorsa ret, öğrencinin anlayacağı ipucuyla kalır', async () => {
  const stub = stubFetch([noCredit(400)]);
  try {
    const error = await assertRejects(
      () => provider().generateStructured({ system: 's', user: 'u', schema: Schema, schemaName: 'test' }),
      LlmError,
    );
    assertEquals(error.hint, 'OpenRouter bakiyesi bu istek için yetmedi. Hesabına kredi ekleyip tekrar dene.');
    assertEquals(stub.limits, [8_192]);
  } finally {
    stub.restore();
  }
});

Deno.test('402 gövdesindeki karşılanabilir token sayısı okunur', () => {
  assertEquals(affordableTokensFrom('You requested up to 8192 tokens, but can only afford 5301.'), 5_301);
  assertEquals(affordableTokensFrom('Insufficient credits'), null);
});
