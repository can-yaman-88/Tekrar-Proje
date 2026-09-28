import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import type { JsonObject } from './json-schema.ts';
import {
  assertPromptSize,
  assertResponseShape,
  assertResponseSize,
  assertSchemaIsPortable,
  sanitiseForPrompt,
} from './guards.ts';
import { LlmError } from '../errors.ts';

Deno.test('şema: taşınabilir olanı geçirir', () => {
  assertSchemaIsPortable({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'integer' } } },
    required: ['a', 'b'],
    additionalProperties: false,
  });
});

Deno.test('şema: sağlayıcıların tutarsız işlediği anahtarları reddeder', () => {
  for (const keyword of ['$ref', '$defs', 'allOf', 'oneOf', 'not']) {
    assertThrows(
      () => assertSchemaIsPortable({ type: 'object', properties: { a: { [keyword]: 'x' } } }),
      LlmError,
      keyword,
    );
  }
});

Deno.test('şema: aşırı derin yapı reddedilir', () => {
  let deep: JsonObject = { type: 'string' };
  for (let i = 0; i < 12; i++) deep = { type: 'object', properties: { nested: deep } };
  assertThrows(() => assertSchemaIsPortable(deep), LlmError, 'deeper');
});

Deno.test('metin temizleme: kontrol karakterleri ve sıfır genişlikli işaretler gider', () => {
  const dirty = 'Merhaba\u0000dünya​!\u001B[31m';
  const clean = sanitiseForPrompt(dirty, 100);
  assertEquals(clean.includes('\u0000'), false);
  assertEquals(clean.includes('​'), false);
  assertEquals(clean.includes('Merhaba'), true);
});

Deno.test('metin temizleme: uzun metin görünür şekilde kısaltılır', () => {
  const clean = sanitiseForPrompt('a'.repeat(500), 100);
  assertEquals(clean.length < 130, true);
  assertEquals(clean.endsWith('[kısaltıldı]'), true);
});

Deno.test('istem boyutu sınırı', () => {
  assertPromptSize('kısa istem', 100);
  assertThrows(() => assertPromptSize('x'.repeat(200), 100), LlmError, 'over the');
});

Deno.test('yanıt: devasa gövde reddedilir', () => {
  assertResponseSize('x'.repeat(1000));
  assertThrows(() => assertResponseSize('x'.repeat(200_001)), LlmError, 'over the limit');
});

Deno.test('yanıt: nesne olmayan çıktı reddedilir', () => {
  assertThrows(() => assertResponseShape([1, 2, 3]), LlmError, 'not a JSON object');
  assertThrows(() => assertResponseShape('metin'), LlmError, 'not a JSON object');
  assertThrows(() => assertResponseShape(null), LlmError, 'not a JSON object');
});

Deno.test('yanıt: aşırı derin ve aşırı büyük çıktı reddedilir', () => {
  let deep: Record<string, unknown> = { value: 1 };
  for (let i = 0; i < 20; i++) deep = { nested: deep };
  assertThrows(() => assertResponseShape(deep), LlmError, 'too deeply');

  const wide: Record<string, number> = {};
  for (let i = 0; i < 6000; i++) wide[`k${i}`] = i;
  assertThrows(() => assertResponseShape(wide), LlmError, 'too many fields');
});
