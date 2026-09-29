// The order topics come in: the syllabus's own.
//
// Wherever the app has to choose between topics that are otherwise equal —
// which new topic the weekly plan starts, which one a sprint takes first, how a
// stretch is re-ordered — it goes by the week a topic is taught in and its
// place within that week. It once fell back on the alphabet, and "Capacitance"
// (week 6) was planned while "Electric charge" (week 2) waited.

export interface SyllabusPlace {
  /** The teaching week; null when the syllabus gave none. */
  weekNumber: number | null;
  /** Place within the week, as the syllabus listed it. */
  position: number;
}

/** Earlier week first, then earlier in the week; topics with no week go last. */
export function bySyllabusOrder(a: SyllabusPlace, b: SyllabusPlace): number {
  const weekA = a.weekNumber ?? Number.MAX_SAFE_INTEGER;
  const weekB = b.weekNumber ?? Number.MAX_SAFE_INTEGER;
  return weekA - weekB || a.position - b.position;
}
