/** Something the student got wrong, kept until they say they have it. */
export interface TopicMistake {
  id: string;
  topicId: string;
  /** What went wrong, in the student's own words — the part worth reading. */
  body: string;
  /** Short label for grouping ("Mol hesapları"); may repeat across entries. */
  concept: string | null;
  taskId: string | null;
  /** Written down by a check-in, rather than by hand. */
  fromCheckin: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export const isOpenMistake = (mistake: Pick<TopicMistake, 'resolvedAt'>): boolean => mistake.resolvedAt === null;

/** A book entry with the names needed to file it under a course and topic. */
export interface TopicMistakeWithContext extends TopicMistake {
  topicTitle: string;
  /** Where the topic sits in the syllabus, so lists follow the course's own order. */
  topicWeek: number | null;
  topicPosition: number;
  courseLabel: string;
  /** The task it came up in, when there was one. */
  taskTitle: string | null;
}

/** What the database accepts: the sentence 2–300 characters, the label 2–120. */
export const MISTAKE_BODY_MAX = 300;
export const MISTAKE_CONCEPT_MAX = 120;

/**
 * Cleans what the student typed. Returns null when there is nothing worth
 * keeping, so the form can say so before the database does.
 */
export function normalizeMistake(body: string, concept?: string | null): { body: string; concept: string | null } | null {
  const text = body.replace(/\s+/g, ' ').trim().slice(0, MISTAKE_BODY_MAX);
  if (text.length < 2) return null;
  const label = (concept ?? '').replace(/\s+/g, ' ').trim().slice(0, MISTAKE_CONCEPT_MAX);
  return { body: text, concept: label.length >= 2 ? label : null };
}

/**
 * How an entry reads in a list. The label is only worth showing when it adds
 * something the sentence does not already say.
 */
export function mistakeLabel(mistake: Pick<TopicMistake, 'concept' | 'body'>): string {
  const { concept, body } = mistake;
  if (concept === null) return body;
  return body.toLocaleLowerCase('tr').includes(concept.toLocaleLowerCase('tr')) ? body : `${concept} — ${body}`;
}

/** The label alone, when it is not already inside the sentence — for a chip above it. */
export function mistakeChip(mistake: Pick<TopicMistake, 'concept' | 'body'>): string | null {
  const { concept, body } = mistake;
  if (concept === null) return null;
  return body.toLocaleLowerCase('tr').includes(concept.toLocaleLowerCase('tr')) ? null : concept;
}
