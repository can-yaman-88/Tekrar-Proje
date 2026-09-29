// Every schema that actually goes out over the wire, checked against the
// guards that stand in front of it.
//
// This test exists because the guards were once tuned on synthetic schemas
// alone: the depth limit sat exactly on the real schemas' depth, so every AI
// call failed before a request was ever sent. A guard is only as good as the
// input it was measured against, so the real schemas are the input here.
import { assertEquals } from 'jsr:@std/assert@1';
import { CheckinPlanSchema, CheckinProgressSchema } from '../contracts/daily-checkin.contract.ts';
import { SyllabusExtractionSchema } from '../contracts/syllabus.contract.ts';
import { PlanPhrasingSchema } from '../contracts/weekly-plan.contract.ts';
import { toStrictJsonSchema, type JsonValue } from './json-schema.ts';

const WIRE_SCHEMAS = {
  // The check-in goes out as two readers' schemas; the merged one never does.
  checkin_progress: CheckinProgressSchema,
  checkin_plan: CheckinPlanSchema,
  syllabus_extraction: SyllabusExtractionSchema,
  plan_phrasing: PlanPhrasingSchema,
} as const;

/** Depth 0 is the root, matching the guard's own counting. */
function measure(node: JsonValue, depth = 0): { depth: number; nodes: number } {
  if (node === null || typeof node !== 'object') return { depth, nodes: 1 };
  let maxDepth = depth;
  let nodes = 1;
  for (const child of Object.values(node)) {
    const inner = measure(child as JsonValue, depth + 1);
    maxDepth = Math.max(maxDepth, inner.depth);
    nodes += inner.nodes;
  }
  return { depth: maxDepth, nodes };
}

for (const [name, schema] of Object.entries(WIRE_SCHEMAS)) {
  Deno.test(`${name} passes the portability guard`, () => {
    const wire = toStrictJsonSchema(schema);
    assertEquals(wire['type'], 'object');
  });

  Deno.test(`${name} keeps room under the guard limits`, () => {
    const size = measure(toStrictJsonSchema(schema));
    // Not a tight assertion: it fails only if a schema grows to where the
    // limits are within reach, which is the moment to revisit them.
    assertEquals(
      size.depth <= 10,
      true,
      `${name} is ${size.depth} levels deep; the guard allows 14, so the margin is nearly gone`,
    );
    assertEquals(
      size.nodes <= 800,
      true,
      `${name} has ${size.nodes} nodes; the guard allows 1200, so the margin is nearly gone`,
    );
  });
}
