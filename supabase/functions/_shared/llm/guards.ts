// Guard rails around everything that crosses the language-model boundary.
//
// Two directions, two risks:
//   · outgoing — an oversized or exotic JSON Schema is rejected by providers in
//     ways that are hard to read, and untrusted text (a syllabus, a report, a
//     PDF) must travel as data, never as instructions;
//   · incoming — the answer is attacker-shaped input until proven otherwise:
//     it can be huge, deeply nested, or simply not what was asked for.
import { LlmError } from '../errors.ts';
import type { JsonObject, JsonValue } from './json-schema.ts';

// ---------------------------------------------------------------------------
// Outgoing
// ---------------------------------------------------------------------------

/**
 * Providers reject deep or sprawling schemas; fail early with a clear reason.
 *
 * The numbers have headroom on purpose. The check-in schema — the largest one
 * here, and the one that grows every time the student can say something new —
 * measures 8 levels and 565 nodes; an array of objects with nullable fields is
 * already `properties → items → properties → field → anyOf → 0 → type`. A limit
 * that merely fits today's schemas would break every AI call the next time a
 * field is added, which is exactly what these guards exist to prevent. What
 * they are really watching for is runaway structure, an order of magnitude out.
 */
const MAX_SCHEMA_DEPTH = 14;
const MAX_SCHEMA_NODES = 1_200;
/** Keywords no provider handles consistently in strict mode. */
const FORBIDDEN_KEYWORDS = ['$ref', '$defs', 'definitions', 'allOf', 'oneOf', 'not', 'patternProperties'];

export function assertSchemaIsPortable(schema: JsonObject): void {
  let nodes = 0;

  const walk = (node: JsonValue, depth: number): void => {
    if (depth > MAX_SCHEMA_DEPTH) {
      throw new LlmError('invalid_output', `Schema is nested deeper than ${MAX_SCHEMA_DEPTH} levels.`);
    }
    if (++nodes > MAX_SCHEMA_NODES) {
      throw new LlmError('invalid_output', `Schema has more than ${MAX_SCHEMA_NODES} nodes.`);
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object' || node === null) return;

    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (keyword in node) {
        throw new LlmError('invalid_output', `Schema uses "${keyword}", which providers handle inconsistently.`);
      }
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  // Depth 0 is the root object, so the limit counts levels below it.
  walk(schema, 0);
}

/** Total characters allowed in one user prompt, attachments included. */
export const MAX_PROMPT_CHARS = 60_000;

/**
 * Prepares untrusted text for a prompt: control characters out (they hide
 * instructions from a reader but not from a model), runaway whitespace
 * collapsed, length capped with a visible marker.
 */
export function sanitiseForPrompt(text: string, maxChars: number): string {
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/​|‌|‍|﻿/g, '') // zero-width characters
    .replace(/[ \t]{4,}/g, '   ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}\n…[kısaltıldı]` : cleaned;
}

/** Last stop before the request leaves: a prompt that is too big never helps. */
export function assertPromptSize(prompt: string, maxChars: number = MAX_PROMPT_CHARS): void {
  if (prompt.length > maxChars) {
    throw new LlmError('invalid_output', `Prompt is ${prompt.length} characters, over the ${maxChars} limit.`);
  }
}

// ---------------------------------------------------------------------------
// Incoming
// ---------------------------------------------------------------------------

/** A structured answer this large is a malfunction, not an answer. */
export const MAX_RESPONSE_CHARS = 200_000;
const MAX_RESPONSE_DEPTH = 12;
const MAX_RESPONSE_NODES = 5_000;

export function assertResponseSize(text: string): void {
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new LlmError('invalid_output', `Model returned ${text.length} characters, over the limit.`);
  }
}

/** Runs before Zod: a hostile shape should not become someone's stack overflow. */
export function assertResponseShape(value: unknown): void {
  let nodes = 0;

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_RESPONSE_DEPTH) {
      throw new LlmError('invalid_output', 'Model output is nested too deeply.');
    }
    if (++nodes > MAX_RESPONSE_NODES) {
      throw new LlmError('invalid_output', 'Model output has too many fields.');
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const item of Object.values(node)) walk(item, depth + 1);
    }
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LlmError('invalid_output', 'Model output is not a JSON object.');
  }
  walk(value, 1);
}
