import { assertEquals } from 'jsr:@std/assert@1';
import type { Env } from '../_shared/env.ts';
import { listModels } from './catalog.ts';

const env = { LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test' } as Env;

/** A catalogue of `capable` models that return JSON and `other` that cannot. */
function stubCatalogue(capable: number, other: number): () => void {
  const original = globalThis.fetch;
  const data = [
    ...Array.from({ length: capable }, (_, i) => ({
      id: `vendor/model-${String(i).padStart(3, '0')}`,
      name: `Model ${String(i).padStart(3, '0')}`,
      supported_parameters: i % 2 === 0 ? ['structured_outputs'] : ['response_format'],
      pricing: { prompt: i < 10 ? '0' : '0.000001' },
    })),
    ...Array.from({ length: other }, (_, i) => ({
      id: `vendor/plain-${i}`,
      name: `Plain ${i}`,
      supported_parameters: ['temperature'],
      pricing: { prompt: '0.000001' },
    })),
  ];
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data })))) as typeof fetch;
  return () => (globalThis.fetch = original);
}

Deno.test('liste 120 ile kesilmez: yapılandırılmış çıktı verebilen bütün modeller gelir', async () => {
  const restore = stubCatalogue(300, 40);
  try {
    const models = await listModels(env);
    assertEquals(models.length, 300);
    assertEquals(models.some((model) => model.id.startsWith('vendor/plain-')), false);
    // Ücretsizler başta.
    assertEquals(models.slice(0, 10).every((model) => model.isFree), true);
  } finally {
    restore();
  }
});

Deno.test('kullanılan model katalogda olmasa da listede görünür', async () => {
  const restore = stubCatalogue(5, 0);
  try {
    const models = await listModels(env, null, 'someone/retired-model');
    assertEquals(models[0]?.id, 'someone/retired-model');
    assertEquals(models.length, 6);
  } finally {
    restore();
  }
});
