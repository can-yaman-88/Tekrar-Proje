import { z } from 'zod';
import { LlmError } from '../errors.ts';
import { assertResponseShape, assertResponseSize, assertSchemaIsPortable } from './guards.ts';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Constraint keywords are dropped from the wire schema: providers accept them
 * inconsistently (Google rejects a schema mixing numeric/array bounds with
 * several nullable fields). They stay enforced in code — the response is Zod
 * validated and the planner clamps every value before it reaches the database.
 */
const DROPPED_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
]);

function strictify(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(strictify);
  if (!isJsonObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    out[key] = strictify(value);
  }
  const properties = out['properties'];
  if (out['type'] === 'object' && isJsonObject(properties)) {
    out['additionalProperties'] = false;
    out['required'] = Object.keys(properties);
  }
  return out;
}

/**
 * Zod → JSON Schema in the "strict" dialect accepted by OpenAI structured
 * outputs and Gemini `responseJsonSchema`: closed objects, every key required
 * (optionality must be modelled as `.nullable()`).
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonObject {
  const raw: unknown = JSON.parse(JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'throw' })));
  const strict = isJsonObject(raw) ? strictify(raw) : null;
  if (!isJsonObject(strict)) throw new LlmError('invalid_output', 'Schema did not convert to a JSON object.');
  // Fail here, with a readable reason, rather than at the provider with a 400.
  assertSchemaIsPortable(strict);
  return strict;
}

/** Parses provider text as JSON and validates it; both failures are `invalid_output`. */
export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
  assertResponseSize(text);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new LlmError('invalid_output', 'Model returned non-JSON output.', { cause });
  }

  // Shape first: Zod should never be handed a hostile structure to walk.
  assertResponseShape(json);

  const result = schema.safeParse(json);
  if (!result.success) {
    // The raw answer helps debugging but must not reach the student.
    console.warn(
      JSON.stringify({ event: 'llm_output_rejected', preview: text.slice(0, 400), issues: result.error.issues.length }),
    );
    throw new LlmError('invalid_output', `Model output failed validation: ${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data;
}
