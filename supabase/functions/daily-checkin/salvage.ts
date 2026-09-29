// Keeping what a model got right when it got one thing wrong.
//
// The extraction has close to twenty lists. A single item in one of them with
// an enum value the schema does not know ("done" for "completed"), a number
// written as a string, or a missing key used to fail the whole check-in — and
// the student, who had written half a page about their day, got an error and
// the same half page back to retry. Strict structured output makes this rare
// on the providers that enforce it; the student may pick any model, and not
// all of them do.
//
// So when the answer fails validation as a whole, it is validated item by
// item: every item that passes is kept, every one that does not is dropped and
// counted, and a list the model left out entirely is empty. The planner then
// treats the result exactly as it treats any other answer — every id is still
// checked, every number still clamped.
import { z } from 'zod';
import { type CheckinExtraction, CheckinExtractionSchema } from '../_shared/contracts/daily-checkin.contract.ts';

export interface Salvaged<T> {
  data: T;
  /** Items that failed on their own and were left out. */
  droppedItems: number;
}

/** A rescue for one reader's schema: lists are kept item by item, anything else falls back safely. */
export function salvageWith<T extends z.ZodObject>(schema: T): (json: unknown) => Salvaged<z.output<T>> | null {
  return (json) => {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
    const source = json as Record<string, unknown>;

    let droppedItems = 0;
    const repaired: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.shape)) {
      const value = source[key];
      if (field instanceof z.ZodArray) {
        const items = Array.isArray(value) ? value : [];
        repaired[key] = items.filter((item) => {
          const ok = z.safeParse(field.element, item).success;
          if (!ok) droppedItems++;
          return ok;
        });
      } else if (z.safeParse(field, value).success) {
        repaired[key] = value;
      } else {
        // A flag that cannot be read is a flag not raised: "undo that report"
        // must never happen because an answer was garbled.
        repaired[key] = field instanceof z.ZodBoolean ? false : 'Değerlendirmen işlendi.';
      }
    }

    const result = schema.safeParse(repaired);
    return result.success ? { data: result.data, droppedItems } : null;
  };
}

/** The whole extraction at once — what the planner consumes. */
export const salvageExtraction: (json: unknown) => Salvaged<CheckinExtraction> | null = salvageWith(CheckinExtractionSchema);
